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

console.log(`\n통과 ${ok.length} / 실패 ${bad.length}`);
if (bad.length) process.exit(1);
