// 실호출 검증 — 실제 ORS 로 코스를 만들고, 실제 Overpass 로 숲길 비율을 잰다.
//   NODE_USE_ENV_PROXY=1 npm run check:live
//
// 기본 검증(check:local)은 브라우저도 네트워크도 없이 로직만 본다. 이 스크립트는
// 그 반대로, 바깥 서비스가 실제로 우리가 기대하는 모양의 답을 주는지 확인한다.
// 느리고(수십 초) 외부 사정을 타므로 CI 용이 아니라 사람이 가끔 돌리는 용도다.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'live-'));
const bundle = async (entry, name) => {
  const out = join(dir, name);
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    outfile: out,
    logLevel: 'error',
    // vite 가 치환하는 import.meta.env 를 node 에서도 있게 만들어 준다
    define: { 'import.meta.env': '{}' },
  });
  return import(out);
};

const { OrsProvider } = await bundle('src/lib/routing.ts', 'r.mjs');
const { fetchGreenShares } = await bundle('src/lib/greenShare.ts', 'g.mjs');
const { loadSettings } = await bundle('src/lib/config.ts', 'c.mjs');
const { parseWayMix } = await bundle('src/lib/wayMix.ts', 'w.mjs');

// config 는 localStorage 를 쓴다 — node 에는 없으니 최소한으로 흉내낸다
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const orsKey = loadSettings().orsKey;

const ok = [];
const bad = [];
const check = (c, m) => {
  (c ? ok : bad).push(m);
  console.log((c ? '  ✅ ' : '  ❌ ') + m);
};

/** 숲이 많을 것으로 아는 곳 / 도심 — 결과가 상식과 맞는지 본다 */
const SPOTS = [
  { name: '여의도한강공원', at: [37.5285, 126.933], expect: 'high' },
  { name: '서울숲', at: [37.5444, 127.0374], expect: 'high' },
  { name: '강남역 도심', at: [37.4979, 127.0276], expect: 'low' },
];

console.log('\n실제 ORS 코스 + 실제 Overpass 숲길 비율 (5km 왕복)\n');
const provider = new OrsProvider(orsKey);
const rows = [];
for (const spot of SPOTS) {
  const t0 = Date.now();
  let route;
  try {
    route = await provider.roundTrip(spot.at, 5, { points: 5, seed: 1 });
  } catch (e) {
    console.log(`  ⏭  ${spot.name}: 경로 실패 (${String(e).slice(0, 60)})`);
    continue;
  }
  const tRoute = Date.now() - t0;
  const t1 = Date.now();
  const [green] = await fetchGreenShares([route.coords]);
  const tGreen = Date.now() - t1;
  const w = route.way;
  console.log(
    `  ${spot.name.padEnd(16)} ${route.distanceKm.toFixed(2)}km  ` +
      `보행자길 ${String(w?.trailPct ?? '-').padStart(3)}%  숲길 ${String(green ?? '-').padStart(3)}%  ` +
      `(경로 ${tRoute}ms · 숲길 ${tGreen}ms)`,
  );
  rows.push({ ...spot, route, green, way: w, tGreen });
  // Overpass 는 슬롯 2개를 주고 그 뒤로는 줄을 세운다. 실제 사용자는 코스
  // 한 번에 한 번만 부르므로 여기서만 넉넉히 띄운다.
  await new Promise((r) => setTimeout(r, 20000));
}

if (rows.length === 0) {
  console.log('\n  네트워크에 못 나가 검증 생략 (NODE_USE_ENV_PROXY=1 필요할 수 있음)');
  process.exit(0);
}

check(
  rows.every((r) => r.way && r.way.trailPct + r.way.roadPct > 0),
  'ORS 응답에 waytype 이 실려 온다',
);
// 공용 Overpass 는 붐빌 때 504 를 던진다 — 100% 성공을 요구하면 검사 자체가
// 흔들려 쓸모없어진다. '전부 실패'만 우리 코드 문제로 본다.
const okRows = rows.filter((r) => typeof r.green === 'number');
console.log(`\n    Overpass 응답: ${okRows.length}/${rows.length} 성공`);
check(okRows.length > 0, `Overpass 에서 숲길 비율을 받아 온다 (${okRows.length}/${rows.length})`);
check(
  okRows.every((r) => r.green >= 0 && r.green <= 100),
  '숲길 비율이 0~100 범위',
);

const high = okRows.filter((r) => r.expect === 'high');
const low = okRows.filter((r) => r.expect === 'low');
if (high.length && low.length) {
  const hiAvg = high.reduce((s, r) => s + r.green, 0) / high.length;
  const loAvg = low.reduce((s, r) => s + r.green, 0) / low.length;
  console.log(`\n    공원·숲 지역 평균 ${hiAvg.toFixed(0)}%  vs  도심 평균 ${loAvg.toFixed(0)}%`);
  check(
    hiAvg > loAvg,
    `공원 지역이 도심보다 숲길 비율이 높다 (${hiAvg.toFixed(0)}% > ${loAvg.toFixed(0)}%)`,
  );
}

// 캐시: 같은 동네를 다시 물으면 네트워크를 안 탄다 (성공한 것으로만 확인)
if (okRows.length) {
  const t2 = Date.now();
  await fetchGreenShares([okRows[0].route.coords]);
  const cachedMs = Date.now() - t2;
  console.log(`    같은 동네 재조회: ${cachedMs}ms (첫 조회 ${okRows[0].tGreen}ms)`);
  check(cachedMs < 200, `캐시가 먹는다 (${cachedMs}ms)`);
}

console.log(`\n통과 ${ok.length} / 실패 ${bad.length}`);
if (bad.length) process.exit(1);
