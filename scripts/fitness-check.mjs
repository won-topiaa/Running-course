// 체력 처방 로직 검증.
//   node scripts/fitness-check.mjs
//
// 이 기능의 가장 큰 위험은 '모르는 걸 아는 척하는 것' 이다. 표본이 없거나
// 모자랄 때 백분위를 지어내면, 사용자는 국가 기준으로 진단받았다고 믿는다.
// 그래서 검사의 절반이 "이럴 때는 null 이어야 한다" 이다.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ft-'));
const bundle = async (e, n) => {
  const o = join(dir, n);
  await build({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, logLevel: 'error' });
  return import(o);
};

const ok = [];
const bad = [];
const check = (c, m) => {
  (c ? ok : bad).push(m);
  console.log((c ? '  ✅ ' : '  ❌ ') + m);
};

const F = await bundle('src/lib/fitness.ts', 'f.mjs');
const K = await bundle('src/lib/kspoFitness.ts', 'k.mjs');
const S = await bundle('src/lib/scoring.ts', 's.mjs');
const { COURSES } = await bundle('src/data/courses.ts', 'c.mjs');

// 표본 만들기 — 1..N 오름차순
const seq = (n) => Array.from({ length: n }, (_, i) => i + 1);

console.log('\n[백분위] 표본이 뒷받침할 때만 계산한다');
check(F.percentileOf(seq(29), 15, false) === null, `표본 29개(<${F.MIN_SAMPLES})면 백분위를 내지 않는다`);
check(F.percentileOf(undefined, 15, false) === null, '표본이 아예 없으면 null');
check(F.percentileOf(seq(100), NaN, false) === null, '값이 NaN 이면 null');
{
  const p = F.percentileOf(seq(100), 51, false);
  check(p === 50, `높을수록 좋은 항목: 100개 중 51 → 상위 ${p}%`);
  const q = F.percentileOf(seq(100), 51, true);
  check(q === 50, `낮을수록 좋은 항목은 뒤집힌다 → ${q}%`);
  const lowGood = F.percentileOf(seq(100), 11, true);
  const lowBad = F.percentileOf(seq(100), 11, false);
  check(lowGood > lowBad, `체지방률 11은 좋고(${lowGood}) 악력 11은 나쁘다(${lowBad})`);
}

console.log('\n[평가] 모르면 모른다고 한다');
{
  const norm = { sex: 'male', ageBand: '30대', n: 100, source: 'test',
    samples: { vo2max: seq(100), bodyFatPct: seq(100) } };
  const empty = F.emptyFitnessProfile();
  const a1 = F.assess(empty, norm);
  check(a1.overall === null && !!a1.missing, `프로필이 비면 null + 안내 문구 ("${a1.missing}")`);

  const noMeasure = { ...empty, birthYear: 1994, sex: 'male' };
  const a2 = F.assess(noMeasure, norm);
  check(a2.overall === null && a2.missing.includes('측정값'), '나이·성별만 있으면 측정값을 요청한다');

  const withM = { ...noMeasure, measured: { vo2max: 51, bodyFatPct: 51 } };
  check(F.assess(withM, null).overall === null, '기준 분포를 못 받으면 백분위를 내지 않는다');

  const a3 = F.assess(withM, norm);
  check(a3.overall != null && a3.items.length === 2, `측정값+분포가 다 있으면 계산한다 (종합 ${a3.overall}%)`);
  check(a3.overall >= 0 && a3.overall <= 100, '종합 백분위는 0~100');

  const thin = { ...norm, samples: { vo2max: seq(10) }, counts: { vo2max: 10 } };
  const a4 = F.assess({ ...noMeasure, measured: { vo2max: 45 } }, thin);
  check(a4.overall === null && a4.missing.includes('표본'), '표본이 모자라면 그 이유를 말한다');
}

console.log('\n[처방] 근거 없이는 처방하지 않는다');
check(F.prescribe(null, 30) === null, '백분위를 모르면 처방 없음');
check(F.prescribe(50, null) === null, '나이를 모르면 처방 없음');
{
  const low = F.prescribe(10, 30), mid = F.prescribe(50, 30), high = F.prescribe(90, 30);
  check(low.sessionKm.max < high.sessionKm.max, `체력이 좋을수록 긴 거리 (${low.sessionKm.max} < ${high.sessionKm.max}km)`);
  check(low.maxAscentPerKm < high.maxAscentPerKm, `체력이 좋을수록 경사 허용 (${low.maxAscentPerKm} < ${high.maxAscentPerKm}m/km)`);
  check(mid.sessionKm.min > 0 && mid.perWeek > 0, '중간 등급도 유효한 처방');
  const old = F.prescribe(50, 65);
  check(old.sessionKm.max < mid.sessionKm.max, `같은 백분위라도 고령은 완충 (${old.sessionKm.max} < ${mid.sessionKm.max}km)`);
  check(
    low.basis.includes('국민체육진흥공단') && low.basis.includes('앱이 정한'),
    '처방 근거에 데이터 출처와 앱 자체 기준을 함께 밝힌다',
  );
}

console.log('\n[코스 적합도] 처방이 없으면 축을 빼고 돈다');
{
  const c = COURSES[0];
  check(F.courseFitScore(c, null) === null, '처방이 없으면 null (0점이 아니다)');
  check(F.fitLabel(c, null) === null, '처방이 없으면 라벨도 없다');
  const rx = F.prescribe(50, 30);
  for (const course of COURSES) {
    const s = F.courseFitScore(course, rx);
    if (!(s >= 0 && s <= 1)) { check(false, `${course.id}: 적합도 ${s}`); break; }
  }
  check(true, `코스 ${COURSES.length}개 전부 적합도 0~1`);
  const near = F.courseFitScore({ ...c, distanceKm: 4.5 }, rx);
  const far = F.courseFitScore({ ...c, distanceKm: 20 }, rx);
  check(near > far, `권장 구간 안(4.5km ${near.toFixed(2)}) > 크게 벗어남(20km ${far.toFixed(2)})`);
}

console.log('\n[추천 통합] 체력을 몰라도 기존과 똑같이 돈다');
{
  const prefs = S.defaultPreferences();
  const before = S.recommend(COURSES, prefs).map((r) => `${r.course.id}:${r.matchScore}`).join('|');
  const same = S.recommend(COURSES, prefs, null).map((r) => `${r.course.id}:${r.matchScore}`).join('|');
  check(before === same, '처방 없이 부르면 결과가 이전과 동일 (회귀 없음)');

  const rx = F.prescribe(20, 30); // 체력이 낮은 사람
  const withRx = S.recommend(COURSES, prefs, rx);
  check(withRx.length === COURSES.length, '체력 축이 붙어도 전체 코스를 반환');
  check(withRx.every((r) => r.matchScore >= 0 && r.matchScore <= 100), '점수는 여전히 0~100');
  check(
    withRx.every((r) => [...r.reasons, ...r.cautions].every((t) => !/NaN|undefined/.test(t))),
    '문구에 NaN·undefined 없음',
  );
  const longCourse = withRx.find((r) => r.course.distanceKm >= 8);
  check(
    !longCourse || longCourse.cautions.some((t) => t.includes('도전적')),
    '체력이 낮으면 긴 코스에 주의 문구가 붙는다',
  );
  const orderChanged = withRx.map((r) => r.course.id).join('|') !== S.recommend(COURSES, prefs).map((r) => r.course.id).join('|');
  check(orderChanged, '체력을 알면 추천 순서가 실제로 달라진다 (축이 살아 있다)');
}

console.log('\n[응답 파싱] 쓰레기 값이 분포를 오염시키지 않는다');
{
  const rows = [
    { test_sex: 'M', age_degree: 33, item_f037: 40, item_f003: 18 },
    { test_sex: 'M', age_degree: 35, item_f037: 50, item_f003: 0 },  // 0 = 측정 안 함
    { test_sex: 'F', age_degree: 33, item_f037: 99 },                // 다른 성별
    { test_sex: 'M', age_degree: 55, item_f037: 99 },                // 다른 연령대
    { test_sex: 'M', age_degree: 31, item_f037: '30' },              // 문자열 숫자
    null, 'garbage', { },                                            // 깨진 행
  ];
  const n = K.normFromRows(rows, 'male', '30대', 'test');
  check(n.n === 3, `30대 남성 3명만 집계 (${n.n}명)`);
  check(JSON.stringify(n.samples.vo2max) === '[30,40,50]', `문자열 숫자 변환 + 오름차순 정렬 (${n.samples.vo2max})`);
  check(JSON.stringify(n.samples.bodyFatPct) === '[18]', '0 은 표본에서 제외 (측정 안 함)');
  check(K.normFromRows([], 'male', '30대', 't').n === 0, '빈 응답이면 표본 0');
}

console.log('\n[추정 통합] 실측이 없으면 추정으로, 있으면 실측이 이긴다');
{
  const norm = { sex: 'male', ageBand: '30대', n: 3000, source: 'test',
    samples: { vo2max: seq(100).map((v) => 25 + v * 0.3) },
    counts: { vo2max: 3000 } };
  const base = { birthYear: 1994, sex: 'male', measured: {}, measuredAt: null };

  const noneA = F.assess(base, norm, {});
  check(noneA.overall === null, '실측도 추정도 없으면 백분위 없음');
  check(
    noneA.missing.includes('러닝을 몇 번 기록'),
    `추정 경로를 먼저 안내한다 ("${noneA.missing.slice(0, 30)}…")`,
  );

  const est = F.assess(base, norm, { vo2max: 45 });
  check(est.overall != null, `추정만 있어도 백분위가 나온다 (상위 ${100 - est.overall}%)`);
  check(est.items[0].estimated === true, '추정임을 표시한다 (estimated=true)');

  const both = F.assess({ ...base, measured: { vo2max: 55 } }, norm, { vo2max: 45 });
  check(both.items[0].value === 55, '실측과 추정이 겹치면 실측을 쓴다');
  check(both.items[0].estimated === false, '실측은 추정 표시가 없다');

  // 상식 밖 추정치는 걸러진다
  const junk = F.assess(base, norm, { vo2max: 900 });
  check(junk.overall === null, '상식 밖 추정치(900)는 쓰지 않는다');
}

console.log('\n[번들 데이터] 공단 API 로 수집한 실제 기준 분포');
{
  const bundled = JSON.parse(
    (await import('node:fs')).readFileSync('src/data/fitnessNorm.json', 'utf8'),
  );
  check(Array.isArray(bundled.norms) && bundled.norms.length >= 10,
    `집단 ${bundled.norms?.length ?? 0}개 (남녀 × 연령대)`);
  check(typeof bundled.source === 'string' && bundled.source.includes('국민체육진흥공단'),
    '출처가 기록돼 있다 (보고서에 그대로 쓴다)');
  check(!!bundled.fetchedAt && !!bundled.endpoint, `수집일 ${bundled.fetchedAt} · 엔드포인트 기록`);

  // 분포가 사람 값인지 — 생리학적으로 알려진 방향을 확인한다
  const find = (sex, band) => bundled.norms.find((n) => n.sex === sex && n.ageBand === band);
  const med = (n, item) => { const a = n?.samples?.[item]; return a ? a[Math.floor(a.length / 2)] : null; };
  const m20 = find('male', '20대'), m60 = find('male', '60대'), f20 = find('female', '20대');
  check(med(m20, 'vo2max') > med(m60, 'vo2max'),
    `VO₂max 가 나이 들며 낮아진다 (남 20대 ${med(m20, 'vo2max')} > 60대 ${med(m60, 'vo2max')})`);
  check(med(m20, 'gripKg') > med(f20, 'gripKg'),
    `악력 남>여 (${med(m20, 'gripKg')} > ${med(f20, 'gripKg')})`);
  check(med(f20, 'bodyFatPct') > med(m20, 'bodyFatPct'),
    `체지방율 여>남 (${med(f20, 'bodyFatPct')} > ${med(m20, 'bodyFatPct')})`);
  for (const n of bundled.norms) {
    for (const [item, arr] of Object.entries(n.samples)) {
      const sorted = arr.every((v, i) => i === 0 || arr[i - 1] <= v);
      if (!sorted) { check(false, `${n.sex} ${n.ageBand} ${item}: 정렬 깨짐`); break; }
      const bad = arr.filter((v) => !F.isPlausible(item, v));
      if (bad.length) { check(false, `${n.sex} ${n.ageBand} ${item}: 상식 밖 값 ${bad.length}개`); break; }
    }
  }
  check(true, '모든 집단의 표본이 정렬돼 있고 상식 범위 안');

  // 실제 분포로 백분위를 내 본다 — 중앙값을 넣으면 50% 근처여야 한다
  const midVo2 = med(m20, 'vo2max');
  const a = F.assess(
    { birthYear: new Date().getFullYear() - 25, sex: 'male', measured: { vo2max: midVo2 }, measuredAt: null },
    m20,
  );
  check(a.overall != null && Math.abs(a.overall - 50) <= 8,
    `중앙값(VO₂max ${midVo2})을 넣으면 상위 ${a.overall == null ? '?' : 100 - a.overall}% 근처`);
}

console.log('\n[버전 변화 방어] 예전에 저장된 항목이 남아 있어도 안 터진다');
{
  // 항목 집합은 API 커버리지에 따라 바뀐다. 기기에 남은 옛 항목이 그대로
  // 되살아나면 범위 검사가 없는 항목을 만나 렌더 중에 터진다.
  check(F.isPlausible('jumpReps', 40) === false, '모르는 항목은 false (터지지 않는다)');
  check(F.isKnownItem('vo2max') === true, '현재 항목은 known');
  check(F.isKnownItem('sitUpReps') === false, '삭제된 항목은 unknown');
  const stale = { birthYear: 1994, sex: 'male', measured: { jumpReps: 40, vo2max: 45 }, measuredAt: null };
  let threw = false;
  try { F.assess(stale, { sex: 'male', ageBand: '30대', n: 100, samples: { vo2max: seq(100) } }); }
  catch { threw = true; }
  check(!threw, '옛 항목이 섞인 프로필로 평가해도 예외 없음');
}

console.log(`\n결과: ${ok.length} 통과, ${bad.length} 실패`);
if (bad.length) { for (const m of bad) console.log('  ❌ ' + m); process.exit(1); }
