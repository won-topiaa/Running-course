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
  //
  //    실제 응답 스키마 (2026-09 확인):
  //      center_nm     센터명            "청주"
  //      center_addr1  주소              "청주시 서원구 사직대로 229 (종합운동장 북3문)"
  //      center_addr2  상세주소          "1층 청주체력인증센터"
  //      test_ym       측정 연월(YYYYMM) "201702"
  //      test_cnt      측정 건수         195
  //
  //    연령대·좌표 필드는 이 데이터셋에 없다. 지어내지 않고 비워 둔다 —
  //    연령대별 참여 비율은 이 API로는 만들 수 없는 지표다.

  const yearlyMap = new Map(); //  연도 → { totalTests, centers:Set }
  const seoulCenters = new Map(); // 센터명 → 누적

  let totalAll = 0;
  let latestYm = '';

  for (const item of allItems) {
    const centerNm = String(item.center_nm ?? '').trim();
    const ym = String(item.test_ym ?? '').trim();
    const cnt = Number(item.test_cnt ?? 0);
    const addr = String(item.center_addr1 ?? '').trim();

    if (!Number.isFinite(cnt) || cnt <= 0) continue;
    totalAll += cnt;
    if (ym > latestYm) latestYm = ym;

    const yr = Number(ym.slice(0, 4));
    if (yr >= 2010) {
      const prev = yearlyMap.get(yr) ?? { totalTests: 0, centers: new Set() };
      prev.totalTests += cnt;
      if (centerNm) prev.centers.add(centerNm);
      yearlyMap.set(yr, prev);
    }

    // 서울 센터 — 시도 필드가 없어 주소 앞머리로 가린다
    if (addr.startsWith('서울') && centerNm) {
      const prev = seoulCenters.get(centerNm) ?? {
        name: centerNm,
        address: addr,
        totalTests: 0,
      };
      prev.totalTests += cnt;
      seoulCenters.set(centerNm, prev);
    }
  }

  // 연도별 추세 — 마지막 해는 아직 안 끝났을 수 있어 완결 연도만 추세로 쓴다
  const lastFullYear = latestYm.slice(4, 6) === '12'
    ? Number(latestYm.slice(0, 4))
    : Number(latestYm.slice(0, 4)) - 1;

  const yearlyTrend = [...yearlyMap.entries()]
    .filter(([year]) => year <= lastFullYear)
    .sort((a, b) => a[0] - b[0])
    .map(([year, v]) => ({
      year,
      totalTests: v.totalTests,
      centers: v.centers.size,
    }));

  // 이 데이터셋에는 연령대 필드가 없다 (지어내지 않는다)
  const ageDistribution = [];

  const seoulList = [...seoulCenters.values()]
    .sort((a, b) => b.totalTests - a.totalTests);

  console.log(`\n연도별 추세: ${yearlyTrend.length}개년`);
  for (const y of yearlyTrend) {
    console.log(`  ${y.year}: ${y.totalTests.toLocaleString()}건, ${y.centers}곳`);
  }

  console.log(`\n서울 센터: ${seoulList.length}곳`);
  for (const c of seoulList.slice(0, 10)) {
    console.log(`  ${c.name}: ${c.totalTests.toLocaleString()}건`);
  }

  // 4) 저장
  const output = {
    source: '서울올림픽기념국민체육진흥공단 체력인증센터 측정건수 (15114286)',
    endpoint: BASE,
    collectedAt: new Date().toISOString().slice(0, 10),
    region: '전국 / 서울',
    latestMonth: latestYm,
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
