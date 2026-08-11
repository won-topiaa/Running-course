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

// ── 코스 만들기 ─────────────────────────────────────────────────────────────
// 앱의 핵심 기능인데 수치로 묶어 둔 검사가 없었다. 요청한 거리가 나오는지,
// 왕복은 정말 돌아오고 편도는 정말 멀어지는지 본다 (오프라인 provider 기준).
console.log('\n[코스 만들기] 요청 거리 · 왕복과 편도의 차이');
{
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  const routing = await bundle('src/lib/routing.ts', 'rt2.mjs');
  const cb = await bundle('src/lib/courseBuilder.ts', 'cb.mjs');
  const provider = routing.makeProvider({});
  const start = [37.5665, 126.978];
  const gapM = (c) =>
    Math.round(Math.hypot((c[0][0] - c.at(-1)[0]) * 110540, (c[0][1] - c.at(-1)[1]) * 88800));
  for (const km of [1, 5, 15]) {
    for (const oneWay of [false, true]) {
      const res = await cb.buildFromDistance(start, km, 'flat', provider, {
        seedBase: 1,
        oneWay,
        pathPref: 'any',
      });
      const best = res[0];
      const err = ((best.route.distanceKm - km) / km) * 100;
      const g = gapM(best.route.coords);
      console.log(
        `    ${String(km).padStart(2)}km ${oneWay ? '편도' : '왕복'} → ${best.route.distanceKm.toFixed(2)}km (${err >= 0 ? '+' : ''}${err.toFixed(1)}%) · 시작↔끝 ${g}m`,
      );
      // 코스빌더는 오차 10% 안이면 만족하고 멈춘다(왕복·편도 같은 기준).
      check(Math.abs(err) <= 20, `${km}km ${oneWay ? '편도' : '왕복'} 거리가 요청과 맞는다 (${err.toFixed(1)}%)`);
      if (oneWay) check(g > 200, `${km}km 편도는 출발점에서 멀어져 끝난다 (${g}m)`);
      else check(g < 200, `${km}km 왕복은 출발점으로 돌아온다 (${g}m)`);
    }
  }
}

// ── 코스 스타일 기준 ────────────────────────────────────────────────────────
// 사용자가 고른 '평지/완만/언덕'이 결과에 실제로 반영되는지, 그리고 고도를
// 못 받았을 때 지어낸 값으로 점수를 매기지 않는지 본다.
console.log('\n[스타일 기준] 고른 경사가 결과에 반영되는지');
{
  const rs = await bundle('src/lib/routeStyle.ts', 'rs3.mjs');
  const routing2 = await bundle('src/lib/routing.ts', 'rt3.mjs');
  const mkRoute = (ascentPerKm, maxGrade, flatPct) => {
    // 5km 코스를 흉내 낸 최소 RouteResult (evaluateStyle 이 보는 필드만)
    const segs = [];
    const flatLen = 5000 * (flatPct / 100);
    segs.push({ gradePct: 0, lengthM: flatLen });
    segs.push({ gradePct: maxGrade, lengthM: 5000 - flatLen });
    return { coords: [], elevations: [], distanceKm: 5, ascentM: ascentPerKm * 5,
      descentM: 0, maxGradePct: maxGrade, segments: segs, source: 'osrm', waypoints: [] };
  };
  const flatRoute = mkRoute(4, 4, 92);
  const hillRoute = mkRoute(55, 20, 20);
  const fFlat = rs.evaluateStyle(flatRoute, 'flat').score;
  const fHill = rs.evaluateStyle(hillRoute, 'flat').score;
  const hFlat = rs.evaluateStyle(flatRoute, 'hilly').score;
  const hHill = rs.evaluateStyle(hillRoute, 'hilly').score;
  console.log(`    평지 코스 → 평지점수 ${fFlat.toFixed(2)} / 언덕점수 ${hFlat.toFixed(2)}`);
  console.log(`    언덕 코스 → 평지점수 ${fHill.toFixed(2)} / 언덕점수 ${hHill.toFixed(2)}`);
  check(fFlat > fHill, "'평지 위주'는 평평한 코스에 더 높은 점수를 준다");
  check(hHill > hFlat, "'언덕 훈련'은 언덕 코스에 더 높은 점수를 준다");

  // 고도를 못 받은 경로는 채점하지 않는다. 예전엔 조회가 실패하면 데모용
  // 사인파 고도를 대신 넣어, 실제 상승 20m 코스가 368m 로 뜨고 그 가짜 값으로
  // 스타일 점수까지 매겨졌다(북한산 입구 실제 751m 를 42m 로 표시).
  const unknown = { ...flatRoute, elevationKnown: false };
  const ev = rs.evaluateStyle(unknown, 'flat');
  console.log(`    고도 모름 → 점수 ${ev.score} · "${ev.reason}"`);
  check(ev.score === null, '고도를 못 받았으면 경사 점수를 매기지 않는다 (평지 만점 방지)');
  check(/고도/.test(ev.reason), '왜 점수가 없는지 사람이 읽을 수 있게 말한다');

  // 채점에서 그 축이 실제로 빠지는지 (courseBuilder 쪽)
  const cb2 = await bundle('src/lib/courseBuilder.ts', 'cb2.mjs');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  const offline = routing2.makeProvider(null);
  const both = await cb2.buildFromDistance([37.5665, 126.978], 5, 'flat', offline, { seedBase: 2 });
  check(both.every((b) => Number.isFinite(b.matchScore) && b.matchScore >= 0 && b.matchScore <= 100),
    `매칭 점수가 0~100 안에 있다 (${both.map((b) => b.matchScore).join(',')})`);
}

// ── 고도 조회 요청량 ────────────────────────────────────────────────────────
// Open-Meteo 무료 한도는 분당 좌표 약 600개다. 예전엔 경로마다 200개를 뽑아
// 후보 4개면 800개 — 추천받기 한 번에 한도를 넘겨 뒤쪽 후보가 전부 가짜
// 고도를 받았다. 경로 길이에 맞춰 100m 에 한 점, 최대 100개로 줄였다.
console.log('\n[고도] 한 번의 추천받기가 쓰는 좌표 수');
{
  let asked = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const n = String(url).split('latitude=')[1]?.split('&')[0]?.split(',').length ?? 0;
    asked += n;
    return { ok: true, status: 200, json: async () => ({ elevation: new Array(n).fill(50) }) };
  };
  const elev = await bundle('src/lib/elevation.ts', 'ev.mjs');
  // 5km 코스 4개 (후보 풀 크기와 같게)
  for (let c = 0; c < 4; c++) {
    const path = [];
    let la = 37.5 + c * 0.02;
    let ln = 127.0 + c * 0.02;
    for (let i = 0; i < 400; i++) { la += 0.0001; ln += 0.00008; path.push([la, ln]); }
    await elev.elevationsForPath(path);
  }
  globalThis.fetch = realFetch;
  console.log(`    후보 4개 × 5km → 좌표 ${asked}개 조회 (한도 분당 600)`);
  check(asked <= 600, `추천받기 한 번이 분당 한도 안에 들어온다 (${asked}개)`);
  check(asked > 0, '조회를 아예 안 하는 건 아니다');
  // 같은 경로를 다시 물으면 캐시로 요청이 안 나가야 한다
  const before = asked;
  globalThis.fetch = async (url) => {
    const n = String(url).split('latitude=')[1]?.split('&')[0]?.split(',').length ?? 0;
    asked += n;
    return { ok: true, status: 200, json: async () => ({ elevation: new Array(n).fill(50) }) };
  };
  const same = [];
  let la2 = 37.5, ln2 = 127.0;
  for (let i = 0; i < 400; i++) { la2 += 0.0001; ln2 += 0.00008; same.push([la2, ln2]); }
  await elev.elevationsForPath(same);
  globalThis.fetch = realFetch;
  console.log(`    같은 경로 재조회 → 추가 좌표 ${asked - before}개`);
  check(asked - before === 0, '이미 물어본 지점은 다시 안 묻는다 (캐시)');
}

// ── 백업/복원 ───────────────────────────────────────────────────────────────
// 기록을 통째로 잃을 수 있는 경로다. 내보낸 그대로 돌아오는지, 남이 준 이상한
// 파일에 저장소가 덮어써지지 않는지 본다.
console.log('\n[백업] 내보낸 그대로 돌아오는지');
{
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => void mem.set(k, String(v)),
      removeItem: (k) => void mem.delete(k),
    },
    configurable: true,
  });
  const backup = await bundle('src/lib/backup.ts', 'bk.mjs');
  const run = {
    id: 'r1', name: '한강 저녁 러닝', createdAt: 1e12, kind: 'recorded',
    distanceKm: 5.24, ascentM: 38, maxGradePct: 6, source: 'gps',
    coords: [[37.5, 127], [37.51, 127.01]], elevations: [40, 42], durationSec: 1800,
  };
  localStorage.setItem('run-app-routes-v1', JSON.stringify([run]));
  localStorage.setItem('run-app-settings-v1', JSON.stringify({ weekGoalKm: 20 }));
  const file = backup.collectBackup();
  const snapshot = new Map(mem);
  mem.clear();
  const applied = backup.applyBackup(file);
  const back = JSON.parse(localStorage.getItem('run-app-routes-v1') ?? '[]');
  console.log(`    ${applied}개 항목 복원 → ${back[0]?.name} ${back[0]?.distanceKm}km/상승${back[0]?.ascentM}m`);
  check([...snapshot].every(([k, v]) => mem.get(k) === v), '지웠다 복원해도 모든 값이 그대로');
  check(back[0]?.distanceKm === 5.24 && back[0]?.ascentM === 38, '기록 수치가 보존된다');
  check(back[0]?.name === '한강 저녁 러닝', '한글 이름이 보존된다');
  // 남이 준 파일 — 저장소를 덮어쓰지 않고 사람이 읽을 안내로 거절해야 한다
  const junk = [null, 'not json', [1, 2, 3], { hello: 'world' }, { app: 'runcourse' }, { app: 'runcourse', data: null }];
  let allRejected = true;
  for (const j of junk) {
    const keep = new Map(mem);
    try {
      backup.applyBackup(j);
      allRejected = false;
    } catch (e) {
      if (!(e instanceof Error) || !/[가-힣]/.test(e.message)) allRejected = false;
    }
    if ([...keep].some(([k, v]) => mem.get(k) !== v)) allRejected = false;
  }
  check(allRejected, `백업 파일이 아니면 한국어 안내로 거절하고 저장소를 안 건드린다 (${junk.length}종)`);
}

// ── 날짜 경계 ───────────────────────────────────────────────────────────────
// 자정을 넘겨 뛰거나 일요일 밤에 뛰면 어느 주로 잡히는지 — 통계가 틀리면
// '이번 주 목표'가 통째로 어긋난다.
console.log('\n[날짜] 자정·주 경계·연속 일수');
{
  const { computeRunStats } = await bundle('src/lib/runStats.ts', 'rs2.mjs');
  const mkRun = (t, km) => ({
    id: 'r' + t, name: 'x', createdAt: t, kind: 'recorded', distanceKm: km,
    ascentM: 0, maxGradePct: 0, source: 'gps',
    coords: [[37, 127], [37.1, 127.1]], elevations: [0, 0], durationSec: 1800,
  });
  const now = new Date(2026, 7, 10, 9, 0); // 월요일 오전
  const D = 86400000;
  const wk = computeRunStats(
    [mkRun(new Date(2026, 7, 9, 23, 59).getTime(), 3), mkRun(new Date(2026, 7, 10, 0, 1).getTime(), 4)],
    now,
  );
  console.log(`    일 23:59(3km) + 월 00:01(4km) → 이번 주 ${wk.weekKm}km · 누적 ${wk.totalKm}km`);
  check(wk.weekKm === 4, '일요일 것은 지난주로 빠진다');
  check(wk.totalKm === 7, '누적에는 둘 다 들어간다');
  const yest = computeRunStats([mkRun(now.getTime() - D, 5), mkRun(now.getTime() - 2 * D, 5)], now);
  check(yest.streakDays === 2, `오늘 아직 안 뛰었어도 연속이 안 끊긴다 (${yest.streakDays}일)`);
  const broken = computeRunStats([mkRun(now.getTime() - 2 * D, 5), mkRun(now.getTime() - 3 * D, 5)], now);
  check(broken.streakDays === 0, '이틀 비면 연속이 끊긴다');
  const twice = computeRunStats([mkRun(now.getTime() - 3600e3, 5), mkRun(now.getTime() - 7200e3, 3)], now);
  check(twice.streakDays === 1 && twice.weekKm === 8, '하루 두 번은 연속 1일, 거리는 둘 다 더해진다');
}

// ── 극단값 ──────────────────────────────────────────────────────────────────
console.log('\n[극단값] 100m 부터 울트라까지 표기가 안 깨지는지');
{
  const f = await bundle('src/lib/format.ts', 'fmt2.mjs');
  const cases = [
    ['100m 40초', 0.1, 40], ['풀코스 3시간', 42.195, 3 * 3600],
    ['울트라 100km 12시간', 100, 12 * 3600], ['26시간', 160, 26 * 3600], ['0km 0초', 0, 0],
  ];
  let clean = true;
  for (const [label, km, sec] of cases) {
    const line = `${f.formatDistance(km)} · ${f.formatDuration(sec)} · ${f.formatPace(f.sanePace(km > 0 ? sec / km : null))}`;
    console.log(`    ${label.padEnd(18)} → ${line}`);
    if (/NaN|Infinity|undefined|null|-\d/.test(line)) clean = false;
  }
  check(clean, `극단값 ${cases.length}종에서 NaN·음수가 안 샌다`);
  const { computeRunStats } = await bundle('src/lib/runStats.ts', 'rs2.mjs');
  const many = [];
  for (let i = 0; i < 400; i++)
    many.push({ id: 'r' + i, name: 'x', createdAt: Date.now() - (i * 86400000) / 2, kind: 'recorded',
      distanceKm: 3 + ((i * 7) % 15), ascentM: i % 80, maxGradePct: 5, source: 'gps',
      coords: [[37, 127], [37.01, 127.01]], elevations: [40, 42], durationSec: 1800 });
  const t0 = Date.now();
  const big = computeRunStats(many);
  const ms = Date.now() - t0;
  console.log(`    기록 400건 → 누적 ${big.totalKm.toFixed(0)}km · ${ms}ms`);
  check(ms < 300, `기록이 많아도 통계가 즉시 나온다 (${ms}ms)`);
  const none = computeRunStats([]);
  check(none.totalKm === 0 && Number.isFinite(none.runsPerWeekRecent), '기록이 없어도 값이 전부 0 (NaN 아님)');
}

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

// ---------------------------------------------------------------------------
// 끊김 판단 (flowInfo) — ORS waytype 비율로 신호등 끊김을 추정
// ---------------------------------------------------------------------------
{
  console.log('\n[끊김 판단] ORS waytype 비율로 러닝 흐름을 추정하는지');
  const { flowInfo } = await bundle('src/lib/wayMix.ts', 'wayMix.mjs');

  const smooth = flowInfo({ trailPct: 85, roadPct: 10, softPct: 0, stepsM: 0 });
  check(smooth.level === 'smooth', `산책로 85% → '${smooth.level}' (smooth)`);
  check(smooth.text.includes('끊김 없이'), `텍스트: ${smooth.text}`);

  const mixed = flowInfo({ trailPct: 55, roadPct: 40, softPct: 0, stepsM: 0 });
  check(mixed.level === 'mixed', `산책로 55% → '${mixed.level}' (mixed)`);
  check(mixed.text.includes('가끔'), `텍스트에 '가끔': ${mixed.text}`);

  const choppy = flowInfo({ trailPct: 20, roadPct: 75, softPct: 0, stepsM: 0 });
  check(choppy.level === 'choppy', `차도 75% → '${choppy.level}' (choppy)`);
  check(choppy.text.includes('자주'), `텍스트에 '자주': ${choppy.text}`);

  const steps = flowInfo({ trailPct: 90, roadPct: 5, softPct: 0, stepsM: 150 });
  check(steps.level === 'choppy', `계단 150m → '${steps.level}' (choppy)`);
  check(steps.text.includes('계단'), `텍스트에 '계단': ${steps.text}`);

  // 모르는 건 말하지 않는다 — waytype 에 UNKNOWN(0) 이 섞이면 비율이 안 찬다
  check(
    flowInfo({ trailPct: 0, roadPct: 0, softPct: 0, stepsM: 0 }) === null,
    '전부 미분류(0%/0%) → 아무 말도 안 한다 (차도 0% 인데 신호등 잦다고 하던 문제)',
  );
  check(
    flowInfo({ trailPct: 20, roadPct: 15, softPct: 0, stepsM: 0 }) === null,
    '알려진 구간 35% 뿐 → 단정하지 않는다',
  );
  check(
    flowInfo({ trailPct: 35, roadPct: 30, softPct: 0, stepsM: 0 }) !== null,
    '알려진 구간 65% 면 말해도 된다',
  );
  // 계단은 절대량이라 분류 비율과 무관하게 확실하다
  check(
    flowInfo({ trailPct: 0, roadPct: 0, softPct: 0, stepsM: 200 })?.text.includes('계단'),
    '미분류라도 계단 200m 는 확실한 근거라 알린다',
  );
}

// ---------------------------------------------------------------------------
// 여름 그늘 재채점 (rescoreWithGreen) — OSM 녹지 데이터 반영
// ---------------------------------------------------------------------------
{
  console.log('\n[여름 그늘] rescoreWithGreen 이 정확히 동작하는지');
  const { rescoreWithGreen, isSummerSeason } = await bundle(
    'src/lib/courseBuilder.ts',
    'courseBuilder2.mjs',
  );

  const fakeBuilt = (matchScore, rawSum = matchScore / 100, rawW = 1.0) => ({
    route: { distanceKm: 5, ascentM: 50, coords: [] },
    styleEval: { style: 'flat', score: matchScore / 100, metrics: {}, reason: '' },
    pathEval: { pref: 'any', score: null, reason: null },
    distanceScore: 1,
    matchScore,
    label: 'test',
    _rawSum: rawSum,
    _rawW: rawW,
    _suspectGap: false,
  });

  // greenPct 가 null 이면 점수가 안 바뀐다
  const unchanged = rescoreWithGreen([fakeBuilt(80)], [null]);
  check(unchanged[0].matchScore === 80, `null greenPct → 점수 유지 (${unchanged[0].matchScore})`);

  // greenPct 를 넣었을 때 (여름이면 점수 변동, 비여름이면 유지)
  const withGreen = rescoreWithGreen([fakeBuilt(80), fakeBuilt(70)], [40, 10]);
  if (isSummerSeason()) {
    check(
      withGreen[0].matchScore !== 80 || withGreen[1].matchScore !== 70,
      '여름: greenPct 가 점수에 반영됐다',
    );
    check(
      withGreen[0].matchScore >= withGreen[1].matchScore,
      `여름: 숲길 40% 가 10% 보다 높다 (${withGreen[0].matchScore} ≥ ${withGreen[1].matchScore})`,
    );
  } else {
    check(
      withGreen[0].matchScore === 80 && withGreen[1].matchScore === 70,
      '비여름: 점수 유지',
    );
  }

  // greenPct 가 기록되는지
  check(withGreen[0].greenPct != null, 'greenPct 가 결과에 기록된다');

  // _suspectGap 이 있으면 감점
  const suspect = { ...fakeBuilt(80), _suspectGap: true };
  const rescored = rescoreWithGreen([suspect], [40]);
  if (isSummerSeason()) {
    check(rescored[0].matchScore < 50, `수역 의심 감점 적용됨 (${rescored[0].matchScore})`);
  }
}

// ---------------------------------------------------------------------------
// 녹지 조회 범위 — 목표 거리가 커져도 조회가 조용히 죽으면 안 된다
// ---------------------------------------------------------------------------
{
  console.log('\n[녹지 조회 범위] 1~15km 전 구간에서 실제로 조회되는지');
  const g = await bundle('src/lib/greenShare.ts', 'greenShare2.mjs');
  const span = (r) => 2 * (r / 111) + 2 * g.GREEN_MARGIN_DEG;

  let allFit = true;
  const rows = [];
  for (const loop of [true, false]) {
    for (let t = 1; t <= 15; t++) {
      const s = span(g.greenRadiusKm(t, loop));
      if (s > g.GREEN_MAX_SPAN_DEG) {
        allFit = false;
        rows.push(`${loop ? '왕복' : '편도'} ${t}km → ${s.toFixed(3)}° 초과`);
      }
    }
  }
  console.log(
    `    왕복 15km → 반경 ${g.greenRadiusKm(15, true).toFixed(1)}km · bbox ${span(g.greenRadiusKm(15, true)).toFixed(3)}° / 상한 ${g.GREEN_MAX_SPAN_DEG}°`,
  );
  console.log(
    `    편도 15km → 반경 ${g.greenRadiusKm(15, false).toFixed(1)}km · bbox ${span(g.greenRadiusKm(15, false)).toFixed(3)}°`,
  );
  check(allFit, `1~15km 왕복·편도 전부 조회 상한 안 (${rows.join(', ') || '초과 없음'})`);

  // 왕복은 갔다 오므로 편도보다 반경이 작아야 한다
  check(
    g.greenRadiusKm(10, true) < g.greenRadiusKm(10, false),
    `왕복 반경(${g.greenRadiusKm(10, true)}km) < 편도 반경(${g.greenRadiusKm(10, false).toFixed(1)}km)`,
  );
  // 기하학적으로 시작점에서 멀어지는 최대 거리를 덮어야 한다 (왕복 = 절반)
  check(
    g.greenRadiusKm(10, true) >= 10 / 2,
    `왕복 10km 반경이 최악(5km)을 덮는다 (${g.greenRadiusKm(10, true)}km)`,
  );
}

// ---------------------------------------------------------------------------
// 숲길 값 재사용 판정 — 이전 코스 값이 새 코스에 남으면 안 된다
// ---------------------------------------------------------------------------
{
  console.log('\n[숲길 재사용] 다시 찾기 후 이전 코스 값이 남지 않는지');
  const { greenIsFor } = await bundle('src/lib/greenShare.ts', 'greenShare3.mjs');

  const build1 = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  check(greenIsFor(build1, build1), '같은 결과면 받아둔 값을 그대로 쓴다');

  // 후보는 거의 항상 3개다 — 개수/내용으로 비교하면 여기서 뚫린다
  const build2 = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  check(
    !greenIsFor(build1, build2),
    '개수·내용이 같아도 다른 결과면 다시 받는다 (여의도 값이 강남 카드에 남던 문제)',
  );
  check(!greenIsFor(null, build1), '받아둔 값이 없으면 다시 받는다');
  check(!greenIsFor(null, null), '결과가 없으면 재사용도 없다');
}

// ---------------------------------------------------------------------------
// 잴 축이 하나도 없을 때 — 숫자를 지어내지도, NaN 을 내보내지도 않는다
// ---------------------------------------------------------------------------
{
  console.log('\n[매칭 점수] 잴 수 있는 기준이 없을 때 NaN 이 안 새는지');
  const cb = await bundle('src/lib/courseBuilder.ts', 'courseBuilder3.mjs');

  const coords = [
    [37.5, 127.0],
    [37.501, 127.001],
    [37.502, 127.002],
  ];
  const flatRoute = {
    coords,
    distanceKm: 2.4,
    ascentM: 0,
    maxGradePct: 0,
    elevations: [0, 0, 0],
    segments: [
      { lengthM: 1200, gradePct: 0 },
      { lengthM: 1200, gradePct: 0 },
    ],
    source: 'osrm',
    waypoints: coords,
    elevationKnown: false, // 고도 조회 실패
    way: undefined, //        OSRM 은 waytype 을 안 준다
  };
  const provider = {
    id: 'osrm',
    realRoads: true,
    route: async () => flatRoute,
    roundTrip: async () => flatRoute,
  };

  // 핀 모드(거리 목표 없음) + OSRM(waytype 없음) + 고도 실패 → 세 축 전부 null
  const res = await cb.buildFromPins([coords[0], coords[2]], 'flat', provider, {
    pathPref: 'any',
  });
  const m = res[0].matchScore;
  console.log(`    핀 모드 + OSRM + 고도 실패 → matchScore = ${m}`);
  check(!Number.isNaN(m), `NaN 이 아니다 (카드에 'NaN%' 가 뜨던 문제)`);
  check(m === null, `모르면 null 로 내보낸다 (0/100 을 지어내지 않는다)`);

  // 축이 하나라도 있으면 정상 점수가 나온다 (검사가 헛돌지 않게)
  const withDist = await cb.buildFromDistance([37.5, 127.0], 2.4, 'flat', provider, {});
  check(
    typeof withDist[0].matchScore === 'number' && !Number.isNaN(withDist[0].matchScore),
    `거리 목표가 있으면 점수가 나온다 (${withDist[0].matchScore})`,
  );
}

// ---------------------------------------------------------------------------
// 최상급 배지 — 모르는 값으로 '가장 ~' 이라고 하면 안 된다
// ---------------------------------------------------------------------------
{
  console.log('\n[최상급 배지] 고도를 모르는 코스가 가장 평탄을 가져가지 않는지');
  const { superlatives } = await bundle('src/lib/compare.ts', 'compare2.mjs');

  // 후보 하나만 고도 조회에 실패하면 ascentM 이 0 이라 자동으로 1등이 된다
  const mixed = superlatives([
    { ascentM: 120, distanceScore: 1, greenPct: null, elevKnown: true },
    { ascentM: 0, distanceScore: 1, greenPct: null, elevKnown: false }, // 모름
    { ascentM: 95, distanceScore: 1, greenPct: null, elevKnown: true },
  ]);
  check(
    !mixed.includes('가장 평탄'),
    `고도를 모르는 후보가 섞이면 평탄 배지를 안 붙인다 (${JSON.stringify(mixed)})`,
  );

  // 전부 알면 정상 동작 (검사가 헛돌지 않게)
  const known = superlatives([
    { ascentM: 120, distanceScore: 1, greenPct: null, elevKnown: true },
    { ascentM: 12, distanceScore: 1, greenPct: null, elevKnown: true },
  ]);
  check(known[1] === '가장 평탄', `전부 알면 실제로 평탄한 쪽에 붙는다 (${known[1]})`);
}

// ---------------------------------------------------------------------------
// '고도 모름'이 저장·공유를 건너도 살아남는지
// ---------------------------------------------------------------------------
{
  console.log("\n['고도 모름' 보존] 저장·공유 후에도 0m 로 둔갑하지 않는지");
  const sr = await bundle('src/lib/savedRoutes.ts', 'savedRoutes2.mjs');

  const coords = Array.from({ length: 20 }, (_, i) => [37.5 + i * 0.0004, 127.0 + i * 0.0004]);
  const unknownRoute = {
    coords,
    elevations: coords.map(() => 0),
    distanceKm: 2.1,
    ascentM: 0,
    maxGradePct: 0,
    source: 'osrm',
    waypoints: [coords[0]],
    segments: [],
    elevationKnown: false,
  };

  // 저장 → 복원
  const saved = sr.savedFromView({
    name: '고도 못 받은 코스',
    route: unknownRoute,
    kind: 'built',
    source: 'osrm',
  });
  check(saved.elevKnown === false, `저장 레코드에 '모름'이 실린다 (elevKnown=${saved.elevKnown})`);
  const restored = sr.toRouteResult(saved);
  check(
    restored.elevationKnown === false,
    `복원해도 '모름'이다 (열었을 때 상승 0m 로 단정하던 문제)`,
  );

  // 공유 링크 → 파싱
  const token = sr.buildShareToken({
    name: '고도 못 받은 코스',
    distanceKm: 2.1,
    ascentM: 0,
    maxGradePct: 0,
    source: 'osrm',
    coords,
    elevations: coords.map(() => 0),
    elevKnown: false,
  });
  const shared = sr.parseSharedFromHash(`#course=${token}`);
  check(
    shared?.route.elevationKnown === false,
    `공유 링크를 받은 쪽도 '모름'으로 본다 (${shared?.route.elevationKnown})`,
  );

  // 아는 코스는 지금까지처럼 그대로 (검사가 헛돌지 않게)
  const knownSaved = sr.savedFromView({
    name: '정상 코스',
    route: { ...unknownRoute, elevationKnown: true, ascentM: 88, maxGradePct: 7 },
    kind: 'built',
    source: 'ors',
  });
  check(knownSaved.elevKnown === undefined, '아는 코스엔 칸을 안 만든다 (용량 절약)');
  check(
    sr.toRouteResult(knownSaved).elevationKnown !== false,
    '아는 코스는 복원해도 정상 (상승 88m 유지)',
  );
}

// ---------------------------------------------------------------------------
// 미세먼지 — 못 받은 값을 '좋음'으로 단정하면 안 된다 (건강 판단에 쓰인다)
// ---------------------------------------------------------------------------
{
  console.log('\n[미세먼지] 대기질 서버만 죽었을 때 지어낸 값을 안 내놓는지');
  const W = await bundle('src/lib/weather.ts', 'weather.mjs');
  const wxBody = {
    current: {
      temperature_2m: 31,
      apparent_temperature: 35,
      relative_humidity_2m: 78,
      weather_code: 0,
      wind_speed_10m: 6,
      precipitation: 0,
      uv_index: 9,
    },
    utc_offset_seconds: 32400,
    hourly: { time: [], apparent_temperature: [] },
  };

  // 날씨는 성공, 대기질만 실패 (다른 호스트라 실제로 흔하다)
  globalThis.fetch = async (url) => {
    if (String(url).includes('air-quality')) throw new Error('down');
    return { ok: true, json: async () => wxBody };
  };
  const c = await W.getConditions([37.5665, 126.978]);
  console.log(`    pm2.5=${c.pm25} · 표기 "미세먼지 ${c.aqiLabel}" · ${c.runScore}점`);
  check(c.pm25 === null, `못 받은 pm2.5 는 null (12㎍/㎥ 로 채워 '좋음' 이라던 문제)`);
  check(c.aqiLevel === null, '등급도 null');
  check(c.aqiLabel === '정보 없음', `화면 표기가 '정보 없음' (${c.aqiLabel})`);
  check(
    !/딱 좋은 날/.test(c.headline),
    `모르는 날 '딱 좋은 날' 이라고 안 한다 — "${c.headline}"`,
  );
  check(/미세먼지/.test(c.headline), '헤드라인이 미세먼지를 모른다고 알린다');

  // 대기질이 나쁠 때는 그대로 경고해야 한다 (검사가 헛돌지 않게)
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes('air-quality') ? { current: { pm2_5: 82, pm10: 130 } } : wxBody,
  });
  const bad2 = await W.getConditions([37.5665, 126.978]);
  console.log(`    pm2.5=${bad2.pm25} → "${bad2.aqiLabel}" · ${bad2.runScore}점`);
  check(bad2.aqiLabel === '매우 나쁨', `나쁜 날은 그대로 경고한다 (${bad2.aqiLabel})`);
  check(bad2.runScore < c.runScore, `감점도 살아 있다 (${bad2.runScore} < ${c.runScore})`);
}

// ---------------------------------------------------------------------------
// GPX — 잰 적 없는 고도를 밖으로 내보내면 안 된다 (Strava·가민에 영구 기록)
// ---------------------------------------------------------------------------
{
  console.log('\n[GPX 내보내기] 모르는 고도를 <ele> 로 내보내지 않는지');
  const { buildGpx } = await bundle('src/lib/gpx.ts', 'gpx2.mjs');
  const coords = [
    [37.5, 127.0],
    [37.501, 127.001],
    [37.502, 127.002],
  ];
  const times = [1, 2, 3].map((i) => 1700000000000 + i * 1000);

  const unknown = buildGpx({
    name: '고도 못 받은 코스',
    coords,
    elevations: coords.map(() => 0),
    times,
    elevationKnown: false,
  });
  check(!unknown.includes('<ele>'), '고도를 모르면 <ele> 를 아예 안 쓴다');
  check(unknown.includes('<time>'), '시각은 그대로 나간다 (Strava 가 요구)');
  check((unknown.match(/<trkpt/g) ?? []).length === 3, '좌표는 전부 나간다 (3점)');

  const known = buildGpx({
    name: '정상 코스',
    coords,
    elevations: [12.5, 18.25, 24],
    times,
    elevationKnown: true,
  });
  check(known.includes('<ele>12.5</ele>'), '아는 고도는 그대로 나간다 (검사가 헛돌지 않게)');
  check((known.match(/<ele>/g) ?? []).length === 3, '3점 전부 고도가 붙는다');

  // 기본값은 지금까지처럼 '안다' (예전 호출부가 안 깨지게)
  const legacy = buildGpx({ name: 'x', coords, elevations: [1, 2, 3] });
  check(legacy.includes('<ele>'), 'elevationKnown 을 안 넘기면 기존 동작 유지');
}

// ---------------------------------------------------------------------------
// 날씨 본문이 망가져 와도 지어낸 날씨를 '실시간'으로 내보내지 않는지
// ---------------------------------------------------------------------------
{
  console.log('\n[날씨 본문] 200 이어도 알맹이가 없으면 예시로 넘기는지');
  const W = await bundle('src/lib/weather.ts', 'weather2.mjs');
  const aqBody = { current: { pm2_5: 8, pm10: 15 } };

  // current 블록이 통째로 없는 경우 (응답 형식 변경·에러 본문)
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => (String(url).includes('air-quality') ? aqBody : { hourly: {} }),
  });
  const empty = await W.getConditions([37.5665, 126.978]);
  console.log(`    current 없음 → ${empty.tempC}° · source=${empty.source}`);
  check(
    empty.source === 'sample',
    `본문이 비면 '예시'로 밝힌다 (13°·습도55%·바람8 을 live 로 내보내던 문제)`,
  );

  // 기온만 빠진 경우
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes('air-quality')
        ? aqBody
        : { current: { relative_humidity_2m: 60, weather_code: 0 }, hourly: {} },
  });
  const noTemp = await W.getConditions([37.5665, 126.978]);
  check(noTemp.source === 'sample', `기온이 없으면 예시로 넘긴다 (source=${noTemp.source})`);

  // 체감온도만 없으면 기온으로 대신한다 (지어내는 게 아니라 같은 뜻의 값)
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes('air-quality')
        ? aqBody
        : {
            current: { temperature_2m: 21, relative_humidity_2m: 60, weather_code: 0 },
            utc_offset_seconds: 32400,
            hourly: {},
          },
  });
  const noFeels = await W.getConditions([37.5665, 126.978]);
  check(
    noFeels.source === 'live' && noFeels.tempC === 21 && noFeels.feelsC === 21,
    `체감만 없으면 기온으로 대신하고 live 유지 (${noFeels.tempC}°/${noFeels.feelsC}° ${noFeels.source})`,
  );
}

// ---------------------------------------------------------------------------
// 진행률 최적화 — 빨라지되 값이 달라지면 안 된다
// ---------------------------------------------------------------------------
{
  console.log('\n[진행률 최적화] O(1) 로 바꾼 값이 이전과 같은지');
  const RP = await bundle('src/lib/routeProgress.ts', 'routeProgress.mjs');
  const n = 3000;
  const path = Array.from({ length: n }, (_, i) => [
    37.5 + i * 0.000045 + (i % 7) * 0.000004,
    127.0 + Math.sin(i / 90) * 0.0012,
  ]);
  const cum = RP.cumulativeMeters(path);

  let maxRemain = 0;
  let maxRatio = 0;
  for (const idx of [0, 1, 500, 1500, n - 1]) {
    maxRemain = Math.max(
      maxRemain,
      Math.abs(RP.remainingMeters(path, idx) - RP.remainingFromCum(cum, idx)),
    );
    maxRatio = Math.max(
      maxRatio,
      Math.abs(RP.progressRatio(path, idx) - RP.ratioFromCum(cum, idx)),
    );
  }
  console.log(
    `    ${n}점 · 총 ${(cum[n - 1] / 1000).toFixed(2)}km · 최대 오차 ${maxRemain.toExponential(1)}m`,
  );
  check(maxRemain < 1e-6, `남은 거리가 이전과 같다 (오차 ${maxRemain.toExponential(1)}m)`);
  check(maxRatio < 1e-9, `진행률이 이전과 같다 (오차 ${maxRatio.toExponential(1)})`);

  // 범위 밖 인덱스에도 안 깨진다
  check(RP.ratioFromCum(cum, -5) === 0, '음수 인덱스는 0%');
  check(RP.ratioFromCum(cum, 99999) === 1, '끝을 넘는 인덱스는 100%');
  check(RP.remainingFromCum(cum, 99999) === 0, '끝을 넘으면 남은 거리 0');
  check(RP.ratioFromCum([0], 0) === 0, '점이 하나뿐이면 0% (0으로 안 나눈다)');

  // 실제로 빨라졌는지 (검사가 헛돌지 않게)
  const TICKS = 600;
  let t0 = performance.now();
  for (let k = 0; k < TICKS; k++) {
    RP.remainingMeters(path, k % n);
    RP.progressRatio(path, k % n);
  }
  const oldMs = performance.now() - t0;
  t0 = performance.now();
  for (let k = 0; k < TICKS; k++) {
    RP.remainingFromCum(cum, k % n);
    RP.ratioFromCum(cum, k % n);
  }
  const newMs = performance.now() - t0;
  console.log(`    ${TICKS}틱: ${oldMs.toFixed(0)}ms → ${newMs.toFixed(1)}ms`);
  check(newMs * 10 < oldMs, `최소 10배 빨라졌다 (${(oldMs / newMs).toFixed(0)}배)`);
}

// ---------------------------------------------------------------------------
// 백업 파일에 계정 자격증명이 담기면 안 된다
// ---------------------------------------------------------------------------
{
  console.log('\n[백업 파일] Strava 토큰이 내려받는 파일에 안 담기는지');
  const backup2 = await bundle('src/lib/backup.ts', 'backup2.mjs');
  const TOKEN_KEY = 'run-app-strava-token-v1';

  localStorage.setItem('run-app-routes-v1', JSON.stringify([]));
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({ access: 'SECRET_ACCESS', refresh: 'SECRET_REFRESH', expiresAt: 1 }),
  );

  // 계정 백업(cloud)은 본인 인증된 자리라 토큰을 그대로 담는다
  const cloudPayload = backup2.collectBackup();
  check(TOKEN_KEY in cloudPayload.data, '계정 백업에는 토큰이 그대로 담긴다 (기기 이동용)');

  // 파일로 내려받을 때는 빠져야 한다
  let written = '';
  globalThis.Blob = class {
    constructor(parts) {
      written = String(parts[0]);
    }
  };
  globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
  const el = { href: '', download: '', click() {}, remove() {} };
  globalThis.document = {
    createElement: () => el,
    body: { appendChild() {} },
  };
  backup2.exportBackupFile();
  check(written.length > 0, '파일 내용이 실제로 만들어졌다 (검사가 헛돌지 않게)');
  check(!written.includes('SECRET_ACCESS'), '액세스 토큰이 파일에 없다');
  check(!written.includes('SECRET_REFRESH'), '리프레시 토큰이 파일에 없다');
  check(written.includes('run-app-routes-v1'), '나머지 데이터는 그대로 담긴다');

  localStorage.removeItem(TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// 공유 링크는 '남이 보내는 데이터'다 — 어떤 값이 와도 앱이 죽으면 안 된다
// ---------------------------------------------------------------------------
{
  console.log('\n[공유 링크 방어] 조작된 payload 로 앱이 깨지지 않는지');
  const sr3 = await bundle('src/lib/savedRoutes.ts', 'savedRoutes3.mjs');
  const coords = Array.from({ length: 20 }, (_, i) => [37.5 + i * 0.0004, 127.0 + i * 0.0004]);
  const token = sr3.buildShareToken({
    name: '한강 러닝',
    distanceKm: 5,
    ascentM: 30,
    maxGradePct: 4,
    source: 'ors',
    coords,
    elevations: coords.map(() => 10),
  });
  const b64 = (s) =>
    Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const base = JSON.parse(
    Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
  );
  const parse = (patch) => sr3.parseSharedFromHash('#course=' + b64(JSON.stringify({ ...base, ...patch })));

  // 이름이 객체면 React 가 렌더 중 던져 앱이 오류 화면으로 넘어갔다
  for (const [label, n] of [
    ['객체', { evil: 1 }],
    ['배열', ['a']],
    ['숫자', 123],
    ['없음', undefined],
    ['공백만', '   '],
  ]) {
    const r = parse({ n });
    check(
      typeof r?.name === 'string' && r.name.length > 0,
      `이름이 ${label} 이어도 문자열로 나온다 (${JSON.stringify(r?.name)})`,
    );
  }

  const long = parse({ n: '가'.repeat(100000) });
  console.log(`    10만자 이름 → ${long.name.length}자`);
  check(long.name.length <= 61, `긴 이름은 잘린다 (${long.name.length}자 — 화면·저장소 보호)`);

  check(parse({ s: { x: 1 } })?.style === undefined, '스타일이 객체면 버린다');
  check(parse({ s: 'flat' })?.style === 'flat', '정상 스타일은 그대로 (검사가 헛돌지 않게)');
  check(typeof parse({ src: { x: 1 } })?.source === 'string', 'source 가 객체여도 문자열로 나온다');
  check(parse({})?.name === '한강 러닝', '정상 링크는 이름이 그대로 (검사가 헛돌지 않게)');
}

console.log(`\n통과 ${ok.length} / 실패 ${bad.length}`);
if (bad.length) process.exit(1);
