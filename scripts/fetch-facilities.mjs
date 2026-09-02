// 공공체육시설 좌표 수집 — 빌드 전에 한 번 돌린다.
//
//   KSPO_FACIL_KEY=발급받은키 node scripts/fetch-facilities.mjs
//   (또는)  node scripts/fetch-facilities.mjs 발급받은키
//
// 체력측정결과(15108938) 키와 같은 키로 동작한다.
// 엔드포인트: SRVC_SFMS_FACIL_INFO / TODZ_SFMS_FACIL_INFO
//
// 프록시 뒤에서는 NODE_USE_ENV_PROXY=1 을 붙인다.
//
// 결과물: src/data/facilities.json  (앱이 정적으로 import 한다)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const KEY = process.env.KSPO_FACIL_KEY || process.env.KSPO_SERVICE_KEY || process.argv[2];
if (!KEY) {
  console.error('서비스 키가 필요합니다.');
  console.error('  KSPO_FACIL_KEY=... node scripts/fetch-facilities.mjs');
  process.exit(1);
}

const BASE =
  'https://apis.data.go.kr/B551014/SRVC_SFMS_FACIL_INFO/TODZ_SFMS_FACIL_INFO';
const OUT = 'src/data/facilities.json';
const ROWS = 1000;
const TARGET_SIDO = '서울';

// 러너 관련 편의 키워드 (시설명/유형에서 추출)
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

/**
 * 자치구. 개방 데이터의 addr_cpb_nm 이 비는 행이 있어(1,284건 중 57건)
 * 도로명 주소에서 '○○구' 를 주워 채운다. 주소마저 비면 빈 문자열 —
 * 없는 걸 만들어 넣지는 않는다.
 */
function districtOf(item) {
  const direct = (item.addr_cpb_nm ?? '').trim();
  if (direct) return direct;
  const addr = `${item.faci_road_addr ?? ''} ${item.faci_lotno_addr ?? ''}`;
  return addr.match(/([가-힣]+구)(?:\s|$)/)?.[1] ?? '';
}

async function main() {
  console.log('공공체육시설 데이터 수집 시작...');
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

  // 3) 서울 + 좌표 있는 것만 필터링
  const facilities = [];
  let noCoord = 0, notSeoul = 0, closed = 0, deleted = 0;

  for (const item of allItems) {
    // 삭제 여부
    if (item.del_yn === 'Y') { deleted++; continue; }

    // 지역 필터 — addr_ctpv_nm 이 시도
    const sido = item.addr_ctpv_nm ?? '';
    if (!sido.includes(TARGET_SIDO)) { notSeoul++; continue; }

    // 상태 — faci_stat_cd '00' 이 정상
    const statCd = item.faci_stat_cd ?? '00';
    if (statCd !== '00') { closed++; continue; }

    const lat = parseCoord(item.faci_lat);
    const lng = parseCoord(item.faci_lot);
    if (lat == null || lng == null) { noCoord++; continue; }

    // 서울 좌표 범위
    if (lat < 37.4 || lat > 37.7 || lng < 126.7 || lng > 127.2) {
      noCoord++; continue;
    }

    const name = (item.faci_nm ?? '').trim();
    const type = (item.ftype_nm ?? '').trim();
    const bizType = (item.fcob_nm ?? '').trim();
    const district = districtOf(item);
    const addr = (item.faci_road_addr ?? '').trim();
    const isPublic = item.faci_gb_nm === '공공';
    const isNational = item.nation_yn === 'Y';

    // 편의시설(화장실·샤워실 등) 필드는 이 데이터셋에 없다.
    // 시설명에서 추측해 붙이던 걸 걷어냈다 — 축구장이라고 화장실이 있다고
    // 단정할 근거가 없고, 그건 데이터가 아니라 지어낸 값이다.
    facilities.push({
      id: `f_${facilities.length}`,
      name,
      type,
      bizType,
      district,
      address: addr,
      lat,
      lng,
      isPublic,
      isNational,
    });
  }

  console.log(`\n서울 시설: ${facilities.length}건`);
  console.log(`  좌표 없음: ${noCoord}`);
  console.log(`  서울 외: ${notSeoul}`);
  console.log(`  폐업: ${closed}`);
  console.log(`  삭제: ${deleted}`);

  // 시설 유형 분포
  const typeCounts = {};
  for (const f of facilities) {
    typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
  }
  console.log('\n시설 유형 분포:');
  Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([t, c]) => console.log(`  ${t}: ${c}`));

  // 구별 분포
  const distCounts = {};
  for (const f of facilities) {
    distCounts[f.district] = (distCounts[f.district] || 0) + 1;
  }
  console.log('\n구별 분포:');
  Object.entries(distCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([d, c]) => console.log(`  ${d}: ${c}`));

  // 4) 저장
  const output = {
    source: '서울올림픽기념국민체육진흥공단 공공체육시설 상세 정보 (15107764)',
    endpoint: BASE,
    collectedAt: new Date().toISOString().slice(0, 10),
    region: '서울특별시',
    totalInApi: totalCount,
    count: facilities.length,
    facilities,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n저장 완료: ${OUT} (${facilities.length}건)`);
}

main().catch(e => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
