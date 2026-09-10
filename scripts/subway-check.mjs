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
import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// 검색 함수는 앱이 쓰는 그 모듈을 그대로 불러다 검사한다.
// 예전엔 이 파일이 nearbyStations·escapeStations·거리표기를 똑같이 베껴 두고
// 그 사본을 검사했다. 그래서 실제 코드의 버그를 두 개나 놓쳤다 —
// 995~999m 가 '1000m' 로 찍히던 것과, 끝점 근처 탈출역 157개가 사라지던 것.
// 사본을 검사하면 사본이 맞는지만 알 수 있다.
const dir = mkdtempSync(join(tmpdir(), 'subway-'));
const bundle = async (entry, name) => {
  const out = join(dir, name);
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    outfile: out,
    logLevel: 'error',
    loader: { '.json': 'json' },
    define: { 'import.meta.env': '{}' },
  });
  return import(out);
};

const SUBWAY = await bundle('src/lib/subway.ts', 'subway.mjs');
const { nearbyStations, destinationsFrom, escapeStations, formatStationDistance } = SUBWAY;

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
// 양 끝은 ENDPOINT_M 으로 걸러진다 — alongM 이 0 이라는 이유로 지우면 안 된다.
// (그렇게 지우던 시절 끝점 400~700m 밖의 멀쩡한 역 157개가 사라졌다)
ok(
  esc.every((s) => hav(teheran[0], [s.lat, s.lng]) > ENDPOINT_M),
  '탈출역은 전부 출발점에서 ENDPOINT_M 밖',
);
ok(
  esc.every((s) => hav(teheran[teheran.length - 1], [s.lat, s.lng]) > ENDPOINT_M),
  '탈출역은 전부 도착점에서 ENDPOINT_M 밖',
);
ok(esc.every((s) => s.alongM >= 0), '탈출역 진행거리는 음수가 아니다');

// 끝점 바로 바깥의 탈출역이 살아남는가 — 회귀 방지.
//
// 동대문 → 방학 경로에서 동묘앞은 출발점에서 476m 다. ENDPOINT_M(400m) 밖이니
// '중간에 그만둘 수 있는 역' 이 맞다. 그런데 동묘앞에 가장 가까운 경로 표본이
// 0번 지점이라 alongM 이 0 으로 나오고, 예전 코드는 그걸 이유로 지웠다.
// 이런 식으로 사라진 역이 서울 전역에서 157개였다.
const dongdaemun = [37.57179, 127.011383];
const banghak = [37.66796, 127.04456];
const longPath = [];
for (let i = 0; i <= 80; i++) {
  longPath.push([
    dongdaemun[0] + (banghak[0] - dongdaemun[0]) * (i / 80),
    dongdaemun[1] + (banghak[1] - dongdaemun[1]) * (i / 80),
  ]);
}
const longEsc = escapeStations(longPath, 700, 20);
const dongmyo = longEsc.find((s) => s.name === '동묘앞');
ok(dongmyo != null, '출발점 476m 밖의 동묘앞이 탈출역에 남는다 (alongM=0 이어도)');
ok(
  longEsc.every((s) => hav(dongdaemun, [s.lat, s.lng]) > ENDPOINT_M),
  '긴 경로에서도 출발점 ENDPOINT_M 안의 역은 빠진다',
);
ok(!longEsc.some((s) => s.name === '동대문'), '긴 경로에서 출발역(동대문)은 빠진다');
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
const fmt = formatStationDistance; // 앱이 실제로 쓰는 함수
ok(fmt(120) === '120m', '120m 포맷');
ok(fmt(994) === '990m', '994m 는 10m 단위로 내림');
// 반올림이 단위 판정보다 먼저다 — 아니면 '1000m' 라고 적힌다
ok(fmt(995) === '1.0km', '995m 는 1.0km (1000m 라고 적히면 안 된다)');
ok(fmt(999) === '1.0km', '999m 는 1.0km');
ok(!/^\d{4,}m$/.test(fmt(999)), '네 자리 미터 표기가 나오지 않는다');
ok(fmt(1000) === '1.0km', '1.0km 포맷');
ok(fmt(3456) === '3.5km', '3.5km 포맷');

console.log(`\n지하철 검증: ${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail > 0 ? 1 : 0);
