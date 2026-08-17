// 큐레이션 코스 경로점 검증.
//   node scripts/course-path-check.mjs
// 경로점은 '지도에 그릴 선'이자 '라우터에 넘길 경유지'다. 둘 다 깨지지 않게
// 간격·통로 범위·경유지 상한을 여기서 못박는다.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cp-'));
const bundle = async (entry, name) => {
  const out = join(dir, name);
  await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile: out, logLevel: 'error' });
  return import(out);
};

const { COURSES } = await bundle('src/data/courses.ts', 'c.mjs');
const {
  thinWaypoints,
  haversineMeters,
  pathLengthMeters,
  spurKeptIndices,
  retracedSegmentMask,
  separateRetraced,
} = await bundle('src/lib/geo.ts', 'g.mjs');
const { courseLaps, lapDistanceKm } = await bundle('src/lib/types.ts', 't.mjs');
const { ringRoundTrip } = await bundle('src/lib/routing.ts', 'r.mjs');
const { coloredSegments, coloredSegmentsUpTo, displayCoords, retraceInfo } =
  await bundle('src/lib/routeColor.ts', 'rc.mjs');
const { advanceProgress, cumulativeMeters } = await bundle('src/lib/routeProgress.ts', 'rp.mjs');

const ok = [];
const bad = [];
const check = (c, m) => {
  (c ? ok : bad).push(m);
  console.log((c ? '  ✅ ' : '  ❌ ') + m);
};

// 앱이 실제로 라우터에 넘기는 경유지 (CourseDetailSheet 와 같은 규칙)
const effective = (course) =>
  course.loopType === 'loop'
    ? [...course.path, course.path[0]]
    : course.loopType === 'out-and-back'
      ? [...course.path, ...course.path.slice(0, -1).reverse()]
      : course.path;

// 서울 행정구역을 넉넉히 감싸는 상자
const SEOUL = { latMin: 37.41, latMax: 37.70, lngMin: 126.76, lngMax: 127.19 };
const MAX_SEG_M = 150;
const ORS_MAX_WAYPOINTS = 50;

console.log('\n[경로점] 간격 · 통로 범위');
for (const c of COURSES) {
  const eff = effective(c);
  const segs = eff.slice(1).map((p, i) => haversineMeters(eff[i], p));
  const maxSeg = Math.max(...segs);
  check(
    maxSeg <= MAX_SEG_M,
    `${c.id}: 최대 경로점 간격 ${Math.round(maxSeg)}m ≤ ${MAX_SEG_M}m`,
  );
  check(c.path.length >= 12, `${c.id}: 경로점 ${c.path.length}개 ≥ 12개`);
  const out = c.path.filter(
    ([la, ln]) => la < SEOUL.latMin || la > SEOUL.latMax || ln < SEOUL.lngMin || ln > SEOUL.lngMax,
  );
  check(out.length === 0, `${c.id}: 모든 경로점이 서울 범위 안`);
  const dup = eff.slice(1).filter((p, i) => haversineMeters(eff[i], p) < 1).length;
  check(dup === 0, `${c.id}: 겹치는 연속 경로점 없음`);
}

console.log('\n[경로점] 표기 거리 대비 통로 길이');
// 하천·강변·철길은 통로가 곧게 이어져 표기 거리를 채울 수 있다.
// 공원 순환로는 실제 공원 크기가 상한이라 한 바퀴로는 못 채운다 —
// 여기서는 '공원 밖으로 부풀리지 않았는지'를 상한으로 확인한다.
const LINEAR = new Set([
  'banpo-hangang', 'yeouido-hangang', 'ttukseom-hangang', 'cheonggyecheon',
  'yangjaecheon', 'tancheon', 'jamsil-hangang', 'gyeongui-forest',
]);
for (const c of COURSES) {
  const km = pathLengthMeters(effective(c)) / 1000;
  const ratio = km / c.distanceKm;
  if (LINEAR.has(c.id)) {
    check(ratio >= 0.95 && ratio <= 1.05, `${c.id}: 통로 ${km.toFixed(2)}km ≒ 표기 ${c.distanceKm}km (비 ${ratio.toFixed(2)})`);
  } else {
    check(ratio > 0.4 && ratio <= 1.0, `${c.id}: 순환 통로 ${km.toFixed(2)}km, 표기 ${c.distanceKm}km 를 넘지 않음 (비 ${ratio.toFixed(2)})`);
  }
}

console.log('\n[경유지 상한] 촘촘한 경로가 라우터 요청을 죽이지 않는다');
for (const c of COURSES) {
  const eff = effective(c);
  const sent = thinWaypoints(eff, ORS_MAX_WAYPOINTS);
  check(sent.length <= ORS_MAX_WAYPOINTS, `${c.id}: ORS 로 ${eff.length}개 → ${sent.length}개 (상한 ${ORS_MAX_WAYPOINTS})`);
  check(
    sent[0][0] === eff[0][0] && sent[0][1] === eff[0][1] &&
      sent[sent.length - 1][0] === eff[eff.length - 1][0] &&
      sent[sent.length - 1][1] === eff[eff.length - 1][1],
    `${c.id}: 솎아도 시작·끝 경유지는 그대로`,
  );
}

console.log('\n[솎기] 경계 조건');
const seq = Array.from({ length: 10 }, (_, i) => [37.5 + i * 0.001, 127.0]);
check(thinWaypoints(seq, 20) === seq, '상한 이하면 원본을 그대로 돌려준다');
check(thinWaypoints(seq, 4).length === 4, '상한을 넘으면 정확히 상한 개수');
check(thinWaypoints(seq, 2).length === 2 && thinWaypoints(seq, 2)[1] === seq[9], '상한 2 면 시작·끝만');
check(new Set(thinWaypoints(seq, 7).map(String)).size === 7, '솎은 결과에 중복 없음');
// 왕복 배열은 반환점 대칭이라 균등 선별이 같은 좌표를 연달아 고를 수 있다
// (예: 19점 배열을 10개로 솎으면 인덱스 8·10 이 연속 선택되는데 둘 다 같은 점이다)
const sym = [...seq, ...seq.slice(0, -1).reverse()];
{
  let dupTotal = 0;
  for (let m = 4; m <= 16; m++) {
    const t = thinWaypoints(sym, m);
    dupTotal += t.slice(1).filter((p, i) => p[0] === t[i][0] && p[1] === t[i][1]).length;
  }
  check(dupTotal === 0, '왕복 대칭 배열을 4~16개로 솎아도 연속 중복 없음');
}

// ── 곁가지(spur) 다듬기 ──────────────────────────────────────────────────
// 거리 모드는 고리 정점을 기하학적으로 찍어 그 점들을 반드시 지나게 한다.
// 정점이 막다른 골목에 스냅되면 라우터가 들어갔다 되돌아 나와 지도에 돌기가
// 생긴다. 실제 경로를 못 부르므로 합성 좌표로 판별기를 검증한다.
console.log('\n[곁가지] 되돌아 나오는 돌기만 걷어낸다');
const LAT = 1 / 111195, LNG = 1 / 88320;
const P = (xm, ym) => [37.5 + ym * LAT, 127.0 + xm * LNG];
const line = (x0, x1, step = 10) => {
  const o = [];
  for (let x = x0; step > 0 ? x <= x1 : x >= x1; x += step) o.push(P(x, 0));
  return o;
};
const lenOf = (pts, idx) => Math.round(pathLengthMeters(idx.map((i) => pts[i])));

// 곧은 길 중간에 60m 곁가지
const spur = [...line(0, 200)];
for (let y = 10; y <= 60; y += 10) spur.push(P(200, y));
for (let y = 50; y >= 0; y -= 10) spur.push(P(200, y));
spur.push(...line(210, 400));
const k1 = spurKeptIndices(spur);
check(k1.length < spur.length, `60m 곁가지를 걷어낸다 (${spur.length} → ${k1.length}점)`);
check(
  Math.abs(lenOf(spur, k1) - 400) <= 20,
  `걷어낸 뒤 길이가 본선과 같다 (${Math.round(pathLengthMeters(spur))}m → ${lenOf(spur, k1)}m, 본선 400m)`,
);

// 블록 한 바퀴 — 고리는 남아야 한다
const blk = [...line(0, 100)];
for (let y = 10; y <= 100; y += 10) blk.push(P(100, y));
for (let x = 90; x >= 0; x -= 10) blk.push(P(x, 100));
for (let y = 90; y >= 0; y -= 10) blk.push(P(0, y));
blk.push(...line(10, 200));
check(spurKeptIndices(blk).length === blk.length, '100m 블록 한 바퀴는 그대로 둔다 (고리는 곁가지가 아니다)');

// 왕복 코스 반환점 — 되짚기지만 너무 길다
const ob = [...line(0, 1000), ...line(990, 0, -10)];
check(spurKeptIndices(ob).length === ob.length, '왕복 코스 1km 반환점은 그대로 둔다');

// 사용자 핀 보호
check(
  spurKeptIndices(spur, { protect: [P(200, 60)] }).length === spur.length,
  '곁가지 끝에 사용자 핀이 있으면 그대로 둔다 (막다른 길 핀은 의도된 것)',
);

// 곁가지 없는 길은 손대지 않는다
const straight = line(0, 500);
check(spurKeptIndices(straight).length === straight.length, '곁가지 없는 길은 손대지 않는다');

// 연속된 곁가지 2개
const two = [...line(0, 100)];
for (let y = 10; y <= 40; y += 10) two.push(P(100, y));
for (let y = 30; y >= 0; y -= 10) two.push(P(100, y));
two.push(...line(110, 200));
for (let y = -10; y >= -40; y -= 10) two.push(P(200, y));
for (let y = -30; y <= 0; y += 10) two.push(P(200, y));
two.push(...line(210, 300));
const k6 = spurKeptIndices(two);
check(lenOf(two, k6) <= 320, `연속된 곁가지 2개를 모두 걷어낸다 (${Math.round(pathLengthMeters(two))}m → ${lenOf(two, k6)}m, 본선 300m)`);

// 예전 판별기가 놓치던 경우들 ─────────────────────────────────────────
// 모퉁이에서 생긴 돌기: 앞뒤 본선 방위가 90도 차이라 '방위 비교'로는 빠졌다
const corner = [...line(0, 200)];
for (let x = 210; x <= 260; x += 10) corner.push(P(x, 0));
for (let x = 250; x >= 210; x -= 10) corner.push(P(x, 0));
for (let y = 10; y <= 200; y += 10) corner.push(P(200, y));
const kc = spurKeptIndices(corner);
check(kc.length < corner.length, `모퉁이 돌기를 걷어낸다 (${corner.length} → ${kc.length}점)`);
check(
  Math.abs(lenOf(corner, kc) - 400) <= 25,
  `모퉁이 돌기 제거 후 본선만 남는다 (${Math.round(pathLengthMeters(corner))}m → ${lenOf(corner, kc)}m, 본선 400m)`,
);

// 180m 돌기: 예전 상한(120m)을 넘어 빠져나갔다
const long = [...line(0, 200)];
for (let y = 10; y <= 180; y += 10) long.push(P(200, y));
for (let y = 170; y >= 0; y -= 10) long.push(P(200, y));
long.push(...line(210, 400));
const kl = spurKeptIndices(long);
check(
  Math.abs(lenOf(long, kl) - 400) <= 20,
  `180m 돌기를 걷어낸다 (${Math.round(pathLengthMeters(long))}m → ${lenOf(long, kl)}m, 본선 400m)`,
);

// 막다른 길 끝 회차 공간을 한 바퀴 돌고 나오는 돌기 — 순수 되짚기가 아니다
const bulb = [...line(0, 200)];
for (let y = 10; y <= 80; y += 10) bulb.push(P(200, y));
for (const [dx, dy] of [[14, 90], [20, 100], [14, 110], [0, 114], [-14, 110], [-20, 100], [-14, 90]])
  bulb.push(P(200 + dx, dy));
for (let y = 80; y >= 0; y -= 10) bulb.push(P(200, y));
bulb.push(...line(210, 400));
const kb = spurKeptIndices(bulb);
check(
  Math.abs(lenOf(bulb, kb) - 400) <= 30,
  `회차 공간이 달린 돌기를 걷어낸다 (${Math.round(pathLengthMeters(bulb))}m → ${lenOf(bulb, kb)}m, 본선 400m)`,
);

// 왕복 코스의 '돌아오는 구간'에 붙은 돌기 — 반환점은 남기고 돌기만 걷어낸다
const onReturn = [...line(0, 600), ...line(590, 300, -10)];
for (let y = 10; y <= 50; y += 10) onReturn.push(P(300, y));
for (let y = 40; y >= 0; y -= 10) onReturn.push(P(300, y));
onReturn.push(...line(290, 0, -10));
const kr = spurKeptIndices(onReturn);
check(
  Math.abs(lenOf(onReturn, kr) - 1200) <= 25,
  `돌아오는 구간의 돌기만 걷어내고 반환점은 남긴다 (${Math.round(pathLengthMeters(onReturn))}m → ${lenOf(onReturn, kr)}m, 왕복 1200m)`,
);

// 끝점은 언제나 남는다
for (const [name, pts] of [
  ['곁가지', spur], ['블록', blk], ['왕복', ob], ['2개', two],
  ['모퉁이', corner], ['180m', long], ['회차공간', bulb], ['복귀구간', onReturn],
]) {
  const k = spurKeptIndices(pts);
  check(k[0] === 0 && k[k.length - 1] === pts.length - 1, `${name}: 시작·끝 좌표는 언제나 남는다`);
}

// ── 같은 길 왕복 표시 ────────────────────────────────────────────────────
// 갔다 오는 구간은 선이 정확히 겹쳐 나중 선이 앞선 선을 덮는다. 겹침을 찾아
// 좌우로 벌려 그리는 게 목적이므로, 무엇을 겹침으로 볼지부터 못박는다.
console.log('\n[같은 길 왕복] 겹치는 구간을 찾아 좌우로 벌린다');
const straightLine = line(0, 500);
check(
  !retracedSegmentMask(straightLine).some(Boolean),
  '한 번만 지나는 곧은 길에는 겹침이 없다',
);

const back = [...line(0, 500), ...line(490, 0, -10)];
const backMask = retracedSegmentMask(back);
const backRatio = backMask.filter(Boolean).length / backMask.length;
check(backRatio > 0.9, `왕복 코스는 거의 전 구간이 겹침 (${Math.round(backRatio * 100)}%)`);

// 블록 한 바퀴는 서로 다른 길이라 겹치지 않는다
const ring = [];
for (let x = 0; x <= 200; x += 10) ring.push(P(x, 0));
for (let y = 10; y <= 200; y += 10) ring.push(P(200, y));
for (let x = 190; x >= 0; x -= 10) ring.push(P(x, 200));
for (let y = 190; y >= 0; y -= 10) ring.push(P(0, y));
check(!retracedSegmentMask(ring).some(Boolean), '사각 순환로는 겹침으로 보지 않는다');

// 벌린 뒤 두 방향이 서로 반대쪽에 놓인다
const sep = separateRetraced(back, backMask, 7);
const outIdx = 30; //         가는 길 x=300
const inIdx = back.length - 1 - 30; // 오는 길 x=300
check(
  haversineMeters(back[outIdx], back[inIdx]) < 1,
  '벌리기 전에는 두 방향이 같은 자리에 겹쳐 있다',
);
const gap = haversineMeters(sep[outIdx], sep[inIdx]);
check(gap > 10 && gap < 18, `벌린 뒤 두 방향이 ${gap.toFixed(1)}m 떨어진다 (밀어낸 양 7m × 2)`);
check(
  Math.abs(pathLengthMeters(sep) - pathLengthMeters(back)) < 5,
  '좌우로 벌려도 경로 길이는 그대로다 (그리기용 좌표일 뿐)',
);
check(
  separateRetraced(straightLine, retracedSegmentMask(straightLine), 7) === straightLine,
  '겹침이 없으면 좌표를 그대로 돌려준다',
);

// 좌표가 수천 개인 경로에서도 느려지지 않아야 한다 (격자 없이 전부 비교하면 O(n²))
const big = [];
for (let x = 0; x <= 6000; x += 4) big.push(P(x, 0));
for (let x = 5996; x >= 0; x -= 4) big.push(P(x, 0));
const t0 = Date.now();
retracedSegmentMask(big);
const ms = Date.now() - t0;
check(ms < 400, `좌표 ${big.length}개 겹침 판정 ${ms}ms (< 400ms)`);

// ── 러닝 화면 그리기 정합 ────────────────────────────────────────────────
// 지나온 구간(경사 색)과 남은 구간(점선)은 같은 그리기 좌표에서 잘라야 한다.
// 다른 좌표를 쓰면 왕복 반환점 이후 러너 발밑에서 두 선이 7m 어긋난다.
console.log('\n[러닝 화면] 지나온 선과 남은 점선이 같은 기하 위에 있다');
{
  const coords = [...line(0, 600), ...line(590, 0, -10)];
  const fakeRoute = {
    coords,
    segments: coords.slice(1).map((_, i) => ({ gradePct: i < 60 ? 1 : 6, lengthM: 10 })),
  };
  const disp = displayCoords(fakeRoute);
  check(disp.length === coords.length, '그리기 좌표는 원본과 1:1 (idx 슬라이스가 성립하는 전제)');
  check(
    retraceInfo(fakeRoute).km > 1.0,
    `왕복 코스의 겹침 길이를 잰다 (${retraceInfo(fakeRoute).km.toFixed(2)}km)`,
  );

  const full = coloredSegments(fakeRoute);
  const upToAll = coloredSegmentsUpTo(fakeRoute, fakeRoute.segments.length);
  const flat = (gs) => gs.flatMap((g) => g.positions.map(String)).join('|');
  check(flat(full) === flat(upToAll), 'coloredSegmentsUpTo(전체) = coloredSegments');

  // 접두사의 끝점 = 남은 점선의 시작점 (러너 위치에서 두 선이 만난다)
  for (const k of [10, 61, 90]) {
    const prefix = coloredSegmentsUpTo(fakeRoute, k);
    const lastGroup = prefix[prefix.length - 1];
    const lastPt = lastGroup.positions[lastGroup.positions.length - 1];
    const remainStart = disp[k];
    check(
      lastPt[0] === remainStart[0] && lastPt[1] === remainStart[1],
      `idx=${k}: 지나온 선 끝 = 남은 점선 시작`,
    );
  }
  check(coloredSegmentsUpTo(fakeRoute, 0).length === 0, 'idx=0 이면 지나온 선이 없다');
}

// ── 크래시 방어 — 던지는 브라우저 API·손상된 시각 ───────────────────────
console.log('\n[크래시 방어] 음성 합성이 던져도 러닝 틱은 계속된다');
{
  // 일부 안드로이드 WebView 흉내: speechSynthesis 는 있는데 뭘 하든 던진다
  globalThis.speechSynthesis = {
    cancel() { throw new Error('webview cancel fail'); },
    speak() { throw new Error('webview speak fail'); },
    resume() { throw new Error('webview resume fail'); },
    getVoices() { throw new Error('webview voices fail'); },
    addEventListener() {},
  };
  globalThis.SpeechSynthesisUtterance = class { constructor() { throw new Error('webview utterance fail'); } };
  // node 에는 document 가 없다 — 브라우저 흉내이므로 최소 스텁을 둔다
  globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
  const { initVoiceNav, tickVoiceNav } = await bundle('src/lib/voiceNav.ts', 'vn.mjs');
  const navPts = [];
  for (let m = 0; m <= 1000; m += 20) navPts.push([37.5 + m * LAT, 127.0]);
  const navCum = cumulativeMeters(navPts);
  let threw = false;
  try {
    let st = initVoiceNav(navPts, navCum);
    let ni = 0;
    for (let m = 0; m <= 1000; m += 50) {
      while (ni + 1 < navPts.length && navCum[ni + 1] <= m) ni++;
      st = tickVoiceNav(st, ni, navCum, m / 1000, 1, [37.5 + m * LAT, 127.0], navPts);
    }
  } catch (e) {
    threw = true;
  }
  check(!threw, '던지는 speechSynthesis 스텁에서도 initVoiceNav/tickVoiceNav 가 예외 없이 완주');
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
  delete globalThis.document;
}

console.log('\n[크래시 방어] 손상된 시각이 GPX 내보내기를 죽이지 않는다');
{
  const { buildGpx } = await bundle('src/lib/gpx.ts', 'gx.mjs');
  const coords = [[37.5, 127.0], [37.501, 127.0], [37.502, 127.0]];
  let gpx = null;
  try {
    gpx = buildGpx({
      name: '테스트',
      coords,
      elevations: [10, 11, 12],
      times: [Date.now(), NaN, Date.now() + 2000], // 가운데가 손상
    });
  } catch { /* threw */ }
  check(gpx != null, 'NaN 시각이 섞여도 buildGpx 가 던지지 않는다');
  // metadata 의 내보내기 시각은 별개다 — 좌표(trkpt)에 붙은 time 만 센다
  const trkptTimes = gpx == null ? 0 : (gpx.match(/trkpt[^\n]*<time>/g) ?? []).length;
  check(trkptTimes === 2, `손상된 시각만 빠지고 나머지 2개는 남는다 (trkpt time ${trkptTimes}개)`);
  check(gpx != null && !gpx.includes('NaN'), 'GPX 본문에 NaN 이 없다');
}

// ── 음성 안내 시퀀스 ─────────────────────────────────────────────────────
// 발화를 녹음하는 스텁으로 러닝 전체를 시뮬레이션해, 어떤 안내가 나오고
// 어떤 안내가 안 나와야 하는지를 문장 단위로 못박는다.
console.log('\n[음성 안내] 엔진 제어 — 말하고 있을 때만 끊는가');
{
  const calls = [];
  let speaking = false;
  globalThis.speechSynthesis = {
    speak(u) { calls.push(['speak', u.text]); u.onend?.(); },
    cancel() { calls.push(['cancel']); },
    resume() {},
    getVoices() { return []; },
    addEventListener() {},
    get speaking() { return speaking; },
    get pending() { return false; },
  };
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
  const V = await bundle('src/lib/voiceNav.ts', 'vn0.mjs');

  // 조용한 상태에서 급한 안내 — 끊을 게 없으니 cancel 을 부르지 않는다.
  // (크롬 계열은 cancel 직후 같은 틱의 speak 를 통째로 삼키는 일이 있다)
  V.initVoiceNav([], [0]);
  calls.length = 0;
  speaking = false;
  V.announce('테스트', { urgent: true });
  check(!calls.some((c) => c[0] === 'cancel'), '조용할 때는 cancel 을 부르지 않는다');
  check(calls.some((c) => c[0] === 'speak'), '조용할 때도 발화는 나간다');

  // 엔진을 여는 첫마디(primeVoice)가 가장 중요하다 — 이게 삼켜지면 그 러닝
  // 전체가 무음이 된다. 여기서도 불필요한 cancel 을 부르지 않아야 한다.
  calls.length = 0;
  speaking = false;
  check(V.primeVoice('출발합니다') === true, '프라임 발화가 나간다');
  check(!calls.some((c) => c[0] === 'cancel'), '프라임: 조용할 때 cancel 을 부르지 않는다');
  check(calls.some((c) => c[1] === '출발합니다'), "프라임 문구는 '출발합니다'");

  // 말하고 있을 때는 끊고 급한 말을 먼저 낸다
  calls.length = 0;
  speaking = true;
  V.announce('급한 안내', { urgent: true });
  const ci = calls.findIndex((c) => c[0] === 'cancel');
  const si = calls.findIndex((c) => c[0] === 'speak');
  check(ci >= 0 && si > ci, '말하는 중이면 끊고 나서 말한다 (순서 유지)');
}

console.log('\n[음성 안내] 음성이 러닝을 막지 않는가');
{
  // primeVoice 는 START 버튼 핸들러에서 불린다. 여기서 예외가 새면 뒤따르는
  // onStart() 가 실행되지 않아 기록 자체가 시작되지 않는다. 일부 안드로이드
  // WebView 는 speechSynthesis 객체는 주면서 getVoices/speak 에서 던진다.
  const boom = () => { throw new Error('WebView 고장'); };
  const cases = [
    ['speak 가 던짐', { speak: boom, cancel() {}, resume() {}, getVoices: () => [], addEventListener() {} }],
    ['getVoices 가 던짐', { speak() {}, cancel() {}, resume() {}, getVoices: boom, addEventListener() {} }],
    ['addEventListener 가 던짐', { speak() {}, cancel() {}, resume() {}, getVoices: () => [], addEventListener: boom }],
    ['cancel 이 던짐', { speak() {}, cancel: boom, resume() {}, getVoices: () => [], addEventListener() {}, speaking: true }],
    ['전부 던짐', { speak: boom, cancel: boom, resume: boom, getVoices: boom, addEventListener: boom, speaking: true }],
  ];
  let threw = 0;
  for (const [label, stub] of cases) {
    globalThis.speechSynthesis = stub;
    globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
    const V = await bundle('src/lib/voiceNav.ts', `vn-boom-${threw}.mjs`);
    try {
      // 러닝 화면이 실제로 밟는 두 경로 — effect(initVoiceNav)와 탭(primeVoice)
      V.initVoiceNav([], [0]);
      V.primeVoice('출발합니다');
    } catch {
      threw++;
      console.log(`     · ${label} 에서 예외가 새어 나왔다`);
    }
  }
  // document.addEventListener 가 던지는 환경 — 실측에서 START 를 막던 경로
  {
    globalThis.speechSynthesis = { speak() {}, cancel() {}, resume() {}, getVoices: () => [], addEventListener() {} };
    globalThis.document = { addEventListener: boom, visibilityState: 'visible' };
    const V = await bundle('src/lib/voiceNav.ts', 'vn-boom-doc.mjs');
    try {
      V.initVoiceNav([], [0]);
      V.primeVoice('출발합니다');
    } catch {
      threw++;
      console.log('     · document.addEventListener 가 던질 때 예외가 새어 나왔다');
    }
  }
  check(threw === 0, `음성 엔진·문서가 던져도 음성 준비가 예외를 안 낸다 (${cases.length + 1}가지)`);
}

console.log('\n[음성 안내] 왕복·순환·자유 러닝 발화 시퀀스');
{
  const texts = [];
  globalThis.speechSynthesis = {
    // 실제 브라우저처럼 발화가 끝난다 — 안 끝내면 큐 상한(2)에 걸려
    // 뒤 안내가 전부 굶는, 현실에 없는 상태를 검사하게 된다
    speak(u) { texts.push(u.text); u.onend?.(); },
    cancel() {}, resume() {},
    getVoices() { return []; },
    addEventListener() {},
  };
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
  const { initVoiceNav, tickVoiceNav } = await bundle('src/lib/voiceNav.ts', 'vn2.mjs');

  // 시뮬레이터 — 경로를 20m 틱으로 끝까지 뛴다 (활성 시간 6분/km)
  const drive = (coords, cum, totalM) => {
    let st = initVoiceNav(coords, cum);
    for (let i = 0; i < coords.length; i++) {
      const distKm = cum[i] / 1000;
      st = tickVoiceNav(st, i, cum, distKm, totalM, coords[i], coords, distKm * 360);
    }
    return st;
  };

  // 1) 왕복 3km — ㄱ자로 꺾여 나갔다 같은 길로 복귀 (반환점 = 유턴 지점)
  const out = [];
  for (let m = 0; m <= 900; m += 20) out.push(P(m, 0));
  for (let m = 20; m <= 600; m += 20) out.push(P(900, m));
  const ob = [...out, ...out.slice(0, -1).reverse()];
  const obCum = cumulativeMeters(ob);
  texts.length = 0;
  drive(ob, obCum, obCum[obCum.length - 1]);
  const obTexts = [...texts];
  check(obTexts.some((t) => t.includes('왔던 길로 되돌아갑니다')), '왕복: 되돌아간다는 예고가 나온다');
  // '출발합니다' 는 START 탭에서 한 번만 나온다. tick 이 또 말하면 같은 말이
  // 세 번 나오고, 그중 둘은 이미 뛰기 시작한 뒤라 뒷북이다.
  check(!obTexts.some((t) => t.includes('출발')), '따라 뛰기: 출발 인사가 겹치지 않는다');
  check(
    obTexts.some((t) => t.includes('경로 안내를 시작합니다')),
    '따라 뛰기: 경로 안내 시작 예고가 나온다',
  );
  check(obTexts.some((t) => t.includes('여기서 돌아서')), '왕복: 되돌아갈 지점에 도착하면 그렇게 말한다');
  // 지점에 이름을 붙이지 않는다 — '반환점'·'유턴' 은 처음 듣는 사람에게 늦게 온다
  check(!obTexts.some((t) => t.includes('반환점')), "왕복: '반환점' 이라는 말을 쓰지 않는다");
  check(!obTexts.some((t) => t.includes('유턴')), '왕복: 되돌아가는 지점을 유턴이라 부르지 않는다');
  check(!obTexts.some((t) => t.includes('절반')), '왕복: 되돌아가기 안내와 겹치는 절반 안내는 없다');
  check(
    obTexts.some((t) => /킬로미터 완료. 지난 1킬로미터 \d+분/.test(t)),
    'km 이정표에 지난 1km 페이스가 붙는다',
  );
  check(obTexts.some((t) => t.includes('마지막 500미터')), '마지막 500미터 안내');
  check(obTexts.filter((t) => t.includes('완주')).length === 1, '완주 안내 한 번');

  // 1-b) 경로 이탈 → 복귀. 이어폰만 끼고 뛰는 사람에게는 이게 유일한 신호다.
  {
    texts.length = 0;
    let st = initVoiceNav(ob, obCum);
    // 경로 위를 조금 달리다 옆으로 크게 벗어난 뒤 되돌아온다
    for (let i = 0; i < 12; i++) st = tickVoiceNav(st, i, obCum, obCum[i] / 1000, obCum[obCum.length - 1], ob[i], ob, 60);
    const off = P(220, 400); // 경로에서 400m 옆
    for (let k = 0; k < 6; k++) st = tickVoiceNav(st, 11, obCum, 0.22, obCum[obCum.length - 1], off, ob, 70);
    check(texts.some((t) => t.includes('벗어났어요')), '이탈하면 알려준다');
    const before = texts.length;
    for (let i = 12; i < 20; i++) st = tickVoiceNav(st, i, obCum, obCum[i] / 1000, obCum[obCum.length - 1], ob[i], ob, 80);
    check(texts.slice(before).some((t) => t.includes('경로로 돌아왔어요')), '복귀하면 알려준다');
  }

  // 1-c) 모양·점 간격을 바꿔가며 — 되돌아가기 안내가 정확히 한 번만 나오는가.
  //
  // 예전엔 점 간격에 따라 깨졌다. 갔던 길을 그대로 되짚는 구간에서는
  // 반환 지점 20m 앞의 점과 20m 뒤의 점이 물리적으로 같은 자리라,
  // 그 둘로 잰 방위각(bearingDeg 는 같은 점에 0을 준다)이 유령 턴을 만들고
  // 정작 180° 유턴을 밀어냈다 — 간격 25m 직선 왕복에서 '반환점' 대신
  // '크게 좌회전' 이 두 번 나갔다. 간격은 라우터·다운샘플링에 따라 달라지므로
  // 한 값만 보고 넘어갈 수 없다.
  {
    let bad = 0;
    let total = 0;
    const trial = (coords, wantBack) => {
      texts.length = 0;
      const cum = cumulativeMeters(coords);
      const totalM = cum[cum.length - 1];
      let st = initVoiceNav(coords, cum);
      for (let i = 0; i < coords.length; i++) {
        st = tickVoiceNav(st, i, cum, cum[i] / 1000, totalM, coords[i], coords, (cum[i] / 1000) * 360);
      }
      const back = texts.filter((t) => t.includes('여기서 돌아서')).length;
      const uturn = texts.filter((t) => t.includes('유턴')).length;
      total++;
      if (back !== (wantBack ? 1 : 0) || uturn !== 0) bad++;
    };
    for (const step of [8, 10, 12, 15, 20, 25, 30, 35, 40, 50, 60, 75, 100]) {
      // 직선 왕복 — 한강 산책로처럼 곧게 갔다 그대로 돌아오는 모양
      const a = [];
      for (let m = 0; m <= 1200; m += step) a.push(P(m, 0));
      trial([...a, ...a.slice(0, -1).reverse()], true);
      // 굽은 왕복 — 곡선 산책로
      const c = [];
      for (let m = 0; m <= 1000; m += step) c.push(P(m, Math.sin(m / 200) * 120));
      trial([...c, ...c.slice(0, -1).reverse()], true);
      // 원형 링 — 빌더의 '왕복' 이 만드는 기본 모양. 되돌아가지 않는다
      const ring = [];
      const n = Math.max(12, Math.round((2 * Math.PI * 400) / step));
      for (let k = 0; k <= n; k++) {
        const t = (2 * Math.PI * k) / n;
        ring.push(P(400 * Math.cos(t), 400 * Math.sin(t)));
      }
      trial(ring, false);
      // 편도 — 돌아오지 않는다
      const ow = [];
      for (let m = 0; m <= 1500; m += step) ow.push(P(m, m * 0.3));
      trial(ow, false);
    }
    check(bad === 0, `모양·간격 ${total}가지에서 되돌아가기 안내가 정확히 한 번 (실패 ${bad})`);
  }

  // 1-d) 직진 안내가 제자리에만 나오는가.
  //
  // 예전엔 다음 턴을 찾을 때 150m 안쪽 턴을 건너뛰고 그 다음 턴까지의
  // 거리를 재서, 정작 100m 앞에 턴이 있을 때 '쭉 직진하세요' 가 나갔다 —
  // "150미터 앞 왔던 길로 되돌아갑니다" 30m 뒤에 "쭉 직진하세요" 가 붙었다.
  // 그리고 남은 턴이 없는 순환로에서도 500m 마다 되풀이해, 2.5km 에서
  // 발화 12개 중 5개가 이 문장이었다.
  {
    // (a) 턴 예고와 턴 사이에는 직진 안내가 끼지 않는다
    // 예고 거리는 반올림에 따라 140/150m 로 갈리므로 숫자를 못박지 않는다
    const warnIdx = obTexts.findIndex((t) => /\d+미터 앞 왔던 길로/.test(t));
    const doneIdx = obTexts.findIndex((t) => t.includes('여기서 돌아서'));
    const between = warnIdx >= 0 && doneIdx > warnIdx ? obTexts.slice(warnIdx, doneIdx) : [];
    check(
      between.length > 0 && !between.some((t) => t.includes('쭉 직진')),
      '되돌아가기 예고와 실행 사이에 직진 안내가 끼지 않는다',
    );

    // (b) 턴이 하나도 없는 순환로에서는 직진 안내를 되풀이하지 않는다
    texts.length = 0;
    const ring = [];
    const n = 64;
    for (let k = 0; k <= n; k++) {
      const t = (2 * Math.PI * k) / n;
      ring.push(P(400 * Math.cos(t), 400 * Math.sin(t)));
    }
    const rc = cumulativeMeters(ring);
    drive(ring, rc, rc[rc.length - 1]);
    const straight = texts.filter((t) => t.includes('쭉 직진')).length;
    check(straight <= 1, `턴 없는 순환로에서 직진 안내 ${straight}회 (1회 이하)`);
  }

  // 2) 순환 2.4km (사각 링) — 반환점이 없으니 절반 안내가 나온다
  const ring2 = [];
  for (let m = 0; m <= 600; m += 20) ring2.push(P(m, 0));
  for (let m = 20; m <= 600; m += 20) ring2.push(P(600, m));
  for (let m = 580; m >= 0; m -= 20) ring2.push(P(m, 600));
  for (let m = 580; m >= 20; m -= 20) ring2.push(P(0, m));
  ring2.push(P(0, 0));
  const ring2Cum = cumulativeMeters(ring2);
  texts.length = 0;
  drive(ring2, ring2Cum, ring2Cum[ring2Cum.length - 1]);
  check(texts.some((t) => t.includes('절반')), '순환: 절반 안내가 나온다');
  check(!texts.some((t) => t.includes('반환점')), '순환: 반환점 안내는 없다');

  // 3) 자유 러닝 — 경로 없이 거리·시간만. km 이정표(페이스)만 나온다
  texts.length = 0;
  let fs = initVoiceNav([], [0]);
  // 0.25 단위 — 0.05 누적은 이진 오차로 3.00 이 2.999… 가 되어 이정표가 밀린다
  for (let km = 0; km <= 3.1; km += 0.25) {
    fs = tickVoiceNav(fs, 0, [0], km, 0, null, undefined, km * 330);
  }
  const freeKm = texts.filter((t) => /킬로미터 완료/.test(t));
  check(freeKm.length === 3, `자유 러닝: km 이정표 3번 (${freeKm.length}번)`);
  check(
    freeKm.every((t) => t.includes('지난 1킬로미터')),
    '자유 러닝: 이정표마다 구간 페이스가 붙는다',
  );
  check(!texts.some((t) => t.includes('남은 거리')), '자유 러닝: 남은 거리(경로 없음)는 말하지 않는다');
  check(!texts.some((t) => t.includes('완주')), '자유 러닝: 완주 안내 없음');
  // 자유 러닝에는 따라갈 경로가 없으니 tick 은 코스 출발 안내를 하지 않는다.
  // ('출발합니다' 인사는 START 를 누르는 제스처에서 primeVoice 가 한다 —
  //  그건 브라우저 검사(scenario-check)가 확인한다)
  check(!texts.some((t) => t.includes('출발')), '자유 러닝: tick 은 코스 출발 안내를 하지 않는다');

  // 페이스 문구가 실제 시간과 맞는지 — 5분 30초/km 로 뛰었다 (330초)
  check(
    freeKm.every((t) => t.includes('5분 30초')),
    `구간 페이스가 실제 시간과 일치 (5분 30초) — ${freeKm[0] ?? ''}`,
  );

  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
  delete globalThis.document;
}

// ── 따라 뛰기 진행 판정 ──────────────────────────────────────────────────
// 왕복 코스는 가는 길과 오는 길 좌표가 같은 자리에 겹친다. 진행 인덱스가
// 반환점 앞에서 돌아오는 쪽 쌍둥이 점으로 건너뛰면 남은 거리가 순간 붕괴하고
// km 음성 안내가 몰아서 터진다. 러너가 경로를 그대로 따라 뛰는 상황을
// 시뮬레이션해 한 틱 전진 폭을 못박는다.
console.log('\n[따라 뛰기] 왕복 반환점을 건너뛰지 않는다');
{
  const pts = [];
  for (let m = 0; m <= 1500; m += 20) pts.push([37.5 + m * LAT, 127.0]);
  for (let m = 1480; m >= 0; m -= 20) pts.push([37.5 + (m) * LAT, 127.0]);
  const cum = cumulativeMeters(pts);
  let idx = 0;
  let maxJumpM = 0;
  let wentBack = false;
  for (let m = 0; m <= 3000; m += 15) {
    const pos = m <= 1500 ? [37.5 + m * LAT, 127.0] : [37.5 + (3000 - m) * LAT, 127.0];
    const prev = idx;
    idx = advanceProgress(pts, pos, idx);
    if (idx < prev) wentBack = true;
    maxJumpM = Math.max(maxJumpM, cum[idx] - cum[prev]);
  }
  check(!wentBack, '진행 인덱스는 전 구간에서 뒤로 가지 않는다');
  check(
    maxJumpM < 100,
    `한 틱 최대 전진 ${Math.round(maxJumpM)}m < 100m (반환점 건너뛰기 없음 — 수정 전 1200m)`,
  );
  check(idx === pts.length - 1, `왕복 끝까지 완주한다 (idx ${idx}/${pts.length - 1})`);

  // 순환 코스: 출발점과 도착점이 같은 자리 — 출발 직후 도착으로 건너뛰지 않는다
  const ring = [];
  for (let d = 0; d < 360; d += 3) {
    const r = 300;
    ring.push([37.5 + (r * Math.cos((d * Math.PI) / 180) - r) * LAT, 127.0 + r * Math.sin((d * Math.PI) / 180) * (1 / 88320)]);
  }
  ring.push(ring[0]);
  const early = advanceProgress(ring, ring[1], 0);
  check(early < 10, `순환 코스 출발 직후 도착점으로 건너뛰지 않는다 (idx ${early})`);
}

// ── 왕복 루프 거리 보정 ─────────────────────────────────────────────────
// 고리 정점이 막다른 길에 스냅되면 돌기가 생긴다. 그 돌기를 '반지름 보정 뒤'에
// 걷어내면, 보정은 돌기까지 포함한 길이로 목표를 맞춰 놓고 그 뒤에 돌기가
// 빠져 최종 거리가 짧아진다. 실제 라우터를 못 부르므로 돌기를 심은 가짜
// 라우터로 확인한다.
console.log('\n[왕복 루프] 돌기를 걷어낸 뒤에도 목표 거리를 지킨다');
{
  const start = P(0, 0);
  // 고리 둘레를 따라가되, 정점마다 60m 돌기를 하나씩 심는 가짜 라우터
  const fakeRouter = (withSpurs) => async (ring) => {
    const coords = [ring[0]];
    for (let i = 1; i < ring.length; i++) {
      const a = coords[coords.length - 1], b = ring[i];
      const n = Math.max(1, Math.round(haversineMeters(a, b) / 20));
      for (let k = 1; k <= n; k++) {
        coords.push([a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)]);
      }
      if (withSpurs && i < ring.length - 1) {
        // 옆길로 60m 들어갔다 그대로 되돌아 나온다
        const tipLat = b[0] + 60 * LAT;
        for (let y = 10; y <= 60; y += 10) coords.push([b[0] + y * LAT, b[1]]);
        for (let y = 50; y >= 0; y -= 10) coords.push([b[0] + y * LAT, b[1]]);
        void tipLat;
      }
    }
    return { coords };
  };
  for (const targetKm of [3, 5]) {
    const spurred = await ringRoundTrip(fakeRouter(true), start, targetKm, { points: 5 });
    // 사용자가 보는 건 buildResult 가 돌기를 걷어낸 뒤의 거리다. 보정이 돌기를
    // 포함한 길이로 목표를 맞췄다면 여기서 그만큼 줄어든다.
    const kept = spurKeptIndices(spurred.coords, { protect: [start] });
    const finalKm = pathLengthMeters(kept.map((i) => spurred.coords[i])) / 1000;
    const err = Math.abs(finalKm - targetKm) / targetKm;
    check(
      err < 0.05,
      `목표 ${targetKm}km → 돌기 걷어낸 최종 ${finalKm.toFixed(2)}km (오차 ${(err * 100).toFixed(1)}%)`,
    );
  }
}

// ── 바퀴 수 ──────────────────────────────────────────────────────────────
console.log('\n[바퀴 수] 순환 코스만, 실측이 없으면 라우팅 거리로 추정');
for (const c of COURSES) {
  if (c.laps !== undefined) {
    check(
      Number.isInteger(c.laps) && c.laps >= 1,
      `${c.id}: laps 는 1 이상 정수 (${c.laps})`,
    );
    check(c.loopType === 'loop', `${c.id}: laps 는 순환 코스에만 붙는다`);
  }
  // 한 바퀴 × 바퀴 수 = 표기 거리
  const laps = courseLaps(c);
  const lapKm = lapDistanceKm(c);
  check(
    Math.abs(lapKm * laps - c.distanceKm) < 1e-9,
    `${c.id}: 한 바퀴 ${lapKm.toFixed(2)}km × ${laps}바퀴 = 표기 ${c.distanceKm}km`,
  );
}

const loopCourse = COURSES.find((c) => c.loopType === 'loop');
const linearCourse = COURSES.find((c) => c.loopType === 'out-and-back');
check(courseLaps(linearCourse, 1) === 1, '왕복·편도 코스는 라우팅 거리와 무관하게 1바퀴');
check(
  courseLaps({ ...loopCourse, laps: undefined }, loopCourse.distanceKm / 2) === 2,
  '적힌 값이 없으면 라우팅된 한 바퀴 거리로 바퀴 수를 추정한다',
);
check(
  courseLaps({ ...loopCourse, laps: 3 }, loopCourse.distanceKm / 2) === 3,
  '적힌 값이 있으면 추정보다 우선한다',
);
check(courseLaps({ ...loopCourse, laps: undefined }, 0) === 1, '라우팅 거리가 없으면 1바퀴로 본다');
check(courseLaps({ ...loopCourse, laps: undefined }, null) === 1, '라우팅 실패(null)여도 1바퀴');

console.log(`\n결과: ${ok.length} 통과, ${bad.length} 실패`);
if (bad.length) {
  for (const m of bad) console.log('  ❌ ' + m);
  process.exit(1);
}
