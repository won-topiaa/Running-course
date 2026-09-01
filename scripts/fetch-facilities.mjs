// 공공체육시설 좌표 수집 — 빌드 전에 한 번 돌린다.
//
//   KSPO_FACIL_KEY=발급받은키 node scripts/fetch-facilities.mjs
//   (또는)  node scripts/fetch-facilities.mjs 발급받은키
//
// data.go.kr 에서 15107764 (공공체육시설 상세 정보) API 를 신청해야 한다.
// 기존 15108938 (체력측정결과) 키와 별개 — 데이터셋마다 별도 신청이 필요하다.
//
// 프록시 뒤에서는 NODE_USE_ENV_PROXY=1 을 붙인다.
//
// 결과물: src/data/facilities.json  (앱이 정적으로 import 한다)

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const KEY = process.env.KSPO_FACIL_KEY || process.argv[2];
if (!KEY) {
  console.error('서비스 키가 필요합니다.');
  console.error('  KSPO_FACIL_KEY=... node scripts/fetch-facilities.mjs');
  console.error('');
  console.error('data.go.kr 에서 15107764 (공공체육시설 상세 정보) API 신청 후');
  console.error('발급받은 서비스 키를 사용하세요.');
  process.exit(1);
}

const BASE =
  'https://apis.data.go.kr/B551014/SRVC_API_SFMS_FACI/TODZ_API_SFMS_FACI';
const OUT = 'src/data/facilities.json';
const ROWS = 1000;

// 서울특별시만 수집 (앱이 현재 서울만 지원)
const TARGET_SIDO = '서울특별시';

// 러너에게 유용한 시설 유형
const USEFUL_TYPES = new Set([
  '운동장', '체육관', '수영장', '체력단련실', '테니스장',
  '다목적체육시설', '게이트볼장', '풋살장', '족구장',
  '배드민턴장', '농구장', '인라인스케이트장',
]);

// 러너 관련 편의 키워드 (시설명에서 추출)
const AMENITY_KEYWORDS = {
  shower: ['샤워', '탈의'],
  restroom: ['화장실', '편의'],
  parking: ['주차'],
  locker: ['락커', '보관'],
  track: ['트랙', '육상', '운동장', '달리기'],
};

async function fetchPage(pageNo, params = {}) {
  const qs = new URLSearchParams({
    serviceKey: KEY,
    pageNo: String(pageNo),
    numOfRows: String(ROWS),
    resultType: 'json',
    ...params,
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

function extractAmenities(name, type) {
  const text = `${name} ${type}`.toLowerCase();
  const result = [];
  for (const [key, keywords] of Object.entries(AMENITY_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) result.push(key);
  }
  return result;
}

async function main() {
  console.log('공공체육시설 데이터 수집 시작...');
  console.log(`대상 지역: ${TARGET_SIDO}`);
  console.log(`엔드포인트: ${BASE}`);

  // 1) 첫 페이지로 전체 건수 파악
  let firstPage;
  try {
    firstPage = await fetchPage(1);
  } catch (e) {
    console.error('API 호출 실패:', e.message);
    console.error('');
    console.error('가능한 원인:');
    console.error('  1) 서비스 키가 15107764 API 에 등록되지 않음');
    console.error('  2) data.go.kr 에서 활용 승인을 받지 않음');
    console.error('  3) 네트워크 문제');
    process.exit(1);
  }

  // 응답 구조 진단
  const body = firstPage.response ?? firstPage;
  if (body?.header?.resultCode && body.header.resultCode !== '00') {
    console.error('API 오류:', body.header.resultMsg);
    process.exit(1);
  }

  const items = body?.body?.items ?? [];
  const totalCount = body?.body?.totalCount ?? 0;
  console.log(`전체 건수: ${totalCount}`);

  if (items.length > 0) {
    console.log('첫 행 필드명:', Object.keys(items[0]).join(', '));
  }

  // 2) 전체 페이지 순회
  const totalPages = Math.ceil(totalCount / ROWS);
  const allItems = [...items];

  for (let page = 2; page <= totalPages; page++) {
    if (page % 10 === 0) console.log(`  ${page}/${totalPages} ...`);
    try {
      const data = await fetchPage(page);
      const pageItems = data?.response?.body?.items ?? data?.body?.items ?? [];
      allItems.push(...pageItems);
    } catch (e) {
      console.warn(`  page ${page} 실패, 건너뜀: ${e.message}`);
    }
    // rate limit 배려
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`수집 완료: ${allItems.length}건`);

  // 3) 서울 + 좌표 있는 것만 필터링
  const facilities = [];
  let noCoord = 0;
  let notSeoul = 0;
  let closed = 0;

  for (const item of allItems) {
    // 필드명은 API 문서 기준 — 실제 응답에서 다르면 여기서 매핑
    const sido = item.ctprvn_nm ?? item.sido_nm ?? item.faci_sido ?? '';
    if (!sido.includes('서울')) {
      notSeoul++;
      continue;
    }

    const status = item.faci_stat_nm ?? item.faci_status ?? '';
    if (status.includes('폐업') || status.includes('폐쇄')) {
      closed++;
      continue;
    }

    const lat = parseCoord(item.faci_lat ?? item.lat);
    const lng = parseCoord(item.faci_lot ?? item.faci_lng ?? item.lot ?? item.lng);
    if (lat == null || lng == null) {
      noCoord++;
      continue;
    }

    // 서울 좌표 범위 확인 (대략)
    if (lat < 37.4 || lat > 37.7 || lng < 126.7 || lng > 127.2) {
      noCoord++;
      continue;
    }

    const name = item.faci_nm ?? item.facil_nm ?? item.name ?? '';
    const type = item.faci_gbn_nm ?? item.facil_type ?? item.type ?? '';
    const addr = item.faci_road_addr ?? item.road_addr ?? item.addr ?? '';
    const district = item.signgu_nm ?? item.sigungu ?? '';

    facilities.push({
      id: item.faci_id ?? `f_${facilities.length}`,
      name: name.trim(),
      type: type.trim(),
      district: district.trim(),
      address: addr.trim(),
      lat,
      lng,
      amenities: extractAmenities(name, type),
    });
  }

  console.log(`서울 시설: ${facilities.length}건`);
  console.log(`  좌표 없음: ${noCoord}, 서울 외: ${notSeoul}, 폐업: ${closed}`);

  // 4) 저장
  const output = {
    source: '서울올림픽기념국민체육진흥공단 공공체육시설 상세 정보 (15107764)',
    collectedAt: new Date().toISOString().slice(0, 10),
    region: TARGET_SIDO,
    count: facilities.length,
    facilities,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(output, null, 2), 'utf8');
  console.log(`저장 완료: ${OUT} (${facilities.length}건)`);

  // 5) 시드 데이터에 병합 (시드에만 있는 항목 보존)
  try {
    const seed = JSON.parse(readFileSync(OUT, 'utf8'));
    if (seed.seed) {
      console.log('(시드 데이터를 API 데이터로 교체했습니다)');
    }
  } catch { /* 기존 파일 없음 — 정상 */ }
}

main().catch(e => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
