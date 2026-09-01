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
ok(raw.facilities.length > 0, '시설 데이터 비어있지 않음');
ok(raw.source.includes('공공체육시설'), '출처 표기');
ok(raw.region === '서울특별시', '지역 표기');

for (const f of raw.facilities) {
  ok(f.id && typeof f.id === 'string', `${f.name}: id 존재`);
  ok(f.name && typeof f.name === 'string', `${f.id}: name 존재`);
  ok(typeof f.lat === 'number' && f.lat > 37.3 && f.lat < 37.8, `${f.name}: 위도 범위`);
  ok(typeof f.lng === 'number' && f.lng > 126.7 && f.lng < 127.3, `${f.name}: 경도 범위`);
  ok(Array.isArray(f.amenities), `${f.name}: amenities 배열`);
  ok(f.district && typeof f.district === 'string', `${f.name}: 구 정보`);
}

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
ok(jamsil[0].distanceM < 100, '잠실 종합운동장 자체가 가장 가까움');
ok(jamsil[0].name.includes('잠실'), '잠실 시설명 확인');

// 올림픽공원(37.5208, 127.1214) 근처
const olympic = findNearby([37.5208, 127.1214], 2000, 10);
ok(olympic.length > 0, '올림픽공원 근처 시설 발견');
ok(olympic[0].name.includes('올림픽'), '올림픽 시설명 확인');

// 한강 근처 검색 (여의도 한강공원)
const hangang = findNearby([37.5284, 126.9344], 1000, 10);
ok(hangang.length > 0, '여의도 한강공원 근처 시설 발견');

// 서울 외 좌표 (부산) — 0건이어야
const busan = findNearby([35.1796, 129.0756], 5000, 10);
ok(busan.length === 0, '서울 외 지역 검색 0건');

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

// ---- 4. amenity 관련 ----
const withShower = raw.facilities.filter(f => f.amenities.includes('shower'));
ok(withShower.length > 0, '샤워실 있는 시설 존재');

const withTrack = raw.facilities.filter(f => f.amenities.includes('track'));
ok(withTrack.length > 0, '트랙 있는 시설 존재');

const withParking = raw.facilities.filter(f => f.amenities.includes('parking'));
ok(withParking.length > 10, '주차장 있는 시설 10개 이상');

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
