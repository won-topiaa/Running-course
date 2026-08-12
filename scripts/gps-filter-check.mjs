// GPS 필터 검증 — 합성 좌표로 '서 있을 때 안 늘어나는지 / 뛸 때 정확한지' 를 잰다.
//   node scripts/gps-filter-check.mjs
// esbuild 로 TS 를 즉석에서 묶어 돌린다(별도 테스트 러너 없이).
// esbuild 는 vite 가 이미 끌고 오는 의존성이라 따로 설치할 게 없다.
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(mkdtempSync(join(tmpdir(), 'gpsf-')), 'b.mjs');
await build({
  entryPoints: ['src/lib/gpsFilter.ts'],
  bundle: true,
  format: 'esm',
  outfile: out,
  logLevel: 'error',
});
const { createGpsFilter } = await import(out);

const LAT0 = 37.5665;
const LNG0 = 126.978;
const MPD_LAT = 111320;
const MPD_LNG = 111320 * Math.cos((LAT0 * Math.PI) / 180);

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
function gaussFrom(rnd) {
  return () => {
    const u = Math.max(1e-9, rnd());
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/**
 * @param name 시나리오 이름
 * @param secs 길이(초, 1Hz)
 * @param speedMs 실제 속도 (m/s)
 * @param sigma 좌표 잡음 표준편차(m, 축당)
 * @param acc 기기가 보고하는 오차 반경(m)
 * @param withDoppler 기기가 speed 를 주는지
 */
function scenario({
  name,
  secs,
  speedMs,
  sigma,
  acc,
  withDoppler = true,
  turnEvery = 0,
  blockM = 0, //     이 거리(m)마다 90도로 꺾는다 (도심 블록)
  circleR = 0,
  zeroSpeed = false,
  dropEvery = 0, //  이 주기(초)마다
  dropLen = 0, //    이만큼 도플러가 0 으로 끊긴다 (도시 협곡)
}) {
  const rnd = seeded(12345);
  const gauss = gaussFrom(rnd);
  const f = createGpsFilter();
  let north = 0;
  let east = 0;
  let heading = 0;
  let dist = 0;
  let accepted = 0;
  let flickers = 0;
  const t0 = Date.now();

  let sinceTurn = 0;
  for (let k = 1; k <= secs; k++) {
    if (turnEvery && k % turnEvery === 0) heading += Math.PI / 2;
    if (blockM) {
      sinceTurn += speedMs;
      if (sinceTurn >= blockM) {
        heading += Math.PI / 2;
        sinceTurn = 0;
      }
    }
    if (circleR) heading += speedMs / circleR; // 매 초 호를 따라 방향을 튼다
    north += speedMs * Math.cos(heading);
    east += speedMs * Math.sin(heading);
    const dn = north + gauss() * sigma;
    const de = east + gauss() * sigma;
    let dop = zeroSpeed ? 0 : withDoppler ? Math.max(0, speedMs + gauss() * 0.3) : null;
    if (dropEvery && k % dropEvery < dropLen) dop = 0;
    const v = f.push({
      lat: LAT0 + dn / MPD_LAT,
      lng: LNG0 + de / MPD_LNG,
      accuracy: acc,
      speed: dop,
      t: t0 + k * 1000,
    });
    dist += v.addM;
    if (v.accept) accepted++;
    // 화면의 '지금 페이스'가 끊김 중에 널뛰지 않는지 — 진짜로 뛰는 중에
    // 표시 속도가 반 이하로 무너지면 페이스가 두 배로 튄 것이다
    if (speedMs > 0 && withDoppler && !zeroSpeed && v.speed != null && k > 5) {
      if (v.speed < speedMs * 0.5) flickers++;
    }
  }
  const truth = speedMs * secs;
  const err = truth === 0 ? dist : ((dist - truth) / truth) * 100;
  const pace = dist > 0 ? secs / (dist / 1000) : null;
  console.log(
    `  ${name.padEnd(34)} 실제 ${(truth / 1000).toFixed(2)}km → 측정 ${(dist / 1000).toFixed(2)}km  ` +
      `${truth === 0 ? `(가짜 ${dist.toFixed(0)}m)` : `오차 ${err >= 0 ? '+' : ''}${err.toFixed(1)}%`}` +
      `${pace ? ` · ${Math.floor(pace / 60)}'${String(Math.round(pace % 60)).padStart(2, '0')}"/km` : ''}` +
      `  점 ${accepted}개`,
  );
  return { dist, truth, err, flickers };
}

console.log('\n1Hz 측위 · 시나리오별 거리 정확도\n');
console.log(' [정지] 서 있는데 거리가 늘어나면 안 된다');
scenario({ name: '제자리 · 오차10m 지터σ6m', secs: 120, speedMs: 0, sigma: 6, acc: 10 });
scenario({ name: '제자리 · 오차20m 지터σ12m', secs: 120, speedMs: 0, sigma: 12, acc: 20 });
scenario({
  name: '제자리 · 도플러 없는 기기',
  secs: 120,
  speedMs: 0,
  sigma: 6,
  acc: 10,
  withDoppler: false,
});

console.log('\n [달리기] 실제 거리와 맞아야 한다 (3.0m/s = 5\'33"/km)');
scenario({ name: '직선 5분 · 오차10m', secs: 300, speedMs: 3.0, sigma: 6, acc: 10 });
scenario({ name: '직선 5분 · 오차5m(맑은 하늘)', secs: 300, speedMs: 3.0, sigma: 3, acc: 5 });
scenario({
  name: '직선 5분 · 도플러 없는 기기',
  secs: 300,
  speedMs: 3.0,
  sigma: 6,
  acc: 10,
  withDoppler: false,
});
scenario({
  name: '90초마다 직각 · 10분',
  secs: 600,
  speedMs: 3.0,
  sigma: 6,
  acc: 10,
  turnEvery: 90,
});
scenario({ name: '느린 조깅 2.2m/s · 10분', secs: 600, speedMs: 2.2, sigma: 6, acc: 10 });
scenario({ name: '빠른 러닝 4.5m/s · 5분', secs: 300, speedMs: 4.5, sigma: 6, acc: 10 });
scenario({
  name: '반경40m 원 계속 돌기 · 10분',
  secs: 600,
  speedMs: 3.0,
  sigma: 6,
  acc: 10,
  circleR: 40,
});
scenario({
  name: 'speed 를 항상 0 으로 주는 기기',
  secs: 300,
  speedMs: 3.0,
  sigma: 6,
  acc: 10,
  zeroSpeed: true,
});

console.log('\n [도플러 끊김] 실측에서 거리 -11.8%·페이스 널뛰기를 만든 조건');
const failures = [];
const drop = scenario({
  name: '15초마다 3틱 끊김 · 30분',
  secs: 1800,
  speedMs: 3.0,
  sigma: 5,
  acc: 10,
  turnEvery: 90,
  dropEvery: 15,
  dropLen: 3,
});
if (Math.abs(drop.err) > 6) failures.push(`끊김 시 거리 오차 ${drop.err.toFixed(1)}% (한도 ±6%)`);
if (drop.flickers > 0) failures.push(`끊김 중 표시 페이스가 ${drop.flickers}틱 널뛰었다`);
else console.log('  ✅ 끊김 중에도 표시 페이스가 안 널뛴다 (0틱)');
if (failures.length) {
  failures.forEach((f) => console.log('  ❌ ' + f));
  process.exit(1);
}

// ── 약한 신호 ───────────────────────────────────────────────────────────────
// 실측(상도동 아파트 단지, 4분 러닝)에서 오차 40~60m 가 이어지자 모든 측위가
// 버려져 점 몇 개짜리 직선 0.39km 로 기록되고 페이스가 9'59"/km 로 나왔다.
// 문턱을 올렸으니 (1) 그 상황에서 기록이 이어지는지, 그리고 무엇보다
// (2) 문턱을 올려도 '서 있을 때 가짜 거리'가 안 생기는지를 같이 잰다.
console.log("\n [약한 신호] 오차 40~50m 가 이어지는 도심 (실측에서 0.39km 로 깎인 조건)");
const weakFails = [];

const weakStand = scenario({ name: '제자리 · 오차45m 지터σ22m', secs: 180, speedMs: 0, sigma: 22, acc: 45 });
if (weakStand.dist > 80) weakFails.push(`약한 신호로 서 있는데 가짜 거리 ${weakStand.dist.toFixed(0)}m (한도 80m)`);
else console.log(`  ✅ 오차가 커도 서 있으면 거리가 안 쌓인다 (${weakStand.dist.toFixed(0)}m)`);

const weakStand2 = scenario({ name: '제자리 · 오차45m 도플러 없음', secs: 180, speedMs: 0, sigma: 22, acc: 45, withDoppler: false });
if (weakStand2.dist > 80) weakFails.push(`도플러 없는 기기가 약한 신호로 서 있는데 ${weakStand2.dist.toFixed(0)}m (한도 80m)`);
else console.log(`  ✅ 도플러 없는 기기도 마찬가지 (${weakStand2.dist.toFixed(0)}m)`);

// 사용자 실측과 같은 조건: 4분 가벼운 조깅(2.7m/s ≈ 6'10"/km)을 오차 45m 로
const weakRun = scenario({ name: '가벼운 조깅 2.7m/s · 4분 · 오차45m', secs: 234, speedMs: 2.7, sigma: 22, acc: 45, turnEvery: 60 });
if (Math.abs(weakRun.err) > 25) weakFails.push(`약한 신호 러닝 거리 오차 ${weakRun.err.toFixed(1)}% (한도 ±25%)`);
else console.log(`  ✅ 약한 신호에서도 거리가 쌓인다 (오차 ${weakRun.err >= 0 ? '+' : ''}${weakRun.err.toFixed(1)}%)`);

if (weakFails.length) {
  weakFails.forEach((f) => console.log('  ❌ ' + f));
  process.exit(1);
}

// ── 자동 일시정지 ──────────────────────────────────────────────────────────
// 서 있으면 거리는 안 쌓이는데 시간만 흐르면, 그 비대칭이 그대로 페이스를
// 부풀린다. 신호 대기 2분이 낀 km 가 실제 5'34" 인데 7'32" 로 찍혔다.
// 필터가 '확정 정지'를 알려주면 시계도 같이 멈춘다.
console.log('\n [자동 일시정지] 신호 대기가 페이스를 부풀리면 안 된다');
{
  const f = createGpsFilter();
  const t0 = Date.now();
  let tickN = 0;
  let dist = 0;
  let wall = 0;
  let paused = 0;
  let since = null;
  let north = 0;
  const feed = (speed, secs) => {
    for (let k = 0; k < secs; k++) {
      tickN++;
      wall += 1000;
      north += speed;
      const now = t0 + tickN * 1000;
      const v = f.push({ lat: LAT0 + north / MPD_LAT, lng: LNG0, accuracy: 10, speed, t: now });
      dist += v.addM;
      if (f.still && since == null) since = now;
      else if (!f.still && since != null) {
        paused += now - since;
        since = null;
      }
    }
  };
  feed(3.0, 300); //  5분 러닝
  feed(0, 120); //    2분 신호 대기
  feed(3.0, 300); //  5분 러닝
  const active = wall - paused - (since ? t0 + tickN * 1000 - since : 0);
  const pace = active / 1000 / (dist / 1000);
  const fmt = (p) => `${Math.floor(p / 60)}'${String(Math.round(p % 60)).padStart(2, '0')}"`;
  console.log(
    `  10분 러닝 + 2분 정지 → 거리 ${(dist / 1000).toFixed(2)}km · 정지로 뺀 시간 ${(paused / 1000).toFixed(0)}초 · 평균 ${fmt(pace)}/km`,
  );
  const fails = [];
  if (paused < 100_000) fails.push(`정지 시간을 ${(paused / 1000).toFixed(0)}초만 뺐다 (실제 120초)`);
  if (Math.abs(pace - 1000 / 3) / (1000 / 3) > 0.06) {
    fails.push(`평균 페이스가 실제(5'33")와 ${fmt(pace)} 로 어긋난다`);
  }
  // 뛰는 중에 잘못 멈춤 판정이 나면 시간이 깎여 페이스가 빨라진다 — 그것도 막는다
  const f2 = createGpsFilter();
  let d2 = 0;
  let paused2 = 0;
  let since2 = null;
  for (let k = 1; k <= 600; k++) {
    const now = t0 + k * 1000;
    // 15초마다 3틱 도플러 끊김 (도시 협곡)
    const sp = k % 15 < 3 ? 0 : 3.0;
    const v = f2.push({ lat: LAT0 + (3.0 * k) / MPD_LAT, lng: LNG0, accuracy: 10, speed: sp, t: now });
    d2 += v.addM;
    if (f2.still && since2 == null) since2 = now;
    else if (!f2.still && since2 != null) {
      paused2 += now - since2;
      since2 = null;
    }
  }
  console.log(`  뛰는 중 도플러 끊김 10분 → 잘못 멈춘 시간 ${(paused2 / 1000).toFixed(0)}초`);
  if (paused2 > 30_000) fails.push(`뛰는 중인데 ${(paused2 / 1000).toFixed(0)}초를 정지로 뺐다`);
  if (fails.length) {
    fails.forEach((x) => console.log('  ❌ ' + x));
    process.exit(1);
  }
  console.log('  ✅ 정지는 빼고, 뛰는 중 끊김은 안 뺀다');
}

// ── 도심 곡선 ──────────────────────────────────────────────────────────────
// 60m 마다 꺾는 서울 골목 규모의 러닝. 위치를 이어 붙여 거리를 재면 두 점
// 사이를 직선으로 가로질러 코너마다 거리가 사라진다 — 임계가 오차에 비례해
// 커지는 약한 신호에서 특히 심해서, 실측 대신 합성으로 재 보니 오차 15m 에서
// -12.5%, 25m 에서 -27.4%, 45m 에서 -95.9% 였다(페이스 5'33" → 7'39" → 133').
// 도플러 속도를 시간으로 적분하면 곡선을 가로지르지 않으므로 이 오차가 사라진다.
console.log('\n [도심 곡선] 자주 꺾는 길 — 코너에서 거리가 사라지면 안 된다');
const curveFails = [];
for (const acc of [8, 15, 25, 45]) {
  const r = scenario({
    name: `60m마다 직각 · 10분 · 오차${acc}m`,
    secs: 600,
    speedMs: 3.0,
    sigma: acc / 2.5,
    acc,
    blockM: 60,
  });
  if (Math.abs(r.err) > 6) {
    curveFails.push(`오차${acc}m 도심 곡선에서 거리 오차 ${r.err.toFixed(1)}% (한도 ±6%)`);
  }
}
if (curveFails.length) {
  curveFails.forEach((f) => console.log('  ❌ ' + f));
  process.exit(1);
}
console.log('  ✅ GPS 오차가 커져도 코너에서 거리가 안 사라진다');

// ── 긴 공백 ────────────────────────────────────────────────────────────────
// 화면을 끄거나 지하로 들어가면 측위가 수십 초씩 통째로 끊긴다. 돌아왔을 때
// 낡은 기준점과의 직선거리를 그대로 더하면 안 뛴 거리가 한 번에 얹힌다
// (지하철로 이동했다면 몇 km). 순간이동 가드는 10초 미만 간격만 보므로
// 이 경우를 못 잡았다.
console.log('\n [긴 공백] 화면 껐다 켠 사이 이동 — 유령 거리가 붙으면 안 된다');
const gapFails = [];
{
  const f = createGpsFilter();
  const t0 = Date.now();
  let dist = 0;
  // 1) 60초 정상 러닝 (3m/s, 북쪽으로)
  for (let k = 1; k <= 60; k++) {
    const v = f.push({
      lat: LAT0 + (3 * k) / MPD_LAT, lng: LNG0,
      accuracy: 8, speed: 3, t: t0 + k * 1000,
    });
    dist += v.addM;
  }
  const ran = dist;
  // 2) 90초 공백 뒤, 2km 떨어진 곳에서 측위 재개 (지하철로 이동한 셈)
  const v = f.push({
    lat: LAT0 + (3 * 60 + 2000) / MPD_LAT, lng: LNG0,
    accuracy: 8, speed: 0, t: t0 + 60_000 + 90_000,
  });
  dist += v.addM;
  console.log(
    `  60초 러닝 ${ran.toFixed(0)}m → 90초 공백 뒤 2km 떨어진 곳에서 재개 ` +
      `→ 그 한 틱이 더한 거리 ${v.addM.toFixed(0)}m (총 ${dist.toFixed(0)}m)`,
  );
  if (v.addM > 50) gapFails.push(`공백 뒤 유령 거리 ${v.addM.toFixed(0)}m 가 붙었다 (한도 50m)`);
  else console.log('  ✅ 공백 구간은 거리에 안 더한다');
  // 3) 재개 후에는 정상적으로 다시 쌓여야 한다 (기준점만 옮긴 것이지 멈춘 게 아니다)
  let after = 0;
  const base = 3 * 60 + 2000;
  for (let k = 1; k <= 30; k++) {
    const v2 = f.push({
      lat: LAT0 + (base + 3 * k) / MPD_LAT, lng: LNG0,
      accuracy: 8, speed: 3, t: t0 + 150_000 + k * 1000,
    });
    after += v2.addM;
  }
  console.log(`  재개 후 30초(실제 90m) → ${after.toFixed(0)}m`);
  if (after < 45) gapFails.push(`공백 뒤 기록이 안 이어진다 (${after.toFixed(0)}m)`);
  else console.log('  ✅ 공백이 끝나면 다시 정상 적산');
}
if (gapFails.length) {
  gapFails.forEach((f) => console.log('  ❌ ' + f));
  process.exit(1);
}

// ── 도플러 교정 ────────────────────────────────────────────────────────────
// 일부 기기/브라우저가 coords.speed 를 실제보다 크게 보고한다. 이때 도플러
// 적분 거리가 haversine 경로 거리의 1.5배를 넘으면 haversine 으로 되돌린다.
console.log('\n [도플러 교정] 부풀려진 speed 를 감지해 haversine 으로 전환');
{
  const calibFails = [];
  const f = createGpsFilter();
  const t0 = Date.now();
  let dist = 0;
  const rnd = seeded(77);
  const gauss = gaussFrom(rnd);
  const realSpeed = 3.0;
  const inflated = 2.0; // 기기가 실제의 2배 속도를 보고
  for (let k = 1; k <= 600; k++) {
    const v = f.push({
      lat: LAT0 + (realSpeed * k) / MPD_LAT,
      lng: LNG0,
      accuracy: 8,
      speed: Math.max(0, realSpeed * inflated + gauss() * 0.3),
      t: t0 + k * 1000,
    });
    dist += v.addM;
  }
  const truth = realSpeed * 600;
  const err = ((dist - truth) / truth) * 100;
  console.log(
    `  실제 3.0m/s · 기기 보고 6.0m/s · 10분 → ${(dist / 1000).toFixed(2)}km (실제 ${(truth / 1000).toFixed(2)}km) 오차 ${err >= 0 ? '+' : ''}${err.toFixed(1)}%`,
  );
  if (Math.abs(err) > 15) calibFails.push(`교정 후에도 거리 오차 ${err.toFixed(1)}% (한도 ±15%)`);
  else console.log('  ✅ 부풀려진 도플러를 감지해 교정했다');

  // 정상 기기는 교정에 안 걸려야 한다
  const f2 = createGpsFilter();
  let dist2 = 0;
  for (let k = 1; k <= 600; k++) {
    const v = f2.push({
      lat: LAT0 + (realSpeed * k) / MPD_LAT,
      lng: LNG0,
      accuracy: 8,
      speed: Math.max(0, realSpeed + gauss() * 0.3),
      t: t0 + k * 1000,
    });
    dist2 += v.addM;
  }
  const err2 = ((dist2 - truth) / truth) * 100;
  console.log(
    `  정상 기기 3.0m/s · 10분 → ${(dist2 / 1000).toFixed(2)}km 오차 ${err2 >= 0 ? '+' : ''}${err2.toFixed(1)}%`,
  );
  if (Math.abs(err2) > 6) calibFails.push(`정상 기기가 교정에 걸려 오차 ${err2.toFixed(1)}% (한도 ±6%)`);
  else console.log('  ✅ 정상 기기는 교정에 안 걸린다');

  // 정확도가 40% 확률로 50m 를 넘는 도심 — 정상 도플러가 교정에 걸리면 안 된다
  const f3 = createGpsFilter();
  let dist3 = 0;
  const rnd3 = seeded(99);
  for (let k = 1; k <= 600; k++) {
    const accFlicker = rnd3() < 0.4 ? 55 : 10;
    const v = f3.push({
      lat: LAT0 + (realSpeed * k) / MPD_LAT,
      lng: LNG0,
      accuracy: accFlicker,
      speed: Math.max(0, realSpeed + gauss() * 0.3),
      t: t0 + k * 1000,
    });
    dist3 += v.addM;
  }
  const err3 = ((dist3 - truth) / truth) * 100;
  console.log(
    `  정확도 간헐 초과(40%) · 10분 → ${(dist3 / 1000).toFixed(2)}km 오차 ${err3 >= 0 ? '+' : ''}${err3.toFixed(1)}%`,
  );
  if (Math.abs(err3) > 10) calibFails.push(`정확도 간헐 초과에서 정상 도플러가 교정에 걸려 오차 ${err3.toFixed(1)}% (한도 ±10%)`);
  else console.log('  ✅ 정확도가 자주 나빠도 정상 도플러는 교정에 안 걸린다');

  // 중간 부풀림: 처음 5분 정상, 이후 5분 2배 — 롤링 창이 ~60초 안에 잡아야 한다
  const f4 = createGpsFilter();
  let dist4 = 0;
  for (let k = 1; k <= 600; k++) {
    const inflated = k > 300;
    const v = f4.push({
      lat: LAT0 + (realSpeed * k) / MPD_LAT,
      lng: LNG0,
      accuracy: 10,
      speed: Math.max(0, (inflated ? realSpeed * 2 : realSpeed) + gauss() * 0.3),
      t: t0 + k * 1000,
    });
    dist4 += v.addM;
  }
  const truth4 = realSpeed * 600;
  const err4 = ((dist4 - truth4) / truth4) * 100;
  console.log(
    `  중간 부풀림(300초부터 2배) → ${(dist4 / 1000).toFixed(2)}km (실제 ${(truth4 / 1000).toFixed(2)}km) 오차 ${err4 >= 0 ? '+' : ''}${err4.toFixed(1)}%`,
  );
  if (Math.abs(err4) > 15) calibFails.push(`중간 부풀림에서 오차 ${err4.toFixed(1)}% (한도 ±15%)`);
  else console.log('  ✅ 러닝 중간 부풀림도 롤링 창이 잡아낸다');

  // 시작 직후 2배 부풀림 — 처음 30m 동안 haversine으로 방어해야 한다
  const f5 = createGpsFilter();
  let dist5 = 0;
  let first30mDist = 0;
  for (let k = 1; k <= 60; k++) {
    const v = f5.push({
      lat: LAT0 + (realSpeed * k) / MPD_LAT,
      lng: LNG0,
      accuracy: 10,
      speed: Math.max(0, realSpeed * 2.5 + gauss() * 0.3),
      t: t0 + k * 1000,
    });
    dist5 += v.addM;
    if (k <= 30) first30mDist = dist5;
  }
  const truth5 = realSpeed * 60;
  const err5 = ((dist5 - truth5) / truth5) * 100;
  const first30mExpected = realSpeed * 30;
  const first30mErr = ((first30mDist - first30mExpected) / first30mExpected) * 100;
  console.log(
    `  시작 직후 2.5배 부풀림 · 60초 → ${dist5.toFixed(0)}m (실제 ${truth5.toFixed(0)}m) 오차 ${err5 >= 0 ? '+' : ''}${err5.toFixed(1)}%`,
  );
  console.log(
    `    첫 30초: ${first30mDist.toFixed(0)}m (실제 ${first30mExpected.toFixed(0)}m) 오차 ${first30mErr >= 0 ? '+' : ''}${first30mErr.toFixed(1)}%`,
  );
  if (Math.abs(first30mErr) > 30) calibFails.push(`시작 직후 30초 오차 ${first30mErr.toFixed(1)}% (한도 ±30%)`);
  else console.log('  ✅ 시작 직후에도 부풀려진 페이스가 안 나온다');

  if (calibFails.length) {
    calibFails.forEach((x) => console.log('  ❌ ' + x));
    process.exit(1);
  }
}
console.log('');
