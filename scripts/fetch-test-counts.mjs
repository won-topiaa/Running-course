// 체력인증센터 측정건수 수집 — 빌드 전에 한 번 돌린다.
//
//   KSPO_SERVICE_KEY=발급받은키 node scripts/fetch-test-counts.mjs
//   (또는)  node scripts/fetch-test-counts.mjs 발급받은키
//
// 체력측정결과(15108938) / 공공체육시설(15107764) 키와 같은 키로 동작한다.
// 엔드포인트: SRVC_TODZ_NFA_TEST_CENTER_CNT / TODZ_NFA_TEST_CENTER_CNT
//
// 프록시 뒤에서는 NODE_USE_ENV_PROXY=1 을 붙인다.
//
// 결과물: src/data/testCounts.json  (앱이 정적으로 import 한다)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const KEY = process.env.KSPO_SERVICE_KEY || process.env.KSPO_FACIL_KEY || process.argv[2];
if (!KEY) {
  console.error('서비스 키가 필요합니다.');
  console.error('  KSPO_SERVICE_KEY=... node scripts/fetch-test-counts.mjs');
  process.exit(1);
}

const BASE =
  'https://apis.data.go.kr/B551014/SRVC_TODZ_NFA_TEST_CENTER_CNT/TODZ_NFA_TEST_CENTER_CNT';
const OUT = 'src/data/testCounts.json';
const ROWS = 1000;

async function fetchPage(pageNo) {
  const qs = new URLSearchParams({
    serviceKey: KEY,
    pageNo: String(pageNo),
    numOfRows: String(ROWS),
    resultType: 'json',
  });
  const url = `${BASE}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function parseCoord(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

async function main() {
  console.log('체력인증센터 측정건수 수집 시작...');
  console.log(`엔드포인트: ${BASE}`);

  // 1) 첫 페이지로 전체 건수 + 필드 확인
  const firstPage = await fetchPage(1);
  const resp = firstPage.response ?? firstPage;

  if (resp?.header?.resultCode !== '00') {
    console.error('API 오류:', JSON.stringify(resp?.header ?? firstPage, null, 2));
    process.exit(1);
  }

  const firstItems = resp.body.items?.item ?? resp.body.items ?? [];
  const totalCount = resp.body.totalCount;
  console.log(`전체 건수: ${totalCount}`);
  if (firstItems.length > 0) {
    console.log('필드명:', Object.keys(firstItems[0]).join(', '));
    console.log('첫 행:', JSON.stringify(firstItems[0], null, 2));
  }

  // 2) 전체 페이지 순회
  const totalPages = Math.ceil(totalCount / ROWS);
  const allItems = [...firstItems];

  for (let page = 2; page <= totalPages; page++) {
    if (page % 5 === 0) console.log(`  ${page}/${totalPages} ...`);
    try {
      const data = await fetchPage(page);
      const r = data.response ?? data;
      const pageItems = r.body?.items?.item ?? r.body?.items ?? [];
      allItems.push(...pageItems);
    } catch (e) {
      console.warn(`  page ${page} 실패, 건너뜀: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`수집 완료: ${allItems.length}건`);

  // 3) 데이터 집계
  //    API 필드명은 실제 응답에 맞춰 조정 — 아래는 예상 필드명
  //    실행 시 '필드명:' 로그를 보고 여기를 맞춰야 할 수 있음

  // 연도별 집계
  const yearlyMap = new Map();
  // 연령대별 집계
  const ageMap = new Map();
  // 서울 센터별 집계
  const seoulCenters = new Map();

  let totalAll = 0;

  for (const item of allItems) {
    // 필드명 후보 (실제 API 응답에 맞춰 조정)
    const centerNm = item.cntr_nm ?? item.center_nm ?? item.faci_nm ?? '';
    const yr = Number(item.yr ?? item.year ?? item.base_year ?? 0);
    const cnt = Number(item.msr_cnt ?? item.test_cnt ?? item.cnt ?? 0);
    const sido = item.ctprvn_nm ?? item.sido_nm ?? item.addr_ctpv_nm ?? '';
    const sigungu = item.signgu_nm ?? item.sigungu_nm ?? item.addr_cpb_nm ?? '';
    const ageGrp = item.age_degree ?? item.age_grp ?? '';
    const lat = parseCoord(item.lat ?? item.faci_lat);
    const lng = parseCoord(item.lot ?? item.lng ?? item.faci_lot);

    if (!Number.isFinite(cnt) || cnt <= 0) continue;
    totalAll += cnt;

    // 연도별
    if (yr >= 2010) {
      const prev = yearlyMap.get(yr) ?? { totalTests: 0, centers: new Set() };
      prev.totalTests += cnt;
      if (centerNm) prev.centers.add(centerNm);
      yearlyMap.set(yr, prev);
    }

    // 연령대별
    if (ageGrp) {
      ageMap.set(ageGrp, (ageMap.get(ageGrp) ?? 0) + cnt);
    }

    // 서울 센터
    if (sido.includes('서울')) {
      const key = centerNm || sigungu;
      if (key) {
        const prev = seoulCenters.get(key) ?? {
          name: centerNm,
          district: sigungu,
          lat: lat ?? 0,
          lng: lng ?? 0,
          yearlyTests: 0,
        };
        prev.yearlyTests += cnt;
        if (lat && !prev.lat) prev.lat = lat;
        if (lng && !prev.lng) prev.lng = lng;
        seoulCenters.set(key, prev);
      }
    }
  }

  // 연도별 추세 정리
  const yearlyTrend = [...yearlyMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, v]) => ({
      year,
      totalTests: v.totalTests,
      centers: v.centers.size,
    }));

  // 연령대별 분포 정리
  const ageTotalCnt = [...ageMap.values()].reduce((a, b) => a + b, 0);
  const ageDistribution = [...ageMap.entries()]
    .sort((a, b) => {
      const order = ['10', '20', '30', '40', '50', '60', '70'];
      const ia = order.findIndex(x => a[0].includes(x));
      const ib = order.findIndex(x => b[0].includes(x));
      return ia - ib;
    })
    .map(([ageGroup, count]) => ({
      ageGroup,
      percentage: Math.round((count / ageTotalCnt) * 1000) / 10,
    }));

  // 서울 센터 정리
  const seoulList = [...seoulCenters.values()]
    .sort((a, b) => b.yearlyTests - a.yearlyTests);

  console.log(`\n연도별 추세: ${yearlyTrend.length}개년`);
  for (const y of yearlyTrend) {
    console.log(`  ${y.year}: ${y.totalTests.toLocaleString()}건, ${y.centers}곳`);
  }

  console.log(`\n연령대별 분포:`);
  for (const a of ageDistribution) {
    console.log(`  ${a.ageGroup}: ${a.percentage}%`);
  }

  console.log(`\n서울 센터: ${seoulList.length}곳`);
  for (const c of seoulList.slice(0, 10)) {
    console.log(`  ${c.name} (${c.district}): ${c.yearlyTests.toLocaleString()}건`);
  }

  // 4) 저장
  const output = {
    source: '서울올림픽기념국민체육진흥공단 체력인증센터 측정건수 (15114286)',
    endpoint: BASE,
    collectedAt: new Date().toISOString().slice(0, 10),
    region: '전국 / 서울',
    totalInApi: totalCount,
    totalMeasurements: totalAll,
    yearlyTrend,
    ageDistribution,
    seoulCenters: seoulList,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n저장 완료: ${OUT}`);
}

main().catch(e => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
