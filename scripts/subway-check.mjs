// 지하철역 데이터·검색 검증
//
// 이 데이터는 '역에서 역으로 뛰기' 의 뼈대다. 좌표가 틀리면 엉뚱한 곳으로
// 뛰게 만들고, 노선이 섞이면 갈 수 없는 역을 도착지로 내민다.
//
// 좌표 검증을 특히 촘촘히 둔 이유가 있다. 두 공공데이터 모두 실제로 틀린
// 좌표를 갖고 있었다 — 서울교통공사 파일은 용답역을 시청 자리에(6.4km),
// 국가철도공단 파일은 6호선 연신내를 15km 밖에 찍어 뒀다. 수집 스크립트가
// 노선마다 나은 쪽을 고르고 남은 건 빼도록 돼 있는데, 그 판정이 무너지면
// 여기서 걸려야 한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_PATH = resolve('src/data/subway.json');
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
}

const raw = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

// ---- 1. 데이터 무결성 ----
ok(raw.source.includes('국가철도공단'), '출처에 국가철도공단');
ok(raw.source.includes('서울교통공사'), '출처에 서울교통공사');
ok(Array.isArray(raw.warnings), '수집 경고 목록 존재');
ok(/^\d{4}-\d{2}-\d{2}$/.test(raw.collectedAt ?? ''), '수집일 표기');
ok(raw.seed !== true, '시드 플래그가 없다 (실데이터)');
ok(Array.isArray(raw.lines) && raw.lines.length >= 8, `노선 8개 이상 (${raw.lines?.length})`);
ok(raw.lineCount === raw.lines.length, 'lineCount 일치');

const SEOUL = { latMin: 37.2, latMax: 37.8, lngMin: 126.6, lngMax: 127.3 };
const NUMBERED = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9']);

let total = 0;
for (const l of raw.lines) {
  ok(typeof l.line === 'string' && l.line.length > 0, `노선 키 존재 (${l.line})`);
  if (NUMBERED.has(l.line)) ok(l.name === `${l.line}호선`, `${l.line}: 이름 형식`);
  ok(typeof l.source === 'string' && l.source.length > 0, `${l.name}: 채택 출처 표기 (${l.source})`);
  ok(/^#[0-9A-F]{6}$/i.test(l.color), `${l.name}: 노선색 형식 (${l.color})`);
  // 1~9호선은 서울을 가로지르니 역이 많아야 한다. 신분당선·공항철도는
  // 서울 구간 자체가 짧아(각 7역·6역) 같은 잣대를 댈 수 없다.
  const minStations = NUMBERED.has(l.line) ? 10 : 5;
  ok(
    Array.isArray(l.stations) && l.stations.length >= minStations,
    `${l.name}: 역 ${minStations}개 이상 (${l.stations?.length})`,
  );
  total += l.stations.length;

  const names = new Set();
  for (const s of l.stations) {
    ok(typeof s.name === 'string' && s.name.length > 0, `${l.name}: 역명 존재`);
    ok(!s.name.endsWith('역'), `${l.name} ${s.name}: '역' 접미사가 없다`);
    ok(!s.name.includes('('), `${l.name} ${s.name}: 괄호 병기가 없다`);
    ok(
      typeof s.lat === 'number' && s.lat > SEOUL.latMin && s.lat < SEOUL.latMax,
      `${l.name} ${s.name}: 위도 범위 (${s.lat})`,
    );
    ok(
      typeof s.lng === 'number' && s.lng > SEOUL.lngMin && s.lng < SEOUL.lngMax,
      `${l.name} ${s.name}: 경도 범위 (${s.lng})`,
    );
    ok(!names.has(s.name), `${l.name}: 같은 노선에 역명 중복 없음 (${s.name})`);
    names.add(s.name);
  }
}
ok(raw.stationCount === total, `stationCount 일치 (${raw.stationCount} vs ${total})`);
ok(total > 250, `전체 역 250개 이상 (${total})`);

// ---- 2. 알려진 좌표와 대조 ----
// 데이터가 통째로 어긋나면(좌표계 혼동·행 밀림) 여기서 걸린다.
const R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;
function hav(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const ALL = raw.lines.flatMap((l) =>
  l.stations.map((s) => ({ ...s, line: l.line, lineName: l.name, color: l.color })),
);

const KNOWN = {
  강남: [37.4979, 127.0276],
  잠실: [37.5133, 127.1000],
  여의도: [37.5215, 126.9243],
  홍대입구: [37.5570, 126.9245],
  시청: [37.5657, 126.9769],
};
for (const [name, ref] of Object.entries(KNOWN)) {
  const found = ALL.filter((s) => s.name === name);
  ok(found.length > 0, `${name}역이 데이터에 있다`);
  if (found.length) {
    const best = Math.min(...found.map((s) => hav([s.lat, s.lng], ref)));
    ok(best < 500, `${name}역 좌표가 기준과 500m 안 (${best.toFixed(0)}m)`);
  }
}

// 환승역은 노선 수만큼 나온다
ok(ALL.filter((s) => s.name === '왕십리').length >= 2, '왕십리는 환승역 (2개 이상 노선)');
ok(ALL.filter((s) => s.name === '강남').length >= 1, '강남 존재');

// ---- 3. 검색 로직 (subway.ts 와 같은 규칙) ----

function nearestStation(from, maxM = 3000) {
  let best = null;
  for (const s of ALL) {
    const d = hav(from, [s.lat, s.lng]);
    if (d > maxM) continue;
    if (!best || d < best.distanceM) best = { ...s, distanceM: d };
  }
  return best;
}

function nearbyStations(from, maxM = 3000, limit = 8) {
  const seen = new Set();
  const out = [];
  const sorted = ALL.map((s) => ({ ...s, distanceM: hav(from, [s.lat, s.lng]) }))
    .sort((a, b) => a.distanceM - b.distanceM);
  for (const s of sorted) {
    if (s.distanceM > maxM) break;
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function destinationsFrom(origin, minM = 800, maxM = 12000, limit = 12) {
  const line = raw.lines.find((l) => l.line === origin.line);
  if (!line) return [];
  return line.stations
    .filter((s) => s.name !== origin.name)
    .map((s) => ({ ...s, line: line.line, distanceM: hav([origin.lat, origin.lng], [s.lat, s.lng]) }))
    .filter((s) => s.distanceM >= minM && s.distanceM <= maxM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

// 강남역 한복판에서 가장 가까운 역은 강남
const atGangnam = nearestStation([37.4979, 127.0276]);
ok(atGangnam?.name === '강남', `강남 한복판 → 강남역 (${atGangnam?.name})`);
ok(atGangnam.distanceM < 200, `강남역까지 200m 안 (${atGangnam.distanceM.toFixed(0)}m)`);

// 서울 밖(부산)에서는 아무 역도 안 잡힌다
ok(nearestStation([35.1796, 129.0756]) === null, '부산에서는 역이 안 잡힌다');
ok(nearbyStations([35.1796, 129.0756]).length === 0, '부산 근처 역 0개');

// 가까운 역 목록 — 역명 중복 없이, 거리 오름차순
const near = nearbyStations([37.4979, 127.0276], 3000, 8);
ok(near.length > 0, '강남 근처 역이 있다');
ok(near.length <= 8, 'limit 준수');
ok(new Set(near.map((s) => s.name)).size === near.length, '가까운 역 목록에 이름 중복 없음');
ok(near.every((s, i) => i === 0 || s.distanceM >= near[i - 1].distanceM), '거리 오름차순');
ok(near[0].name === '강남', '첫 번째가 강남');

// 도착역 후보 — 전부 같은 노선이고, 자기 자신은 빠지고, 거리 범위 안
const gangnam2 = ALL.find((s) => s.name === '강남' && s.line === '2');
ok(gangnam2 != null, '2호선 강남역 존재');
const dests = destinationsFrom(gangnam2);
ok(dests.length > 0, `강남 도착역 후보 있음 (${dests.length})`);
ok(dests.every((s) => s.line === '2'), '후보가 전부 2호선');
ok(dests.every((s) => s.name !== gangnam2.name), '자기 자신은 후보에서 빠진다');
ok(dests.every((s) => s.distanceM >= 800), '너무 가까운 역은 빠진다 (800m 미만)');
ok(dests.every((s) => s.distanceM <= 12000), '너무 먼 역은 빠진다 (12km 초과)');
ok(dests.every((s, i) => i === 0 || s.distanceM >= dests[i - 1].distanceM), '후보 거리 오름차순');
ok(dests.length <= 12, '후보 limit 준수');
// 강남에서 역삼은 걸어서 한 정거장 — 후보에 있어야 한다
ok(dests.some((s) => s.name === '역삼'), '강남 → 역삼이 후보에 있다');
// 3호선 역은 절대 안 나온다
ok(!dests.some((s) => s.name === '교대' && s.line === '3'), '다른 노선 역은 안 섞인다');

// 모든 노선에서 도착역 후보가 하나 이상 나오는가 (빈 노선이 없어야 한다)
for (const l of raw.lines) {
  const first = { ...l.stations[0], line: l.line };
  const d = destinationsFrom(first);
  ok(d.length > 0, `${l.name}: 첫 역에서 도착 후보가 있다 (${d.length})`);
}

// ---- 4. 탈출역(경로 주변) ----
const ENDPOINT_M = 400;
function escapeStations(path, radiusM = 700, limit = 6) {
  if (path.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + hav(path[i - 1], path[i]));
  const totalM = cum[cum.length - 1];
  const startPt = path[0], endPt = path[path.length - 1];
  const best = new Map();
  const step = Math.max(1, Math.floor(path.length / 20));
  for (let i = 0; i < path.length; i += step) {
    for (const s of ALL) {
      const d = hav(path[i], [s.lat, s.lng]);
      if (d > radiusM) continue;
      if (hav(startPt, [s.lat, s.lng]) <= ENDPOINT_M) continue;
      if (hav(endPt, [s.lat, s.lng]) <= ENDPOINT_M) continue;
      const prev = best.get(s.name);
      if (!prev || d < prev.distanceM) best.set(s.name, { ...s, distanceM: d, alongM: cum[i] });
    }
  }
  return [...best.values()]
    .filter((s) => s.alongM > 0 && s.alongM < totalM)
    .sort((a, b) => a.alongM - b.alongM).slice(0, limit);
}

// 강남 → 삼성 (테헤란로): 역삼·선릉이 중간에 있어야 한다
const teheran = [
  [37.4979, 127.0276], [37.5006, 127.0365], [37.5045, 127.0489], [37.5088, 127.0631],
];
const esc = escapeStations(teheran, 700, 6);
ok(esc.length >= 2, `테헤란로 경로에 탈출역 2곳 이상 (${esc.length})`);
ok(esc.some((s) => s.name === '역삼'), '역삼이 탈출역에 있다');
// 출발·도착역은 '중간' 이 아니다 — 목록에 있으면 안 된다
ok(!esc.some((s) => s.name === '강남'), '출발역(강남)은 탈출역에서 빠진다');
ok(!esc.some((s) => s.name === '삼성'), '도착역(삼성)은 탈출역에서 빠진다');
ok(esc.every((s) => s.alongM > 0), '탈출역은 출발점보다 뒤에 있다');
ok(esc.every((s, i) => i === 0 || s.alongM >= esc[i - 1].alongM), '탈출역이 진행 순서대로');
ok(esc.every((s) => s.distanceM <= 700), '탈출역이 전부 반경 안');
ok(new Set(esc.map((s) => s.name)).size === esc.length, '탈출역 이름 중복 없음');
ok(esc.length <= 6, '탈출역 limit 준수');

// 경계 조건 — 빈 경로, 점 하나
ok(escapeStations([], 700).length === 0, '빈 경로는 탈출역 0개');
ok(escapeStations([[37.4979, 127.0276]], 700).length === 0, '점 하나짜리 경로는 0개');
// 서울 밖 경로
ok(escapeStations([[35.1, 129.0], [35.11, 129.01]], 700).length === 0, '부산 경로는 탈출역 0개');

// ---- 5. 거리 표기 ----
function fmt(m) {
  if (m < 1000) return `${Math.round(m / 10) * 10}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
ok(fmt(120) === '120m', '120m 포맷');
ok(fmt(999) === '1000m', '999m 는 10m 단위 반올림');
ok(fmt(1000) === '1.0km', '1.0km 포맷');
ok(fmt(3456) === '3.5km', '3.5km 포맷');

console.log(`\n지하철 검증: ${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail > 0 ? 1 : 0);
