// 지하철역 좌표·노선 수집 — 빌드 전에 한 번 돌린다.
//
//   npm run data:subway
//   (프록시 뒤에서는 NODE_USE_ENV_PROXY=1 을 붙인다)
//
// 결과물: src/data/subway.json  (앱이 정적으로 import 한다)
//
// ── 출처를 둘 쓰고, 노선마다 고르는 이유 ──────────────────────────
// 출처는 둘이다.
//     국가철도공단 노선별 「역위치」        — 1~9호선·신분당·우이신설 등
//     서울교통공사 「1~8호선 역사 좌표」    — 15099316
//
// 처음엔 서울교통공사 것만 썼는데, 앱에 띄우자 '시청에서 용답역 20m' 가
// 나왔다. 용답은 성동구다. 그래서 국가철도공단으로 갈아탔더니 이번엔 6호선이
// 통째로 어긋났다 — 연신내 경도가 127.09(실제 126.92)로 찍혀 있고 그 뒤
// 역들이 한 칸씩 밀려 있다.
//
// 알려진 좌표로 맞대 본 결과가 이렇다.
//              국가철도공단   서울교통공사
//     이태원        693m          12m
//     합정          779m          80m
//     연신내     14,999m          94m      → 6호선은 서울교통공사가 맞다
//     용답        (정상)       6,454m      → 2호선은 국가철도공단이 맞다
//
// 어느 한쪽이 늘 맞는 게 아니라 파일마다 다르다. 그래서 노선별로 고른다.
// 고르는 기준은 '충돌' 이다 — 이름이 다른 역이 150m 안에 붙어 있으면 둘 중
// 하나는 잘못 찍힌 것이다. 좌표가 밀린 파일은 이 충돌이 무더기로 생긴다.
// 충돌이 적은 쪽을 그 노선의 값으로 쓰고, 무엇을 왜 골랐는지 다 적어 둔다.
//
// ── 노선 순서를 담지 않는 이유 ─────────────────────────────────────
// 역번호는 노선 위상과 어긋나는 구간이 있다(6호선 봉화산이 응암순환 뒤,
// 2호선 본선 뒤에 지선). 번호순으로 늘어놓고 먼 구간에서 끊어 봤더니 5호선
// 하남 연장과 6호선 종점이 통째로 떨어져 나갔다. 확인할 수 없는 순서를
// 지어내느니 안 쓰기로 했다 — 앱은 '같은 노선 역을 출발역에서 가까운 순'
// 으로 보여준다. 감각은 같고, 실제 거리라 '3정거장' 보다 오히려 정확하다.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = 'src/data/subway.json';

/** 국가철도공단 노선별 역위치 — 공공데이터포털 데이터셋 번호 */
const LINES = [
  { key: '1', name: '1호선', dataset: '15041300', color: '#0052A4' },
  { key: '2', name: '2호선', dataset: '15041301', color: '#00A84D' },
  { key: '3', name: '3호선', dataset: '15041302', color: '#EF7C1C' },
  { key: '4', name: '4호선', dataset: '15041303', color: '#00A5DE' },
  { key: '5', name: '5호선', dataset: '15041304', color: '#996CAC' },
  { key: '6', name: '6호선', dataset: '15041305', color: '#CD7C2F' },
  { key: '7', name: '7호선', dataset: '15041306', color: '#747F00' },
  { key: '8', name: '8호선', dataset: '15041334', color: '#E6186C' },
  { key: '9', name: '9호선', dataset: '15041335', color: '#BDB092' },
  { key: 'sinbundang', name: '신분당선', dataset: '15041337', color: '#D4003B' },
  { key: 'ui', name: '우이신설선', dataset: '15041324', color: '#B0CE18' },
  { key: 'gyeonguijungang', name: '경의중앙선', dataset: '15041487', color: '#77C4A3' },
  { key: 'airport', name: '공항철도', dataset: '15041331', color: '#0090D2' },
];

/** 교차검증용 — 서울교통공사 1~8호선 역사 좌표 */
const CROSS_CHECK_FILE = 'FILE_000000003558329';

/** 서울 안으로만 — 앱이 서울 코스만 다룬다 */
const BBOX = { latMin: 37.4, latMax: 37.72, lngMin: 126.75, lngMax: 127.21 };

/** 두 출처가 이만큼 어긋나면 경고한다 */
const DISAGREE_M = 300;
/** 이름이 다른 역이 이보다 가까우면 둘 중 하나가 잘못 찍힌 것이다 */
const COLLIDE_M = 150;

const R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;
function haversineM(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 이 서버는 첫 요청을 자주 끊는다 (실측 3회 중 2회). 받을 때까지 다시 청한다. */
async function retry(fn, label, tries = 5) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === tries) throw new Error(`${label}: ${e.message}`);
      await new Promise((r) => setTimeout(r, i * 2500));
    }
  }
}

async function resolveFileId(dataset) {
  return retry(async () => {
    const res = await fetch(`https://www.data.go.kr/data/${dataset}/fileData.do`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const id = html.match(/atchFileId=(\w+)/)?.[1];
    const sn = html.match(/fileDetailSn=(\d+)/)?.[1] ?? '1';
    if (!id) throw new Error('atchFileId 를 못 찾음');
    return { id, sn };
  }, `데이터셋 ${dataset} 페이지`);
}

async function downloadCsv(atchFileId, sn = '1') {
  return retry(async () => {
    const res = await fetch(
      `https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=${atchFileId}&fileDetailSn=${sn}`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 300) throw new Error(`너무 작다 (${buf.length}B)`);
    // 공공데이터포털 CSV 는 대개 EUC-KR 이다. UTF-8 BOM 이면 그대로 읽는다.
    const utf8 = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    return new TextDecoder(utf8 ? 'utf-8' : 'euc-kr').decode(buf);
  }, `파일 ${atchFileId}`);
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const head = lines[0].replace(/^﻿/, '').split(',').map((s) => s.trim());
  return lines.slice(1).map((ln) => {
    const cells = ln.split(',').map((s) => s.trim());
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

/** '강변(동서울터미널)' → '강변', '서울역' → '서울' */
function cleanName(raw) {
  return String(raw ?? '').trim().replace(/\(.*$/, '').replace(/역$/, '').trim();
}

function pick(row, ...keys) {
  for (const k of keys) if (row[k] != null && row[k] !== '') return row[k];
  return '';
}

/** CSV 행들 → 서울 안 역 목록 (이름 중복 제거) */
function toStations(rows, nameKeys, latKeys, lngKeys) {
  const seen = new Map();
  for (const r of rows) {
    const name = cleanName(pick(r, ...nameKeys));
    const lat = Number(pick(r, ...latKeys));
    const lng = Number(pick(r, ...lngKeys));
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < BBOX.latMin || lat > BBOX.latMax) continue;
    if (lng < BBOX.lngMin || lng > BBOX.lngMax) continue;
    if (seen.has(name)) continue; // 상·하행 승강장이 따로 실린 경우
    seen.set(name, {
      name,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/**
 * 이 후보 노선이 만들어 내는 '충돌' 수.
 * 이름이 다른 두 역이 150m 안에 붙어 있으면 둘 중 하나는 잘못 찍힌 것이다.
 * 좌표가 한 칸씩 밀린 파일은 여기서 무더기로 걸린다.
 */
function collisionCount(candidate, reference) {
  let n = 0;
  for (let i = 0; i < candidate.length; i++) {
    // 후보 안에서 (마곡↔발산 0m 같은 경우)
    for (let j = i + 1; j < candidate.length; j++) {
      if (candidate[i].name === candidate[j].name) continue;
      if (haversineM(
        [candidate[i].lat, candidate[i].lng],
        [candidate[j].lat, candidate[j].lng],
      ) < COLLIDE_M) n++;
    }
    // 다른 노선과 (6호선 화랑대가 7호선 태릉입구 자리에 앉은 경우)
    for (const r of reference) {
      if (candidate[i].name === r.name) continue;
      if (haversineM([candidate[i].lat, candidate[i].lng], [r.lat, r.lng]) < COLLIDE_M) n++;
    }
  }
  return n;
}

async function main() {
  console.log('지하철역 좌표 수집 — 국가철도공단 + 서울교통공사 교차검증\n');

  const warnings = [];

  // ── 1) 국가철도공단 노선별 역위치 ────────────────────────────────
  const kr = new Map(); // line key → stations
  for (const spec of LINES) {
    try {
      const { id, sn } = await resolveFileId(spec.dataset);
      const rows = parseCsv(await downloadCsv(id, sn));
      kr.set(spec.key, toStations(rows, ['역명', '정거장명', '역사명'], ['위도'], ['경도']));
    } catch (e) {
      warnings.push(`${spec.name}: 국가철도공단 수집 실패 — ${e.message}`);
      console.warn(`  ${spec.name} 국가철도공단 실패: ${e.message}`);
    }
  }

  // ── 2) 서울교통공사 1~8호선 ─────────────────────────────────────
  const sm = new Map();
  try {
    const rows = parseCsv(await downloadCsv(CROSS_CHECK_FILE));
    for (const num of ['1', '2', '3', '4', '5', '6', '7', '8']) {
      sm.set(num, toStations(rows.filter((r) => String(r['호선']).trim() === num),
        ['역명'], ['위도'], ['경도']));
    }
  } catch (e) {
    warnings.push(`서울교통공사 수집 실패 — ${e.message}`);
    console.warn(`  서울교통공사 실패: ${e.message}`);
  }

  // ── 3) 노선마다 출처 고르기 ─────────────────────────────────────
  // 판정에 쓸 기준선: 경쟁 출처가 없는 노선들(9호선·신분당선 등).
  // 여기에 각 노선을 하나씩 대 보며 충돌이 적은 쪽을 고른다.
  const soleSource = LINES.filter((s) => !/^[1-8]$/.test(s.key))
    .flatMap((s) => (kr.get(s.key) ?? []).map((st) => ({ ...st, lineName: s.name })));

  console.log('노선별 출처 판정 (충돌이 적은 쪽)');
  const lines = [];
  for (const spec of LINES) {
    const a = kr.get(spec.key) ?? [];
    const b = sm.get(spec.key) ?? [];

    // 기준선 = 다른 노선들의 이미 고른 값 + 단일 출처 노선들
    const reference = [...soleSource, ...lines.flatMap((l) => l.stations)];

    let chosen = a;
    let picked = '국가철도공단';
    if (b.length >= 5) {
      const ca = collisionCount(a, reference);
      const cb = collisionCount(b, reference);
      if (cb < ca) { chosen = b; picked = '서울교통공사'; }
      if (ca !== cb) {
        const msg = `${spec.name}: ${picked} 채택 (충돌 국가철도공단 ${ca} vs 서울교통공사 ${cb})`;
        warnings.push(msg);
        console.log(`  ${msg}`);
      }
    }

    if (chosen.length < 5) {
      warnings.push(`${spec.name}: 서울 안 역이 ${chosen.length}개뿐이라 제외`);
      console.log(`  ${spec.name} 제외 (서울 내 ${chosen.length}역)`);
      continue;
    }
    lines.push({ line: spec.key, name: spec.name, color: spec.color, source: picked, stations: chosen });
  }

  if (lines.length === 0) throw new Error('한 노선도 못 받았다');

  // ── 4) 노선을 골라도 안 풀리는 역은 역 단위로 손본다 ─────────────
  //
  // 노선 단위로 나은 쪽을 골라도 몇 역은 여전히 겹친다. 두 파일이 같은
  // 오류를 갖고 있거나(5호선 마곡·발산이 같은 자리), 고른 파일에만 오류가
  // 남은 경우다. 이런 역은 ① 다른 출처 값으로 바꿔 보고, ② 그래도 안 풀리면
  // 뺀다. 어느 쪽이 맞는지 모르는 좌표를 내보내느니 그 역을 안 내미는 편이
  // 낫다 — 틀린 좌표는 사용자를 엉뚱한 데로 뛰게 만든다.

  const IMPOSSIBLE_M = 50; // 이보다 가까우면 서로 다른 역일 수 없다

  const findColliding = (ls) => {
    const flat = ls.flatMap((l) => l.stations.map((s) => ({ ...s, key: l.line, lineName: l.name })));
    const hits = [];
    for (let i = 0; i < flat.length; i++) {
      for (let j = i + 1; j < flat.length; j++) {
        if (flat[i].name === flat[j].name) continue;
        const d = haversineM([flat[i].lat, flat[i].lng], [flat[j].lat, flat[j].lng]);
        if (d < COLLIDE_M) hits.push({ a: flat[i], b: flat[j], d });
      }
    }
    return hits;
  };

  const otherSourceValue = (lineKey, name, usedSource) => {
    const alt = usedSource === '서울교통공사' ? kr.get(lineKey) : sm.get(lineKey);
    return alt?.find((x) => x.name === name) ?? null;
  };

  // ① 다른 출처 값으로 바꿔서 풀리는지
  let repaired = 0;
  for (const hit of findColliding(lines)) {
    if (hit.d >= IMPOSSIBLE_M) continue;
    for (const side of [hit.a, hit.b]) {
      const l = lines.find((x) => x.line === side.key);
      const alt = otherSourceValue(side.key, side.name, l.source);
      if (!alt) continue;
      const partner = side === hit.a ? hit.b : hit.a;
      if (haversineM([alt.lat, alt.lng], [partner.lat, partner.lng]) < COLLIDE_M) continue;
      const idx = l.stations.findIndex((x) => x.name === side.name);
      if (idx < 0) continue;
      l.stations[idx] = { ...l.stations[idx], lat: alt.lat, lng: alt.lng };
      repaired++;
      const msg = `${l.name} ${side.name}: 겹쳐서 다른 출처 좌표로 교체`;
      warnings.push(msg);
      console.log(`  ✔ ${msg}`);
      break;
    }
  }

  // ② 그래도 남으면 양쪽 다 뺀다
  const dropped = new Set();
  for (const hit of findColliding(lines)) {
    if (hit.d >= IMPOSSIBLE_M) continue;
    for (const side of [hit.a, hit.b]) dropped.add(`${side.key}:${side.name}`);
  }
  for (const l of lines) {
    const before = l.stations.length;
    l.stations = l.stations.filter((s) => !dropped.has(`${l.line}:${s.name}`));
    if (l.stations.length !== before) {
      const msg = `${l.name}: 좌표를 믿을 수 없어 ${before - l.stations.length}개역 제외`;
      warnings.push(msg);
      console.log(`  ✂ ${msg}`);
    }
  }

  const all = lines.flatMap((l) => l.stations.map((s) => ({ ...s, lineName: l.name })));
  const leftover = findColliding(lines);
  const collisions = leftover.length;
  for (const h of leftover) {
    const msg = `남은 근접: ${h.a.lineName} ${h.a.name} ↔ ${h.b.lineName} ${h.b.name} ${Math.round(h.d)}m`;
    warnings.push(msg);
    console.log(`  ⚠ ${msg}`);
  }
  console.log(`  교체 ${repaired}건 · 제외 ${dropped.size}건 · 남은 근접 ${collisions}건`);

  // 두 출처가 여전히 어긋나는 역 — 고른 쪽 값을 쓰되 기록은 남긴다
  let disagreed = 0;
  for (const l of lines) {
    const other = sm.get(l.line);
    if (!other || l.source === '서울교통공사') continue;
    for (const s of l.stations) {
      const o = other.find((x) => x.name === s.name);
      if (!o) continue;
      const d = haversineM([s.lat, s.lng], [o.lat, o.lng]);
      if (d > DISAGREE_M) disagreed++;
    }
  }

  console.log('\n노선별 채택 출처');
  for (const l of lines) {
    console.log(`  ${l.name.padEnd(9)} ${String(l.stations.length).padStart(3)}역  ${l.source}`);
  }

  const out = {
    source:
      '국가철도공단 노선별 「역위치」 · 서울교통공사 「1~8호선 역사 좌표」(15099316) — 공공데이터포털',
    note:
      '두 공공데이터를 맞대어 노선마다 오류가 적은 쪽을 골랐다. 이름이 다른 역이 150m 안에 붙어 있으면(좌표가 밀린 파일에서 무더기로 생긴다) 그 출처를 물렸다. 노선 내 역 순서는 담지 않는다 — 역번호가 노선 위상과 어긋나는 구간이 있어 확인할 수 없는 순서를 만들지 않았다. 서울 밖 역은 뺐다.',
    collectedAt: new Date().toISOString().slice(0, 10),
    lineCount: lines.length,
    stationCount: all.length,
    remainingCollisions: collisions,
    stillDisagreeing: disagreed,
    warnings,
    lines,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

  console.log(`\n노선 ${out.lineCount}개 · 역 ${out.stationCount}개 · 좌표 충돌 ${collisions}건`);
  console.log(`저장 완료: ${OUT}`);
}

main().catch((e) => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
