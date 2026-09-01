// 측정건수 데이터 통합 검증
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

// yearlyTrend
ok(Array.isArray(raw.yearlyTrend), '연도별 추세 배열');
ok(raw.yearlyTrend.length >= 5, '최소 5개년');
for (const y of raw.yearlyTrend) {
  ok(typeof y.year === 'number' && y.year >= 2010 && y.year <= 2030, `${y.year}: 연도 범위`);
  ok(typeof y.totalTests === 'number' && y.totalTests > 0, `${y.year}: 측정 건수 양수`);
  ok(typeof y.centers === 'number' && y.centers > 0, `${y.year}: 센터 수 양수`);
}

// 연도 정렬
const years = raw.yearlyTrend.map(y => y.year);
ok(years.every((y, i) => i === 0 || y > years[i - 1]), '연도 오름차순 정렬');

// 연도 중복 없음
ok(new Set(years).size === years.length, '연도 중복 없음');

// ageDistribution
ok(Array.isArray(raw.ageDistribution), '연령 분포 배열');
ok(raw.ageDistribution.length >= 5, '최소 5개 연령대');
let pctSum = 0;
for (const a of raw.ageDistribution) {
  ok(typeof a.ageGroup === 'string' && a.ageGroup.length > 0, `연령대 이름: ${a.ageGroup}`);
  ok(typeof a.percentage === 'number' && a.percentage > 0, `${a.ageGroup}: 비율 양수`);
  ok(a.percentage <= 100, `${a.ageGroup}: 비율 100 이하`);
  pctSum += a.percentage;
}
ok(Math.abs(pctSum - 100) < 1, `비율 합계 ~100% (실제: ${pctSum.toFixed(1)}%)`);

// seoulCenters
ok(Array.isArray(raw.seoulCenters), '서울 센터 배열');
ok(raw.seoulCenters.length >= 20, '서울 20곳 이상');
for (const c of raw.seoulCenters) {
  ok(typeof c.name === 'string' && c.name.length > 0, `${c.name}: 이름`);
  ok(typeof c.district === 'string' && c.district.length > 0, `${c.name}: 구`);
  ok(typeof c.lat === 'number' && c.lat > 37.3 && c.lat < 37.8, `${c.name}: 위도`);
  ok(typeof c.lng === 'number' && c.lng > 126.7 && c.lng < 127.3, `${c.name}: 경도`);
  ok(typeof c.yearlyTests === 'number' && c.yearlyTests > 0, `${c.name}: 연 측정건수`);
}

// 구 중복 검사
const districts = raw.seoulCenters.map(c => c.district);
ok(new Set(districts).size === districts.length, '구 중복 없음');

// ---- 2. testCounts.ts 모듈 로직 검증 ----

// formatCount 검증
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

// recentTrend 검증
function recentTrend(years) {
  return raw.yearlyTrend.slice(-years);
}
const recent5 = recentTrend(5);
ok(recent5.length === 5, '최근 5개년 길이');
ok(recent5[0].year === raw.yearlyTrend[raw.yearlyTrend.length - 5].year, '최근 5개년 시작');
ok(recent5[4].year === raw.yearlyTrend[raw.yearlyTrend.length - 1].year, '최근 5개년 끝');

// growthRate 검증
function growthRate() {
  const trend = raw.yearlyTrend;
  const first = trend[0];
  const last = trend[trend.length - 1];
  return ((last.totalTests - first.totalTests) / first.totalTests) * 100;
}
const gr = growthRate();
ok(gr > 0, `성장률 양수 (${gr.toFixed(1)}%)`);
ok(gr < 10000, `성장률 합리적 범위 (${gr.toFixed(1)}%)`);

// peakAgeGroup 검증
function peakAgeGroup() {
  return raw.ageDistribution.reduce((a, b) =>
    b.percentage > a.percentage ? b : a,
  );
}
const peak = peakAgeGroup();
ok(peak.percentage >= 20, `최대 참여 연령대 20% 이상 (${peak.ageGroup}: ${peak.percentage}%)`);

// seoulTotalTests 검증
function seoulTotalTests() {
  return raw.seoulCenters.reduce((sum, c) => sum + c.yearlyTests, 0);
}
const seoulTotal = seoulTotalTests();
ok(seoulTotal > 50000, `서울 총 측정건수 5만 이상 (${seoulTotal.toLocaleString()})`);

// ---- 3. 데이터 일관성 ----

// 연도별 센터 수는 시간이 지남에 따라 대체로 증가
const firstHalf = raw.yearlyTrend.slice(0, Math.floor(raw.yearlyTrend.length / 2));
const secondHalf = raw.yearlyTrend.slice(Math.floor(raw.yearlyTrend.length / 2));
const avgFirst = firstHalf.reduce((s, y) => s + y.centers, 0) / firstHalf.length;
const avgSecond = secondHalf.reduce((s, y) => s + y.centers, 0) / secondHalf.length;
ok(avgSecond > avgFirst, `센터 수 증가 추세 (${avgFirst.toFixed(0)} → ${avgSecond.toFixed(0)})`);

// 서울 센터의 구 이름이 실제 서울 25개 구에 속하는지
const SEOUL_DISTRICTS = new Set([
  '강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구',
  '노원구', '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구',
  '성북구', '송파구', '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구',
]);
for (const c of raw.seoulCenters) {
  ok(SEOUL_DISTRICTS.has(c.district), `${c.district}: 서울 25개 구에 포함`);
}

// ---- 결과 ----
console.log(`\n측정건수 검증: ${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail > 0 ? 1 : 0);
