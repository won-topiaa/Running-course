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
const { thinWaypoints, haversineMeters, pathLengthMeters, spurKeptIndices } =
  await bundle('src/lib/geo.ts', 'g.mjs');
const { courseLaps, lapDistanceKm } = await bundle('src/lib/types.ts', 't.mjs');

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

// 끝점은 언제나 남는다
for (const [name, pts] of [['곁가지', spur], ['블록', blk], ['왕복', ob], ['2개', two]]) {
  const k = spurKeptIndices(pts);
  check(k[0] === 0 && k[k.length - 1] === pts.length - 1, `${name}: 시작·끝 좌표는 언제나 남는다`);
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
