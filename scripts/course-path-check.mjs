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
const { thinWaypoints, haversineMeters, pathLengthMeters } = await bundle('src/lib/geo.ts', 'g.mjs');

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

console.log(`\n결과: ${ok.length} 통과, ${bad.length} 실패`);
if (bad.length) {
  for (const m of bad) console.log('  ❌ ' + m);
  process.exit(1);
}
