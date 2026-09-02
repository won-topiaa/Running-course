// 측정건수 데이터 통합 검증 (데이터셋 15114286 실데이터 기준)
//
// 이 데이터셋의 실제 스키마는 center_nm / center_addr1 / test_ym / test_cnt 뿐이다.
// 연령대·좌표 필드는 없다 — 그래서 연령 분포는 검증 대상이 아니라 '비어 있어야 하는'
// 대상이다. 시드 시절에 있던 연령 분포는 지어낸 값이었고, 그걸 다시 만들지 않도록
// 여기서 막는다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_PATH = resolve('src/data/testCounts.json');
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
}

// ---- 1. 데이터 무결성 ----
const raw = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
ok(raw.source.includes('측정건수'), '출처 표기');
ok(raw.endpoint.includes('TODZ_NFA_TEST_CENTER_CNT'), '엔드포인트 표기');
ok(raw.seed !== true, '시드 플래그가 없다 (실데이터)');
ok(typeof raw.collectedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.collectedAt), '수집일 표기');
ok(/^\d{6}$/.test(raw.latestMonth ?? ''), `최신 측정 연월 YYYYMM (${raw.latestMonth})`);
ok(typeof raw.totalInApi === 'number' && raw.totalInApi > 1000, `API 전체 행 수 (${raw.totalInApi})`);
ok(
  typeof raw.totalMeasurements === 'number' && raw.totalMeasurements > 1_000_000,
  `누적 측정건수 100만 이상 (${raw.totalMeasurements?.toLocaleString()})`,
);

// yearlyTrend
ok(Array.isArray(raw.yearlyTrend), '연도별 추세 배열');
ok(raw.yearlyTrend.length >= 10, `최소 10개년 (${raw.yearlyTrend.length})`);
for (const y of raw.yearlyTrend) {
  ok(typeof y.year === 'number' && y.year >= 2010 && y.year <= 2030, `${y.year}: 연도 범위`);
  ok(typeof y.totalTests === 'number' && y.totalTests > 0, `${y.year}: 측정 건수 양수`);
  ok(typeof y.centers === 'number' && y.centers > 0, `${y.year}: 센터 수 양수`);
  ok(Number.isInteger(y.totalTests), `${y.year}: 측정 건수 정수`);
}

// 연도 정렬 / 중복
const years = raw.yearlyTrend.map(y => y.year);
ok(years.every((y, i) => i === 0 || y > years[i - 1]), '연도 오름차순 정렬');
ok(new Set(years).size === years.length, '연도 중복 없음');

// 완결 연도만 들어 있어야 한다 — 진행 중인 해가 추세에 섞이면 급감처럼 보인다
const latestYearInData = Number(raw.latestMonth.slice(0, 4));
const latestMonthNo = Number(raw.latestMonth.slice(4, 6));
const expectedLastFull = latestMonthNo === 12 ? latestYearInData : latestYearInData - 1;
ok(
  years[years.length - 1] === expectedLastFull,
  `마지막 연도가 완결 연도 (${years[years.length - 1]} === ${expectedLastFull})`,
);

// 연도별 합이 누적치를 넘지 않는다 (누적은 2010년 이전 자료도 포함할 수 있다)
const trendSum = raw.yearlyTrend.reduce((s, y) => s + y.totalTests, 0);
ok(trendSum <= raw.totalMeasurements, `연도합 ≤ 누적 (${trendSum} ≤ ${raw.totalMeasurements})`);

// 연령 분포는 이 데이터셋으로 만들 수 없다 — 비어 있어야 한다
ok(Array.isArray(raw.ageDistribution), '연령 분포 필드 존재');
ok(raw.ageDistribution.length === 0, '연령 분포는 비어 있다 (API에 연령 필드가 없다)');

// seoulCenters
ok(Array.isArray(raw.seoulCenters), '서울 센터 배열');
ok(raw.seoulCenters.length >= 10, `서울 10곳 이상 (${raw.seoulCenters.length})`);
for (const c of raw.seoulCenters) {
  ok(typeof c.name === 'string' && c.name.length > 0, `${c.name}: 이름`);
  ok(typeof c.address === 'string' && c.address.startsWith('서울'), `${c.name}: 서울 주소`);
  ok(typeof c.totalTests === 'number' && c.totalTests > 0, `${c.name}: 측정건수 양수`);
  ok(Number.isInteger(c.totalTests), `${c.name}: 측정건수 정수`);
}

// 센터 이름 중복 없음 (집계 키였으므로)
const names = raw.seoulCenters.map(c => c.name);
ok(new Set(names).size === names.length, '센터 이름 중복 없음');

// 측정건수 내림차순 정렬
const counts = raw.seoulCenters.map(c => c.totalTests);
ok(counts.every((v, i) => i === 0 || v <= counts[i - 1]), '서울 센터 측정건수 내림차순');

// ---- 2. testCounts.ts 모듈 로직 검증 ----

function formatCount(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}천`;
  return String(n);
}
ok(formatCount(523800) === '52.4만', 'formatCount 52.4만');
ok(formatCount(10000) === '1.0만', 'formatCount 1.0만');
ok(formatCount(5000) === '5.0천', 'formatCount 5.0천');
ok(formatCount(999) === '999', 'formatCount 999');
ok(formatCount(100) === '100', 'formatCount 100');
ok(formatCount(0) === '0', 'formatCount 0');

// recentTrend
function recentTrend(n) {
  return raw.yearlyTrend.slice(-n);
}
const recent5 = recentTrend(5);
ok(recent5.length === 5, '최근 5개년 길이');
ok(recent5[0].year === raw.yearlyTrend[raw.yearlyTrend.length - 5].year, '최근 5개년 시작');
ok(recent5[4].year === raw.yearlyTrend[raw.yearlyTrend.length - 1].year, '최근 5개년 끝');
ok(recentTrend(999).length === raw.yearlyTrend.length, '요청이 넘쳐도 전체까지만');

// growthRate
function growthRate() {
  const trend = raw.yearlyTrend;
  if (trend.length < 2) return 0;
  const first = trend[0];
  const last = trend[trend.length - 1];
  if (first.totalTests === 0) return 0;
  return ((last.totalTests - first.totalTests) / first.totalTests) * 100;
}
const gr = growthRate();
ok(Number.isFinite(gr), '성장률이 유한값');
ok(gr > 0, `성장률 양수 (${gr.toFixed(0)}%)`);

// topSeoulCenters
function topSeoulCenters(n) {
  return [...raw.seoulCenters].sort((a, b) => b.totalTests - a.totalTests).slice(0, n);
}
const top5 = topSeoulCenters(5);
ok(top5.length === Math.min(5, raw.seoulCenters.length), 'top5 길이');
ok(
  top5.every((c, i) => i === 0 || c.totalTests <= top5[i - 1].totalTests),
  'top5 내림차순',
);
ok(topSeoulCenters(999).length === raw.seoulCenters.length, 'top 요청이 넘쳐도 전체까지만');
ok(topSeoulCenters(0).length === 0, 'top0 은 빈 배열');

// seoulTotalTests
function seoulTotalTests() {
  return raw.seoulCenters.reduce((sum, c) => sum + c.totalTests, 0);
}
const seoulTotal = seoulTotalTests();
ok(seoulTotal > 50000, `서울 총 측정건수 5만 이상 (${seoulTotal.toLocaleString()})`);
ok(seoulTotal <= raw.totalMeasurements, '서울 합 ≤ 전국 누적');

// 빈 데이터에서도 안 터진다 (latestYear 가 null 을 돌려주는 경로)
function latestYearOf(trend) {
  return trend[trend.length - 1] ?? null;
}
ok(latestYearOf([]) === null, '빈 추세에서 latestYear 는 null');
ok(latestYearOf(raw.yearlyTrend) !== null, '실데이터에서 latestYear 는 값이 있다');

// ---- 3. 데이터 일관성 ----

// 센터 수는 장기적으로 증가한다
const firstHalf = raw.yearlyTrend.slice(0, Math.floor(raw.yearlyTrend.length / 2));
const secondHalf = raw.yearlyTrend.slice(Math.floor(raw.yearlyTrend.length / 2));
const avgFirst = firstHalf.reduce((s, y) => s + y.centers, 0) / firstHalf.length;
const avgSecond = secondHalf.reduce((s, y) => s + y.centers, 0) / secondHalf.length;
ok(avgSecond > avgFirst, `센터 수 증가 추세 (${avgFirst.toFixed(0)} → ${avgSecond.toFixed(0)})`);

// 2020년 코로나 급감이 실제로 찍혀 있다 — 실데이터임을 보여주는 지문이다
const y2019 = raw.yearlyTrend.find(y => y.year === 2019);
const y2020 = raw.yearlyTrend.find(y => y.year === 2020);
if (y2019 && y2020) {
  ok(y2020.totalTests < y2019.totalTests, `2020 코로나 급감 (${y2019.totalTests} → ${y2020.totalTests})`);
}

// ---- 결과 ----
console.log(`\n측정건수 검증: ${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail > 0 ? 1 : 0);
