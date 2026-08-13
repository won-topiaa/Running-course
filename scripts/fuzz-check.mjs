// 속성 기반 퍼징 + 전수 격자 — "모든 경우의 수" 검사.
//   node scripts/fuzz-check.mjs
//
// 손으로 고른 사례는 고른 만큼만 본다. 여기서는 무작위 수백 케이스에
// '어떤 입력에서도 지켜야 하는 불변식'을 강제하고, 정의역이 작은 함수는
// 격자로 진짜 전부 돈다. 시드 고정 — 실패가 나면 그대로 재현된다.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'fz-'));
const bundle = async (entry, name) => {
  const out = join(dir, name);
  await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile: out, logLevel: 'error' });
  return import(out);
};

const ok = [];
const bad = [];
const check = (c, m) => {
  (c ? ok : bad).push(m);
  console.log((c ? '  ✅ ' : '  ❌ ') + m);
};

// mulberry32 — 시드 고정 PRNG
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const { advanceProgress, cumulativeMeters } = await bundle('src/lib/routeProgress.ts', 'rp.mjs');
const { spurKeptIndices, thinWaypoints, pathLengthMeters, haversineMeters } =
  await bundle('src/lib/geo.ts', 'g.mjs');
const { scoreCourse, recommend, defaultPreferences } = await bundle('src/lib/scoring.ts', 'sc.mjs');
const { COURSES } = await bundle('src/data/courses.ts', 'c.mjs');
const { formatPace, formatDuration, formatClock, formatDistance, estimateTimeLabel, sanePace } =
  await bundle('src/lib/format.ts', 'f.mjs');

const LAT = 1 / 111195;
const LNG = 1 / 88320;
const P = (xm, ym) => [37.5 + ym * LAT, 127.0 + xm * LNG];

// 완만하게 굽는 무작위 경로 (미터 좌표) — 도로망 위 라우팅 결과 흉내
function randomPath(rand, lenM, stepM, maxTurnDeg = 20) {
  let x = 0, y = 0, heading = rand() * 360;
  const out = [P(0, 0)];
  for (let m = stepM; m <= lenM; m += stepM) {
    heading += (rand() * 2 - 1) * maxTurnDeg;
    x += stepM * Math.cos((heading * Math.PI) / 180);
    y += stepM * Math.sin((heading * Math.PI) / 180);
    out.push(P(x, y));
  }
  return out;
}

// ── 1) 따라 뛰기 진행 판정 퍼징 ─────────────────────────────────────────
// 어떤 경로(편도/왕복/순환)든, GPS 잡음이 있어도:
//   · 인덱스는 뒤로 가지 않는다
//   · 러너의 실제 이동보다 앞서 순간이동하지 않는다
//   · 끝까지 가면 완주에 도달한다
console.log('\n[퍼징] 따라 뛰기 진행 — 무작위 경로 120개 × 잡음');
{
  let fails = [];
  for (let run = 0; run < 120; run++) {
    const rand = rng(1000 + run);
    const kind = run % 3; // 0 편도, 1 왕복, 2 순환
    const stepM = 12 + Math.floor(rand() * 18); // 12~30m
    let path = randomPath(rand, 800 + rand() * 1500, stepM);
    if (kind === 1) path = [...path, ...path.slice(0, -1).reverse()];
    if (kind === 2) path = [...path, path[0]];
    const cum = cumulativeMeters(path);
    const total = cum[cum.length - 1];

    let idx = 0;
    let traveled = 0;
    const tickM = 10 + rand() * 10;
    while (traveled < total) {
      traveled = Math.min(total, traveled + tickM);
      // 실제 위치: 누적거리 traveled 에 해당하는 경로 위 점 + 최대 10m 잡음
      let seg = 1;
      while (seg < cum.length - 1 && cum[seg] < traveled) seg++;
      const t = (traveled - cum[seg - 1]) / Math.max(1e-9, cum[seg] - cum[seg - 1]);
      const base = [
        path[seg - 1][0] + (path[seg][0] - path[seg - 1][0]) * t,
        path[seg - 1][1] + (path[seg][1] - path[seg - 1][1]) * t,
      ];
      const noise = rand() * 10;
      const ang = rand() * Math.PI * 2;
      const pos = [base[0] + noise * Math.sin(ang) * LAT, base[1] + noise * Math.cos(ang) * LNG];

      const prev = idx;
      idx = advanceProgress(path, pos, idx);
      if (idx < prev) { fails.push(`run${run}: 역행 ${prev}→${idx}`); break; }
      // 순간이동 금지: 판정 위치가 실제 이동보다 크게 앞설 수 없다
      if (cum[idx] > traveled + stepM * 2 + 25) {
        fails.push(`run${run}(${['편도','왕복','순환'][kind]}): 순간이동 — 실제 ${Math.round(traveled)}m 인데 판정 ${Math.round(cum[idx])}m`);
        break;
      }
    }
    if (!fails.length && idx < path.length - 3) {
      fails.push(`run${run}: 미완주 idx ${idx}/${path.length - 1}`);
    }
    if (fails.length) break;
  }
  check(fails.length === 0, `무작위 120개 경로에서 역행·순간이동·미완주 없음${fails.length ? ' — ' + fails[0] : ''}`);
}

// ── 2) 돌기 제거 퍼징 ───────────────────────────────────────────────────
console.log('\n[퍼징] 돌기 제거 — 무작위 본선 80개 × 돌기 주입');
{
  let fails = [];
  for (let run = 0; run < 80; run++) {
    const rand = rng(7000 + run);
    const main = randomPath(rand, 1200 + rand() * 1200, 15, 14);
    const clean = spurKeptIndices(main);
    // 돌기 없는 본선은 대체로 그대로여야 한다 (우연한 자기근접 허용 오차 5%)
    const cleanLen = pathLengthMeters(clean.map((i) => main[i]));
    const mainLen = pathLengthMeters(main);
    if (cleanLen < mainLen * 0.95) {
      fails.push(`run${run}: 돌기 없는 본선을 ${Math.round(mainLen - cleanLen)}m 잘라냄`);
      break;
    }
    // 본선 중간 30~70% 지점에 수직 돌기 하나 주입 (편도 40~140m)
    const at = Math.floor(main.length * (0.3 + rand() * 0.4));
    const spurLen = 40 + rand() * 100;
    const a = main[at];
    const b = main[at + 1] ?? main[at - 1];
    const dx = (b[1] - a[1]) * 88320;
    const dy = (b[0] - a[0]) * 111195;
    const h = Math.hypot(dx, dy) || 1;
    const nx = -dy / h, ny = dx / h; // 수직 방향
    const spurred = [...main.slice(0, at + 1)];
    for (let d = 10; d <= spurLen; d += 10)
      spurred.push([a[0] + ny * d * LAT, a[1] + nx * d * LNG]);
    for (let d = spurLen - 10; d >= 0; d -= 10)
      spurred.push([a[0] + ny * d * LAT, a[1] + nx * d * LNG]);
    spurred.push(...main.slice(at + 1));

    const kept = spurKeptIndices(spurred);
    const keptPts = kept.map((i) => spurred[i]);
    const trimmedLen = pathLengthMeters(keptPts);
    // 주입한 돌기(왕복 2×spurLen)가 걷혀 본선 길이 근처로 돌아와야 한다
    if (Math.abs(trimmedLen - mainLen) > 90) {
      fails.push(`run${run}: 돌기 ${Math.round(spurLen)}m 주입 후 ${Math.round(trimmedLen)}m (본선 ${Math.round(mainLen)}m)`);
      break;
    }
    // 시작·끝 보존 + 멱등성
    if (kept[0] !== 0 || kept[kept.length - 1] !== spurred.length - 1) {
      fails.push(`run${run}: 끝점 소실`);
      break;
    }
    const again = spurKeptIndices(keptPts);
    if (again.length !== keptPts.length) {
      fails.push(`run${run}: 멱등성 위반 — 두 번째 패스가 ${keptPts.length - again.length}점 더 잘라냄`);
      break;
    }
  }
  check(fails.length === 0, `본선 보존·돌기 제거·끝점 유지·멱등성 모두 성립${fails.length ? ' — ' + fails[0] : ''}`);
}

// ── 3) 경유지 솎기 전수 격자 ────────────────────────────────────────────
console.log('\n[전수] 경유지 솎기 — n 2~120 × max 2~50 전부');
{
  let fails = [];
  outer: for (let n = 2; n <= 120; n++) {
    const seq = Array.from({ length: n }, (_, i) => P(i * 10, 0));
    const sym = n >= 3 ? [...seq, ...seq.slice(0, -1).reverse()] : seq;
    for (let max = 2; max <= 50; max++) {
      for (const pts of [seq, sym]) {
        const t = thinWaypoints(pts, max);
        if (t.length > max) { fails.push(`n=${pts.length} max=${max}: ${t.length}개`); break outer; }
        if (t[0] !== pts[0] || t[t.length - 1] !== pts[pts.length - 1]) {
          fails.push(`n=${pts.length} max=${max}: 끝점 소실`); break outer;
        }
        for (let i = 1; i < t.length; i++) {
          if (t[i][0] === t[i - 1][0] && t[i][1] === t[i - 1][1]) {
            fails.push(`n=${pts.length} max=${max}: 연속 중복`); break outer;
          }
        }
      }
    }
  }
  check(fails.length === 0, `11,662가지 조합 전부 — 상한·끝점·중복 불변식 성립${fails.length ? ' — ' + fails[0] : ''}`);
}

// ── 4) 추천 점수 전수 격자 ──────────────────────────────────────────────
console.log('\n[전수] 추천 점수 — 코스 14 × 목표 1~15km × 경사 3 × 야간 2');
{
  let fails = [];
  const gradients = ['flat', 'any', 'hilly'];
  outer: for (const course of COURSES) {
    for (let target = 1; target <= 15; target++) {
      for (const g of gradients) {
        for (const night of [false, true]) {
          const prefs = { ...defaultPreferences(), targetDistanceKm: target, gradientPref: g, nightRun: night };
          const r = scoreCourse(course, prefs);
          if (!Number.isFinite(r.matchScore) || r.matchScore < 0 || r.matchScore > 100.0001) {
            fails.push(`${course.id} t=${target} g=${g} n=${night}: matchScore ${r.matchScore}`);
            break outer;
          }
          // 요소별 원점수(0~1)·가중 기여분도 전부 유한해야 한다 —
          // 하나라도 NaN 이면 정렬과 '왜 이 코스' 문구가 흔들린다
          const badF = (r.factors ?? []).find(
            (f) => !Number.isFinite(f.raw) || f.raw < 0 || f.raw > 1.0001 || !Number.isFinite(f.weighted),
          );
          if (badF) {
            fails.push(`${course.id} t=${target} g=${g}: factor ${badF.key} raw=${badF.raw}`);
            break outer;
          }
          const texts = [...(r.reasons ?? []), ...(r.cautions ?? [])];
          if (texts.some((t) => typeof t !== 'string' || /NaN|undefined|Infinity/.test(t))) {
            fails.push(`${course.id} t=${target}: 문구 오염 — ${texts.find((t) => /NaN|undefined|Infinity/.test(t))}`);
            break outer;
          }
        }
      }
    }
  }
  // recommend 정렬 안정성 — 어떤 조합에서도 던지지 않고 14개 전부 반환
  for (let target = 1; target <= 15 && !fails.length; target++) {
    const rs = recommend(COURSES, { ...defaultPreferences(), targetDistanceKm: target });
    if (rs.length !== COURSES.length) fails.push(`recommend t=${target}: ${rs.length}개 반환`);
  }
  check(fails.length === 0, `1,260가지 조합 전부 — 점수 0~100·문구 무오염·전체 반환${fails.length ? ' — ' + fails[0] : ''}`);
}

// ── 5) 포맷 함수 극단값 ─────────────────────────────────────────────────
console.log('\n[전수] 포맷 — 극단값에서 NaN·undefined 문자열이 안 나온다');
{
  let fails = [];
  const distances = [0, 0.001, 0.05, 0.949, 0.95, 1, 9.999, 42.195, 100, 500];
  const paces = [90, 91, 240, 599, 600, 1799, 1800];
  const secs = [0, 1, 59, 60, 3599, 3600, 86399, 359999];
  for (const d of distances) {
    const s = formatDistance(d);
    if (/NaN|undefined|Infinity/.test(s)) fails.push(`formatDistance(${d}) = ${s}`);
    for (const p of paces) {
      const t = estimateTimeLabel(d, p);
      if (/NaN|undefined|Infinity/.test(t)) fails.push(`estimateTimeLabel(${d},${p}) = ${t}`);
    }
  }
  for (const p of paces) {
    const s = formatPace(p);
    if (/NaN|undefined|Infinity/.test(s)) fails.push(`formatPace(${p}) = ${s}`);
  }
  for (const s0 of secs) {
    for (const f of [formatDuration, formatClock]) {
      const s = f(s0);
      if (/NaN|undefined|Infinity/.test(s)) fails.push(`${f.name}(${s0}) = ${s}`);
    }
  }
  // sanePace 는 쓰레기 입력을 null 로 걸러야 한다
  for (const junk of [NaN, Infinity, -1, 0, 89, 1801, null, undefined]) {
    if (sanePace(junk) !== null) fails.push(`sanePace(${junk}) 가 null 이 아님`);
  }
  check(fails.length === 0, `거리 10 × 페이스 7 × 시간 8 격자 + 쓰레기 페이스 8종 전부 깨끗${fails.length ? ' — ' + fails[0] : ''}`);
}

console.log(`\n결과: ${ok.length} 통과, ${bad.length} 실패`);
if (bad.length) {
  for (const m of bad) console.log('  ❌ ' + m);
  process.exit(1);
}
