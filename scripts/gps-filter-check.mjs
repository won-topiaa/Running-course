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

  for (let k = 1; k <= secs; k++) {
    if (turnEvery && k % turnEvery === 0) heading += Math.PI / 2;
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
console.log('');
