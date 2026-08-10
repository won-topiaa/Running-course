// 사용자에게 '나가는' 결과물 검증 — GPX 파일, 공유 링크, 구간 기록, 통계.
//   node scripts/output-check.mjs
// 화면이 아니라 파일·URL·숫자로 나가는 것들이라 한 번 틀리면 조용히 틀린다.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'out-'));
const bundle = async (entry, name) => {
  const out = join(dir, name);
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    outfile: out,
    logLevel: 'error',
    define: { 'import.meta.env': '{}' },
  });
  return import(out);
};

const ok = [];
const bad = [];
const check = (c, m) => {
  (c ? ok : bad).push(m);
  console.log((c ? '  ✅ ' : '  ❌ ') + m);
};

const { buildGpx } = await bundle('src/lib/gpx.ts', 'gpx.mjs');
const { encodeShare, decodeShare, encodePolyline, decodePolyline } = await bundle(
  'src/lib/polyline.ts',
  'pl.mjs',
);
const { kmSplits } = await bundle('src/lib/splits.ts', 'sp.mjs');
const { computeRunStats } = await bundle('src/lib/runStats.ts', 'st.mjs');

// ── GPX ─────────────────────────────────────────────────────────────────────
console.log('\n[GPX] 워치·스트라바로 나가는 파일');
const coords = [
  [37.5665, 126.978],
  [37.5675, 126.979],
  [37.5685, 126.98],
];
const t0 = Date.UTC(2026, 7, 9, 10, 0, 0);
const gpx = buildGpx({
  name: 'A & B <테스트> 러닝',
  coords,
  elevations: [30, 32.44, 35],
  times: [t0, t0 + 60000, t0 + 120000],
});
check(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'XML 선언으로 시작');
check((gpx.match(/<trkpt /g) || []).length === 3, '좌표 수만큼 trkpt');
check(/<ele>32\.4<\/ele>/.test(gpx), '고도는 소수 1자리');
check(/<time>2026-08-09T10:01:00\.000Z<\/time>/.test(gpx), '시각은 ISO UTC');
check(/<ele>[^<]*<\/ele><time>/.test(gpx), 'GPX 1.1 순서: ele 다음 time');
check(gpx.includes('A &amp; B &lt;테스트&gt; 러닝'), '이름의 &, <, > 를 이스케이프');
// 태그를 걷어낸 '텍스트 부분'에 날것의 < 나 엔티티 아닌 & 가 남아 있으면
// XML 이 깨진다. 정규식으로 흉내내지 말고 그렇게 직접 확인한다.
const textOnly = gpx.replace(/<[^>]*>/g, '');
check(!textOnly.includes('<'), '텍스트 영역에 날것의 < 없음');
check(!/&(?!(amp|lt|gt|quot|apos);)/.test(textOnly), '텍스트 영역에 엔티티 아닌 & 없음');

// 고도·시각이 없어도 유효해야 한다 (만든 코스는 기록 시각이 없다)
const noTime = buildGpx({ name: '코스', coords });
check((noTime.match(/<trkpt /g) || []).length === 3, '시각 없는 코스도 trkpt 는 그대로');
check(
  !/<trkpt[^>]*><time>/.test(noTime) && !noTime.includes('<ele>'),
  '시각·고도가 없으면 trkpt 안에 그 태그를 안 만든다',
);

// ── 공유 링크 ───────────────────────────────────────────────────────────────
console.log('\n[공유 링크] 카톡으로 던지는 URL');
const long = Array.from({ length: 1500 }, (_, i) => [
  37.5 + i * 0.00008,
  127.0 + Math.sin(i / 40) * 0.004,
]);
const encoded = encodePolyline(long);
const back = decodePolyline(encoded);
check(back.length === long.length, `폴리라인 왕복 개수 보존 (${back.length})`);
let maxErrM = 0;
for (let i = 0; i < long.length; i++) {
  const dLat = Math.abs(back[i][0] - long[i][0]) * 111320;
  const dLng = Math.abs(back[i][1] - long[i][1]) * 88000;
  maxErrM = Math.max(maxErrM, Math.hypot(dLat, dLng));
}
console.log(`    좌표 최대 오차 ${maxErrM.toFixed(2)}m`);
check(maxErrM < 2, `왕복 좌표 오차 ${maxErrM.toFixed(2)}m (GPS 오차보다 작다)`);

const payload = {
  n: '한강 야간 러닝 & 남산',
  p: encoded,
  e: [30, 31, 32],
  d: 8.42,
  a: 96,
  g: 7.3,
  s: 'flat',
  src: 'ors',
};
const token = encodeShare(payload);
const url = `https://won-topiaa.github.io/Running-course/#course=${token}`;
console.log(`    링크 길이 ${url.length}자 (1500점 코스)`);
const decoded = decodeShare(token);
check(decoded?.n === payload.n, '한글·특수문자 이름이 살아 돌아온다');
check(decoded?.d === payload.d && decoded?.a === payload.a, '거리·상승 보존');
check(url.length < 8000, `URL 길이가 브라우저 한계 안 (${url.length}자)`);

// 받는 사람이 보는 수치가 보낸 사람이 본 것과 같아야 한다.
// 링크에는 좌표를 100개로 솎아 담으므로, 그걸로 거리를 다시 계산하면 코너를
// 크게 가로질러 짧아진다 — 같은 코스인데 보낸 쪽과 받은 쪽 숫자가 달라진다.
{
  const { parseSharedFromHash } = await bundle('src/lib/savedRoutes.ts', 'sr3.mjs');
  const got = parseSharedFromHash(`#course=${token}`);
  console.log(
    `    보낸 값 ${payload.d}km/상승${payload.a}m → 받은 값 ${got.route.distanceKm}km/상승${got.route.ascentM}m`,
  );
  check(got.route.distanceKm === payload.d, `공유받은 거리가 보낸 값과 같다 (${got.route.distanceKm}km)`);
  check(got.route.ascentM === payload.a, `공유받은 상승이 보낸 값과 같다 (${got.route.ascentM}m)`);
  check(got.route.coords.length > 1, '지도에 그릴 좌표는 그대로 살아 있다');
}

// ── 구간 기록 ───────────────────────────────────────────────────────────────
console.log('\n[구간 기록] km 경계 보간');
// 정확히 3km 를 6분/km 로 뛴 직선.
// 위도 1도의 길이는 지구 반지름에서 나온다(≈111.195km) — 111.32km 로 잡으면
// 3km 인 줄 알았던 선이 2996m 라 구간이 2개만 나온다. 실제로 그렇게 틀렸었다.
const M_PER_DEG_LAT = (2 * Math.PI * 6371008.8) / 360;
const N = 300;
const total = 3000; // m
const line = Array.from({ length: N + 1 }, (_, i) => [
  37.5 + (total / M_PER_DEG_LAT) * (i / N),
  127.0,
]);
const times = Array.from({ length: N + 1 }, (_, i) => t0 + (i / N) * 3 * 360_000);
const splits = kmSplits(line, times);
console.log(
  `    ${splits.length}개 구간: ${splits.map((s) => s.sec.toFixed(0) + '초').join(' / ')}`,
);
check(splits.length === 3, `3km 는 구간 3개 (${splits.length})`);
check(
  splits.every((s) => Math.abs(s.sec - 360) < 3),
  `각 구간이 6분(360초)에 근접 (${splits.map((s) => s.sec.toFixed(1)).join('/')})`,
);
check(kmSplits(line.slice(0, 1), times.slice(0, 1)).length === 0, '좌표 1개면 구간 없음');

// 도플러 적분 누적거리를 주면 좌표 합산 대신 그것으로 km 경계를 잰다.
// 좌표는 코너를 직선으로 가로질러 깎이므로(도심 곡선 -12~-27%), 이걸 안 쓰면
// 화면 상단 총거리는 3.0km 인데 구간은 2.7km 기준이 되어 구간 페이스가 전부
// 느리게 나온다 — 실기기에서 '페이스가 너무 높게 나온다'로 보고된 증상이다.
{
  // 좌표가 실제(적분)보다 10% 짧게 잡힌 상황을 흉내 낸다
  const shrunk = Array.from({ length: N + 1 }, (_, i) => [
    37.5 + ((total * 0.9) / M_PER_DEG_LAT) * (i / N),
    127.0,
  ]);
  const cum = Array.from({ length: N + 1 }, (_, i) => (total / N) * i); // 적분값: 정확히 3km
  const withCum = kmSplits(shrunk, times, false, cum);
  const withoutCum = kmSplits(shrunk, times, false);
  console.log(
    `    좌표 10% 깎임 → 좌표합산 ${withoutCum.length}개 / 적분거리 ${withCum.length}개 구간`,
  );
  check(withCum.length === 3, `적분 거리를 주면 구간이 3개로 맞는다 (${withCum.length})`);
  check(
    withCum.every((x) => Math.abs(x.sec - 360) < 3),
    `구간 페이스도 6분에 맞는다 (${withCum.map((x) => x.sec.toFixed(0)).join('/')})`,
  );
  check(withoutCum.length === 2, '(대조) 좌표 합산만 쓰면 구간이 2개로 깎였다');
}
const partial = kmSplits(line.slice(0, 150), times.slice(0, 150), true);
check(
  partial.some((s) => s.partial),
  '진행 중 구간을 표시(러닝 화면용)',
);

// ── 경로 결과 방어 ──────────────────────────────────────────────────────────
console.log('\n[경로 결과] 고도 배열 구멍 방어');
const { buildResult } = await bundle('src/lib/routing.ts', 'rt.mjs');
const path5 = [
  [37.5, 127.0],
  [37.501, 127.0],
  [37.502, 127.0],
  [37.503, 127.0],
  [37.504, 127.0],
];
const isClean = (r) =>
  Number.isFinite(r.ascentM) &&
  Number.isFinite(r.maxGradePct) &&
  r.elevations.length === path5.length &&
  r.elevations.every(Number.isFinite);
check(isClean(buildResult(path5, [30, 31, 32], 'osrm', [])), '고도가 좌표보다 짧아도 NaN 없음');
check(isClean(buildResult(path5, [30, NaN, undefined, 33, 34], 'osrm', [])), '중간 구멍은 이웃으로 메움');
check(isClean(buildResult(path5, [], 'osrm', [])), '고도가 아예 없으면 0 평지');
check(
  buildResult(path5, [NaN, NaN, 50, NaN, NaN], 'osrm', []).elevations.every((v) => v === 50),
  '앞뒤 구멍은 유일한 정상값으로',
);

// ── 고도 잡음 ───────────────────────────────────────────────────────────────
// 휴대폰 GPS 고도는 ±수십 m 씩 튄다. 그대로 더하면 0.39km 를 뛰고 '총 오르막
// 144m · 최대 경사 35%' 같은 서로 모순된 숫자가 나온다 — 실측 기록에 그대로
// 찍혔다(상승은 안 자르고 경사만 잘랐기 때문).
console.log('\n[고도] GPS 고도 잡음 방어');
const M_PER_DEG = (2 * Math.PI * 6371008.8) / 360;
const track = (n, stepM) =>
  Array.from({ length: n }, (_, i) => [37.5 + (stepM * i) / M_PER_DEG, 127.0]);

// 평지를 뛰었는데 고도만 ±1m 씩 떨리는 경우 — 상승으로 세면 안 된다
const flat = track(60, 20); // 20m 간격 1180m
const jitter = flat.map((_, i) => 50 + (i % 2 ? 1 : -1));
const flatR = buildResult(flat, jitter, 'gps', []);
console.log(`    평지 1.18km · 고도 ±1m 떨림 → 상승 ${flatR.ascentM}m`);
check(flatR.ascentM <= 3, `잔떨림은 상승으로 안 센다 (${flatR.ascentM}m)`);

// 상승은 언제나 '보고한 최대 경사'와 물리적으로 앞뒤가 맞아야 한다.
// (실측 버그: 0.39km 에 상승 144m = 평균 37% 인데 최대 경사는 35% 로 표기)
const steep = track(5, 100); // 400m
const crazy = [52, 90, 130, 170, 196]; // 400m 에 144m 상승 = 36%
const steepR = buildResult(steep, crazy, 'gps', []);
const impliedPct = (steepR.ascentM / (steepR.distanceKm * 1000)) * 100;
console.log(
  `    400m 에 고도 52→196m 입력 → 상승 ${steepR.ascentM}m (평균 ${impliedPct.toFixed(1)}%), 최대 경사 ${steepR.maxGradePct}%`,
);
check(
  impliedPct <= steepR.maxGradePct + 0.5,
  `상승이 최대 경사와 모순되지 않는다 (평균 ${impliedPct.toFixed(1)}% ≤ 최대 ${steepR.maxGradePct}%)`,
);
check(
  steepR.elevations.every((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) <= 35.001),
  '차트 고도도 실현 가능한 구간 변화만 담는다',
);

// ── 저장 기록 검역 ──────────────────────────────────────────────────────────
// 저장소는 언제든 깨질 수 있다(백업 복원, 옛 버전, 용량 초과로 잘린 문자열).
// 이상한 항목이 목록에 남으면 열었을 때 화면이 통째로 터지고, 그 값은 계속
// 남아 있어 새로고침해도 매번 같은 자리에서 터진다 — 사용자가 손쓸 방법이 없다.
console.log('\n[저장 기록] 깨진 항목 검역');
const { sanitizeRoutes } = await bundle('src/lib/savedRoutes.ts', 'sr.mjs');
const okRoute = {
  id: 'a', name: '정상', createdAt: Date.now(), kind: 'recorded', distanceKm: 3,
  ascentM: 10, maxGradePct: 3, source: 'gps',
  coords: [[37.5, 127.0], [37.51, 127.0]], elevations: [10, 12],
};
const junk = [
  okRoute,
  { ...okRoute, id: 'b', name: '좌표 없음', coords: [] },
  { ...okRoute, id: 'c', name: '점 하나', coords: [[37.5, 127.0]] },
  { ...okRoute, id: 'd', name: '좌표에 NaN', coords: [[NaN, 127.0], [37.5, 127.0]] },
  { ...okRoute, id: 'e', name: '거리가 문자열', distanceKm: '삼킬로' },
  { ...okRoute, id: 'f', name: '종류가 이상', kind: 'teleport' },
  null, 'string', 42, [],
];
const kept = sanitizeRoutes(junk);
console.log(`    ${junk.length}개 중 ${kept.length}개 통과: ${kept.map((r) => r.name).join(', ')}`);
check(kept.length === 1 && kept[0].id === 'a', `정상 항목만 남는다 (${kept.length}개)`);
check(
  kept.every((r) => Array.isArray(r.coords) && r.coords.length >= 2),
  '남은 항목은 지도에 그릴 수 있는 좌표를 가진다 (center 가 undefined 일 수 없다)',
);
check(sanitizeRoutes(null).length === 0 && sanitizeRoutes('x').length === 0, '배열이 아니면 빈 목록');

// 저장한 기록을 다시 열 때 거리가 목록과 같아야 한다.
// buildResult 는 좌표를 이어 붙여 거리를 다시 재는데, 기록 좌표는 게이트를
// 지난 점들이라 코너를 직선으로 가로지른다 — 목록 3.2km / 열면 2.34km 처럼
// 같은 기록이 화면마다 다른 거리로 보였다(도심 지그재그에서 26.9% 차이).
{
  const { toRouteResult } = await bundle('src/lib/savedRoutes.ts', 'sr2.mjs');
  const zig = [];
  const zelev = [];
  let la = 37.5;
  let ln = 127.0;
  for (let i = 0; i < 40; i++) {
    if (i % 2 === 0) la += 0.00054;
    else ln += 0.00068;
    zig.push([la, ln]);
    zelev.push(40);
  }
  const rec = {
    id: 'z', name: '도심', createdAt: Date.now(), kind: 'recorded', distanceKm: 3.2,
    ascentM: 12, maxGradePct: 3, source: 'gps', coords: zig, elevations: zelev, durationSec: 1100,
  };
  const opened = toRouteResult(rec);
  console.log(`    저장 3.20km → 열었을 때 ${opened.distanceKm.toFixed(2)}km`);
  check(
    Math.abs(opened.distanceKm - 3.2) < 0.01,
    `저장한 거리가 그대로 유지된다 (${opened.distanceKm.toFixed(2)}km)`,
  );
  // 거리가 없는 옛 기록은 좌표로 계산한 값을 그대로 쓴다(회귀 방지)
  const legacy = toRouteResult({ ...rec, distanceKm: 0 });
  check(legacy.distanceKm > 0, '거리 정보가 없는 항목은 좌표로 계산해 채운다');

  // 상승도 같은 문제였다. 저장할 때 좌표·고도를 1500점으로 솎고(compactRoute),
  // 용량이 꽉 차면 100점까지 더 줄이는데(shrinkOldest) 그걸로 다시 계산하면
  // 오르내림이 뭉개진다 — 언덕 11km 를 100점까지 줄이니 목록 377m / 열면 322m.
  const hill = [];
  const hillElev = [];
  let hla = 37.55;
  let hln = 126.99;
  for (let i = 0; i < 3000; i++) {
    hla += 0.00003;
    hln += 0.00002;
    hill.push([hla, hln]);
    hillElev.push(50 + 20 * Math.sin((i / 300) * Math.PI * 2));
  }
  const thin = (a) => a.filter((_, i) => i % 30 === 0); // 용량 정리로 성겨진 상태
  const shrunk = {
    id: 'h', name: '언덕', createdAt: Date.now(), kind: 'recorded', distanceKm: 11.31,
    ascentM: 377, maxGradePct: 8, source: 'gps',
    coords: thin(hill), elevations: thin(hillElev), durationSec: 3600,
  };
  const openedHill = toRouteResult(shrunk);
  console.log(`    저장 상승 377m → 열었을 때 ${openedHill.ascentM}m`);
  check(openedHill.ascentM === 377, `저장한 상승이 그대로 유지된다 (${openedHill.ascentM}m)`);
  check(openedHill.maxGradePct === 8, `저장한 최대 경사가 그대로 유지된다 (${openedHill.maxGradePct}%)`);
  check(
    openedHill.elevations.length === shrunk.coords.length,
    '고도 그래프용 배열은 좌표 수만큼 그대로 만들어진다',
  );
  const flatLegacy = toRouteResult({ ...shrunk, ascentM: 0, maxGradePct: 0 });
  check(flatLegacy.ascentM > 0, '상승 정보가 없는 옛 항목은 고도로 계산해 채운다');
}

// ── 페이스 표기 ─────────────────────────────────────────────────────────────
// 화면에 그대로 찍히는 문자열이라 한 번 틀리면 사용자가 바로 본다.
// 실측: 방어가 없어서 NaN 이 들어오면 "NaN'NaN\"" 이, 음수면 "-1'-5\"" 가 떴고,
// 20m 만 움직인 시작 직후 평균 페이스가 "50'00\"/km" 로 나왔다.
console.log('\n[페이스] 이상한 값이 화면에 새지 않는지');
const { formatPace, sanePace } = await bundle('src/lib/format.ts', 'fmt.mjs');
const junkPace = [NaN, Infinity, -Infinity, 0, -5, undefined, null];
const rendered = junkPace.map((v) => formatPace(v));
console.log(`    이상한 입력 ${junkPace.length}개 → ${[...new Set(rendered)].join(' ')}`);
check(
  rendered.every((r) => r === '--'),
  `이상한 값은 전부 '--' 로 (${rendered.join(', ')})`,
);
// '-' 하나만 보면 '--' 자체가 걸린다. 음수는 '-12' 처럼 숫자가 붙은 걸 본다.
check(
  !rendered.some((r) => /NaN|Infinity|-\d/.test(r)),
  '화면 문자열에 NaN·Infinity·음수가 안 샌다',
);
check(formatPace(330) === "5'30\"" && formatPace(359.6) === "6'00\"", '정상 값은 그대로 (5\'30", 6\'00")');
// 범위 판정 — 세계기록보다 빠르거나 걷기보다 느리면 숫자로 내보내지 않는다
check(sanePace(330) === 330, '정상 페이스는 통과');
check(sanePace(60) === null, "1'00\"/km(세계기록보다 빠름)는 거른다");
check(sanePace(3000) === null, "50'00\"/km(시작 직후 허수)는 거른다");
check(sanePace(NaN) === null && sanePace(null) === null, 'NaN·null 은 거른다');
// 시작 직후 시나리오 — 예전에 50'00" 가 떴던 조건
check(sanePace(60 / 0.02) === null, '20m·60초(시작 직후) 평균은 숫자로 안 내보낸다');
check(sanePace(120 / 0.4) === 300, '400m·2분은 정상 페이스로 통과 (5\'00")');

// ── 표시 페이스(창) ─────────────────────────────────────────────────────────
// 순간 도플러를 그대로 뒤집으면(1000/speed) 실기기 잡음 ±0.45m/s 에서 일정하게
// 달려도 표시가 4'34"~6'57" 를 오갔다 — 전체 틱의 18% 가 실제와 10% 이상
// 어긋났다(직선에서도). '최근 20초 누적 거리 ÷ 시간'으로 바꾼 뒤의 안정성을
// 같은 조건으로 잰다.
console.log('\n[표시 페이스] 직선 일정 주행에서 안 출렁이는지');
{
  const { createPaceWindow } = await bundle('src/lib/paceWindow.ts', 'pw.mjs');
  const { createGpsFilter } = await bundle('src/lib/gpsFilter.ts', 'gf.mjs');
  const seeded = (s0) => { let x = s0 >>> 0; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; };
  const rnd = seeded(11);
  const gauss = () => { const u = Math.max(1e-9, rnd()); const v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  const f = createGpsFilter();
  const win = createPaceWindow();
  const speed = 3.0; // 5'33"/km 일정
  const t0 = Date.now();
  let dist = 0; let flick = 0; let n = 0; let minP = 1e9; let maxP = 0;
  for (let k = 1; k <= 300; k++) {
    const v = f.push({ lat: 37.5665 + (speed * k) / 111320, lng: 126.978, accuracy: 8,
      speed: Math.max(0, speed + gauss() * 0.45), t: t0 + k * 1000 });
    dist += v.addM;
    const p = win.push(k * 1000, dist);
    if (k > 30 && p != null) {
      n++; minP = Math.min(minP, p); maxP = Math.max(maxP, p);
      if (Math.abs(p - 1000 / speed) / (1000 / speed) > 0.1) flick++;
    }
  }
  const fmt = (p) => `${Math.floor(p / 60)}'${String(Math.round(p % 60)).padStart(2, '0')}"`;
  console.log(`    실제 5'33" → 표시 범위 ${fmt(minP)}~${fmt(maxP)} · 10% 이탈 ${flick}/${n}틱`);
  check(flick === 0, `일정 주행에서 표시가 실제의 ±10% 안에 머문다 (이탈 ${flick}틱, 순간 방식은 18%)`);
  check(Math.abs((minP + maxP) / 2 - 1000 / speed) < 15, '표시의 중심이 실제 페이스와 일치');

  // 정지: 거리가 안 늘면 숫자 대신 null (창에 옛 이동이 남아 있어도 언젠간)
  let last = 999;
  for (let k = 301; k <= 330; k++) last = win.push(k * 1000, dist);
  check(last === null, '완전히 멈추면 페이스가 null 로 내려온다');
  // 재개: 다시 쌓이면 8초 뒤부터 정상 복귀
  let resumed = null;
  for (let k = 331; k <= 360; k++) { dist += 3; resumed = win.push(k * 1000, dist); }
  check(resumed != null && Math.abs(resumed - 1000 / 3) / (1000 / 3) < 0.35, `재개하면 페이스가 돌아온다 (${resumed?.toFixed(0)}초/km)`);
  // 창이 안 찼을 때는 숫자를 안 내보낸다
  const w2 = createPaceWindow();
  check(w2.push(3000, 9) === null, '8초가 안 쌓였으면 null (시작 직후 허수 방지)');
}

// ── 후보 비교 배지 ──────────────────────────────────────────────────────────
// 카드에 '가장 평탄' 같은 단정을 붙인다. 틀리면 사용자를 속이는 것이라
// (그 말을 믿고 코스를 고른다) 눈이 아니라 검사로 확인한다.
console.log('\n[후보 배지] 근거 없는 단정이 안 나가는지');
const { superlatives } = await bundle('src/lib/compare.ts', 'cmp.mjs');
const item = (ascentM, distanceScore = 1, greenPct = null) => ({ ascentM, distanceScore, greenPct });

const flatBadges = superlatives([item(10), item(60), item(80)]);
console.log(`    상승 10·60·80m → ${JSON.stringify(flatBadges)}`);
check(flatBadges[0] === '가장 평탄', '가장 낮은 상승에 붙는다');
check(flatBadges.filter((x) => x === '가장 평탄').length === 1, "'가장 평탄'은 하나뿐");

check(
  superlatives([item(30), item(34), item(36)]).every((x) => x == null),
  '차이가 작으면(6m) 아무 말도 안 한다',
);
check(superlatives([item(10)]).every((x) => x == null), '후보가 하나면 비교하지 않는다');
check(superlatives([]).length === 0, '빈 목록도 안 터진다');

// 숲길 — 값이 다 와 있을 때만, 그리고 의미 있는 차이일 때만
const g = superlatives([item(50, 1, 45), item(50, 1, 12), item(50, 1, 8)]);
console.log(`    숲길 45·12·8% → ${JSON.stringify(g)}`);
check(g[0] === '🌳 숲길 최다', '숲길이 확실히 많은 후보에 붙는다');
check(
  superlatives([item(50, 1, 45), item(50, 1, null), item(50, 1, 8)]).every((x) => x == null),
  '숲길 값이 일부만 도착했으면 비교하지 않는다 (안 온 후보가 지는 셈이 된다)',
);
check(
  superlatives([item(50, 1, 8), item(50, 1, 3), item(50, 1, 1)]).every((x) => x == null),
  '다 같이 숲길이 적으면 최다라고 안 한다',
);

// 목표 거리 — 핀 모드처럼 목표가 없으면 전부 1 이라 비교 대상이 아니다
const d = superlatives([item(50, 0.4), item(50, 0.95), item(50, 0.5)]);
check(d[1] === '목표에 가장 가까움', '목표에 가장 가까운 후보에 붙는다');
check(
  superlatives([item(50, 1), item(50, 1), item(50, 1)]).every((x) => x == null),
  '목표가 없으면(전부 1) 거리 배지를 안 붙인다',
);

// 한 후보가 둘 다 1등이면 두 번째는 버린다 — 차점자에게 넘기면 거짓이 된다
const both = superlatives([item(5, 1, 50), item(90, 1, 10), item(95, 1, 5)]);
console.log(`    한 후보가 숲길·평탄 모두 1등 → ${JSON.stringify(both)}`);
check(
  both[0] === '🌳 숲길 최다' && both[1] == null && both[2] == null,
  "1등이 겹치면 하나만 붙이고 남에게 넘기지 않는다",
);

// ── 통계 ────────────────────────────────────────────────────────────────────
console.log('\n[통계] 마이 페이지 숫자');
const day = 86400_000;
const now = new Date(2026, 7, 9, 12, 0, 0); // 일요일
const mk = (daysAgo, km) => ({
  id: `r${daysAgo}`,
  name: 'x',
  createdAt: now.getTime() - daysAgo * day,
  kind: 'recorded',
  distanceKm: km,
  ascentM: 10,
  maxGradePct: 3,
  source: 'gps',
  coords: [],
  elevations: [],
  durationSec: 600,
});
const stats = computeRunStats([mk(0, 5), mk(1, 3), mk(2, 4), mk(9, 10)], now);
console.log(
  `    누적 ${stats.totalKm}km · 이번주 ${stats.weekKm}km · 연속 ${stats.streakDays}일 · 최장 ${stats.longestKm}km`,
);
check(Math.abs(stats.totalKm - 22) < 0.01, `누적 거리 22km (${stats.totalKm})`);
check(stats.runCount === 4, '기록 4건');
check(
  Math.abs(stats.weekKm - 12) < 0.01,
  `이번 주(월~일) 12km — 9일 전 것은 제외 (${stats.weekKm})`,
);
check(stats.streakDays === 3, `오늘부터 3일 연속 (${stats.streakDays})`);
check(stats.longestKm === 10, '최장 거리 10km');
check(computeRunStats([], now).runCount === 0, '기록이 없으면 0');

// ── 숲길 캐시 ───────────────────────────────────────────────────────────────
// 한 동네 결과가 실측 약 0.9MB 인데, TTL(10분)이 지나도 Map 에 남아 있었다.
// 여러 동네를 옮겨 다니며 코스를 만들면 그만큼 계속 쌓인다.
console.log('\n[숲길 캐시] 오래된 값이 메모리를 붙잡고 있으면 안 된다');
{
  const green = await bundle('src/lib/greenShare.ts', 'green.mjs');
  // 실제 Overpass 응답 모양을 흉내 낸다. 조회가 성공해야 캐시가 차므로,
  // 응답을 막아버리면 새는지 안 새는지 알 수 없는 검사가 된다.
  const sizes = [];
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      elements: [
        {
          type: 'way',
          geometry: [
            { lat: 37.0, lon: 127.0 },
            { lat: 37.9, lon: 127.0 },
            { lat: 37.9, lon: 127.9 },
            { lat: 37.0, lon: 127.9 },
          ],
        },
      ],
    }),
  });
  for (let i = 0; i < 12; i++) {
    const path = [];
    let la = 37.5 + i * 0.05;
    let ln = 127.0 + i * 0.05;
    for (let k = 0; k < 20; k++) {
      la += 0.0002;
      ln += 0.0002;
      path.push([la, ln]);
    }
    await green.fetchGreenShares([path]);
    sizes.push(green.greenCacheSize());
  }
  const peak = Math.max(...sizes);
  console.log(`    서로 다른 동네 12곳 조회 → 캐시 ${sizes.join('·')} (최대 ${peak}건)`);
  check(peak > 1, '조회에 성공하면 캐시가 실제로 찬다 (검사가 헛돌지 않게)');
  check(peak <= 6, `그래도 무한정 늘지 않는다 (최대 ${peak}건)`);
}

console.log(`\n통과 ${ok.length} / 실패 ${bad.length}`);
if (bad.length) process.exit(1);
