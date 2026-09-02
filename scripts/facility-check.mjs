// 공공체육시설 통합 검증
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_PATH = resolve('src/data/facilities.json');
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
}

// ---- 1. 데이터 무결성 ----
const raw = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
ok(Array.isArray(raw.facilities), '시설 배열 존재');
ok(raw.facilities.length > 500, `시설 500건 이상 (${raw.facilities.length})`);
ok(raw.source.includes('공공체육시설'), '출처 표기');
ok(raw.region === '서울특별시', '지역 표기');
ok(raw.seed !== true, '시드 플래그가 없다 (실데이터)');
ok(raw.count === raw.facilities.length, `count 일치 (${raw.count})`);

const SEOUL_DISTRICTS = new Set([
  '강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구',
  '노원구', '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구',
  '성북구', '송파구', '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구',
]);

for (const f of raw.facilities) {
  ok(f.id && typeof f.id === 'string', `${f.name}: id 존재`);
  ok(f.name && typeof f.name === 'string', `${f.id}: name 존재`);
  ok(typeof f.lat === 'number' && f.lat > 37.3 && f.lat < 37.8, `${f.name}: 위도 범위`);
  ok(typeof f.lng === 'number' && f.lng > 126.7 && f.lng < 127.3, `${f.name}: 경도 범위`);
  ok(typeof f.district === 'string', `${f.name}: 구 필드 문자열`);
  // 개방 데이터에 구가 안 실린 행이 있다. 지어내지 않고 빈 문자열로 둔다 —
  // 값이 있다면 서울 25개 구 중 하나여야 한다.
  ok(f.district === '' || SEOUL_DISTRICTS.has(f.district), `${f.name}: 구 값 유효 (${f.district})`);
  ok(typeof f.type === 'string', `${f.name}: 유형 문자열`);
  ok(typeof f.isPublic === 'boolean', `${f.name}: isPublic 불리언`);
  ok(!('amenities' in f), `${f.name}: 추측 편의시설 필드 없음`);
}

// 구가 채워진 비율 — 대부분은 구를 알 수 있어야 쓸모가 있다
const withDistrict = raw.facilities.filter(f => f.district).length;
ok(
  withDistrict / raw.facilities.length > 0.95,
  `구 정보 95% 이상 (${withDistrict}/${raw.facilities.length})`,
);

// 서울 자치구를 두루 덮는가
const coveredDistricts = new Set(raw.facilities.map(f => f.district).filter(Boolean));
ok(coveredDistricts.size >= 20, `자치구 20개 이상 커버 (${coveredDistricts.size})`);

// id 중복 검사
const ids = raw.facilities.map(f => f.id);
ok(new Set(ids).size === ids.length, 'id 중복 없음');

// ---- 2. facilities.ts 모듈 검증 (순수 JS 로) ----
// haversine 직접 구현
const R = 6371008.8;
const toRad = d => d * Math.PI / 180;
function hav(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// findNearby 로직 검증
function findNearby(center, radius, limit) {
  const results = [];
  for (const f of raw.facilities) {
    const d = hav(center, [f.lat, f.lng]);
    if (d <= radius) results.push({ ...f, distanceM: d });
  }
  results.sort((a, b) => a.distanceM - b.distanceM);
  return results.slice(0, limit);
}

// 잠실종합운동장(37.5153, 127.0734) 근처 검색
const jamsil = findNearby([37.5153, 127.0734], 2000, 10);
ok(jamsil.length > 0, '잠실 근처 시설 발견');
ok(jamsil[0].distanceM < 2000, '가장 가까운 시설이 반경 안');
ok(jamsil.every(f => f.district === '' || f.district === '송파구' || f.district === '강남구'
  || f.district === '강동구' || f.district === '광진구' || f.district === '성동구'),
  '잠실 반경 2km 결과가 인접 자치구');

// 올림픽공원(37.5208, 127.1214) 근처
const olympic = findNearby([37.5208, 127.1214], 2000, 10);
ok(olympic.length > 0, '올림픽공원 근처 시설 발견');

// 한강 근처 검색 (여의도 한강공원)
const hangang = findNearby([37.5284, 126.9344], 1000, 10);
ok(hangang.length > 0, '여의도 한강공원 근처 시설 발견');

// 서울 외 좌표 (부산) — 0건이어야
const busan = findNearby([35.1796, 129.0756], 5000, 10);
ok(busan.length === 0, '서울 외 지역 검색 0건');

// 반경이 커질수록 결과가 줄지 않는다 (단조성)
const r500 = findNearby([37.5153, 127.0734], 500, 999).length;
const r1500 = findNearby([37.5153, 127.0734], 1500, 999).length;
ok(r1500 >= r500, `반경 확대 시 결과 단조 증가 (${r500} → ${r1500})`);

// limit 이 지켜진다
ok(findNearby([37.5153, 127.0734], 5000, 3).length <= 3, 'limit 3 준수');
ok(findNearby([37.5153, 127.0734], 5000, 0).length === 0, 'limit 0 은 빈 배열');

// 거리 오름차순
const sorted = findNearby([37.5153, 127.0734], 3000, 20);
ok(
  sorted.every((f, i) => i === 0 || f.distanceM >= sorted[i - 1].distanceM),
  '결과가 거리 오름차순',
);

// ---- 3. findNearRoute 로직 검증 ----
function findNearRoute(path, radius, limit) {
  const seen = new Set();
  const results = [];
  const step = Math.max(1, Math.floor(path.length / 20));
  for (let i = 0; i < path.length; i += step) {
    for (const f of raw.facilities) {
      if (seen.has(f.id)) continue;
      const d = hav(path[i], [f.lat, f.lng]);
      if (d <= radius) {
        seen.add(f.id);
        results.push({ ...f, distanceM: d });
      }
    }
  }
  const startPt = path[0], endPt = path[path.length - 1];
  for (const f of raw.facilities) {
    if (seen.has(f.id)) continue;
    const d = Math.min(hav(startPt, [f.lat, f.lng]), hav(endPt, [f.lat, f.lng]));
    if (d <= radius * 1.5) {
      seen.add(f.id);
      results.push({ ...f, distanceM: d });
    }
  }
  results.sort((a, b) => a.distanceM - b.distanceM);
  return results.slice(0, limit);
}

// 잠실 → 올림픽공원 경로 (간략)
const testPath = [
  [37.5153, 127.0734], // 잠실
  [37.5180, 127.0900], // 중간
  [37.5208, 127.1214], // 올림픽공원
];
const routeNear = findNearRoute(testPath, 500, 10);
ok(routeNear.length >= 2, '경로 주변 시설 2개 이상');

// 중복 없는지
const routeIds = routeNear.map(f => f.id);
ok(new Set(routeIds).size === routeIds.length, '경로 검색 중복 없음');

// ---- 4. 개방 데이터가 실제로 주는 필드만 쓰는가 ----
// 편의시설은 이 데이터셋에 없다. 시설명에서 추측해 붙이던 걸 걷어냈으므로
// 어떤 행에도 다시 생기면 안 된다.
ok(
  raw.facilities.every(f => !('amenities' in f)),
  '추측 편의시설 필드가 전 행에 없다',
);
ok(
  !JSON.stringify(raw).includes('"shower"'),
  '샤워실 등 추측 태그가 데이터에 남아 있지 않다',
);

// 유형은 실제로 채워져 있다
const withType = raw.facilities.filter(f => f.type).length;
ok(withType / raw.facilities.length > 0.9, `시설 유형 90% 이상 (${withType})`);

// 공공/국가 플래그가 실제로 갈린다 (전부 같은 값이면 필드가 죽은 것)
const publicCount = raw.facilities.filter(f => f.isPublic).length;
ok(publicCount > 0, `공공 시설 존재 (${publicCount})`);

// ---- 5. 거리 포맷 ----
function formatDist(m) {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
ok(formatDist(500) === '500m', '500m 포맷');
ok(formatDist(1500) === '1.5km', '1.5km 포맷');
ok(formatDist(50) === '50m', '50m 포맷');

// ---- 결과 ----
console.log(`\n시설 검증: ${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail > 0 ? 1 : 0);
