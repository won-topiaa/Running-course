// ---------------------------------------------------------------------------
// 숲길 비율 — 경로가 공원·숲을 얼마나 지나는가
//
// waytype(wayMix.ts)은 '차도냐 보행자 길이냐'까지만 알려준다. 대로변 보도와
// 한강공원 산책로가 똑같이 Footway 로 나온다. 여름에 갈리는 건 그 다음 —
// 머리 위에 나무가 있느냐다. 그늘로가 건물 그림자를 계산해서 푸는 문제를,
// 우리는 '경로의 몇 %가 공원·숲 안을 지나는가'로 근사한다.
//
// 데이터는 OpenStreetMap 을 Overpass API 로 조회한다(키 불필요, 무료).
// 느리고(1~5초) 호출 제한이 있으므로 경로 생성을 막지 않는다 — 코스를 먼저
// 보여주고, 값이 오면 카드에 한 줄이 뒤늦게 채워진다. 실패하면 그냥 안 뜬다.
//
// 여름(6~8월)에는 순위에 넣는다 — 그늘이 경사만큼 중요하기 때문이다.
// 경로 생성과 폴리곤 조회를 병렬로 돌려 둘 다 끝난 뒤에 한 번에 채점한다.
// 비여름에는 장식 정보로만 쓴다.
// ---------------------------------------------------------------------------

import { haversineMeters } from './geo';
import type { LatLng } from './types';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
// Overpass 는 무료 공용 서버라 붐빌 때가 있다. 한가할 때 실측 2.6~2.9초인데,
// 서버가 밀리면 8~12초까지 늘어난다(연달아 부르면 슬롯 대기까지 붙는다).
// 화면을 막지 않는 부가 정보라 넉넉히 기다렸다가, 그래도 안 오면 포기한다.
const TIMEOUT_MS = 15_000;
/** 경로 주변 여유 (bbox 를 이만큼 넓혀 가장자리 공원도 잡는다) */
const MARGIN_DEG = 0.004; // 약 400m
/** 이보다 넓은 영역은 조회하지 않는다 — Overpass 가 오래 걸리고 예의도 아니다 */
const MAX_SPAN_DEG = 0.25; // 약 25km
/** 경로를 이 간격으로 찍어 판정한다 */
const SAMPLE_M = 40;
const MAX_SAMPLES = 250;
/** Overpass 응답 요소 상한 — 최악의 경우 응답 크기를 묶어 둔다 */
const MAX_ELEMENTS = 400;

/**
 * 그늘이 있다고 볼 만한 OSM 면(面) 태그. 키별로 묶어 정규식 한 번에 묻는다.
 *
 * 처음엔 태그 8개를 각각 way/relation 으로 물어 16절짜리 쿼리였는데, 실측
 * (여의도 6.2km 코스 bbox) 7.8초 / 168KB 가 걸렸다. landuse=grass 와
 * natural=scrub 을 빼고 키별 정규식으로 묶으니 2.6초 / 72KB 로 줄었고
 * 숲길 비율은 31% 로 **완전히 동일**했다 — 서울에서 하천변 잔디밭은 대개
 * leisure=park 로도 잡혀 있어서 중복이었다.
 * (nwr + 정규식으로 더 줄이려 했더니 node 까지 훑느라 504 가 났다)
 */
const AREA_GROUPS: [key: string, valuePattern: string][] = [
  ['leisure', '^(park|garden|nature_reserve)$'],
  ['landuse', '^(forest|recreation_ground)$'],
  ['natural', '^(wood)$'],
];

export interface GreenPoly {
  pts: LatLng[];
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}
type Poly = GreenPoly;

// bbox 당 결과를 잠깐 기억한다. '다시 찾기'를 눌러도 같은 동네면 재조회하지 않는다.
const cache = new Map<string, { at: number; polys: Poly[] }>();
const CACHE_TTL_MS = 10 * 60_000;
// 한 동네의 숲 polygon 이 실측 약 0.9MB 다(남산 주변). TTL 이 지나면 못 쓰는
// 값인데도 Map 에 그대로 남아 메모리를 계속 붙잡고 있었다 — 여러 동네를 옮겨
// 다니며 코스를 만들면 그만큼 쌓인다. 쓸 때마다 만료분을 버리고 개수도 막는다.
const MAX_CACHE = 6;

function rememberPolys(key: string, polys: Poly[]): void {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at >= CACHE_TTL_MS) cache.delete(k);
  cache.set(key, { at: now, polys });
  // 아직 안 만료됐어도 개수가 넘치면 가장 오래된 것부터 버린다
  // (Map 은 넣은 순서를 지키므로 첫 키가 가장 오래된 것)
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** 검증용 — 지금 캐시에 몇 건이 남아 있는지 */
export function greenCacheSize(): number {
  return cache.size;
}

function bboxOf(routes: LatLng[][]): [number, number, number, number] | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const r of routes) {
    for (const [la, ln] of r) {
      if (la < minLat) minLat = la;
      if (la > maxLat) maxLat = la;
      if (ln < minLng) minLng = ln;
      if (ln > maxLng) maxLng = ln;
    }
  }
  if (!Number.isFinite(minLat)) return null;
  return [minLat - MARGIN_DEG, minLng - MARGIN_DEG, maxLat + MARGIN_DEG, maxLng + MARGIN_DEG];
}

function buildQuery(bbox: [number, number, number, number]): string {
  const b = bbox.map((v) => v.toFixed(5)).join(',');
  const parts = AREA_GROUPS.map(
    // way 와 relation 을 모두 본다 — 남산·서울숲 같은 큰 공원은 relation 이다
    ([k, v]) => `way["${k}"~"${v}"](${b});relation["${k}"~"${v}"](${b});`,
  ).join('');
  // out 에 개수 상한을 둔다. 공원이 수천 개인 지역을 만나도 응답이 폭주하지
  // 않는다 — 실측(여의도 6.2km bbox)에서 상한 없는 쿼리는 504 로 죽고,
  // 400 상한을 건 같은 쿼리는 200/74KB 로 돌아왔다. 실제 요소는 30개뿐이라
  // 결과는 같다.
  return `[out:json][timeout:20];(${parts});out geom ${MAX_ELEMENTS};`;
}

function toPoly(pts: LatLng[]): Poly | null {
  if (pts.length < 3) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [la, ln] of pts) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln;
    if (ln > maxLng) maxLng = ln;
  }
  return { pts, minLat, maxLat, minLng, maxLng };
}

/** Overpass 응답 → 폴리곤 목록 (relation 은 멤버 링을 각각 하나로 본다) */
export function parseGreenPolys(json: unknown): Poly[] {
  const els = (json as { elements?: unknown[] })?.elements;
  if (!Array.isArray(els)) return [];
  const out: Poly[] = [];
  for (const raw of els) {
    const e = raw as {
      type?: string;
      geometry?: { lat: number; lon: number }[];
      members?: { geometry?: { lat: number; lon: number }[]; role?: string }[];
    };
    if (Array.isArray(e.geometry)) {
      const p = toPoly(e.geometry.map((g) => [g.lat, g.lon] as LatLng));
      if (p) out.push(p);
    }
    // relation: outer 링만 쓴다. inner(구멍)까지 다루면 정확해지지만, 공원
    // 안의 건물 몇 채를 빼려고 복잡도를 올릴 만한 정확도가 아니다.
    for (const m of e.members ?? []) {
      if (m.role === 'inner' || !Array.isArray(m.geometry)) continue;
      const p = toPoly(m.geometry.map((g) => [g.lat, g.lon] as LatLng));
      if (p) out.push(p);
    }
  }
  return out;
}

/** 광선 교차법. 위경도를 평면처럼 다뤄도 도시 규모에서는 오차가 없다. */
function inside(pt: LatLng, poly: Poly): boolean {
  const [y, x] = pt;
  if (y < poly.minLat || y > poly.maxLat || x < poly.minLng || x > poly.maxLng) return false;
  const p = poly.pts;
  let hit = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [yi, xi] = p[i];
    const [yj, xj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** 경로를 일정 거리 간격으로 찍는다 (개수 상한 안에서) */
export function sampleAlong(coords: LatLng[], stepM = SAMPLE_M): LatLng[] {
  if (coords.length < 2) return coords.slice();
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineMeters(coords[i - 1], coords[i]);
  const step = Math.max(stepM, total / MAX_SAMPLES);

  const out: LatLng[] = [coords[0]];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const segLen = haversineMeters(coords[i - 1], coords[i]);
    if (segLen <= 0) continue;
    let t = step - carry;
    while (t <= segLen) {
      const f = t / segLen;
      out.push([
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f,
      ]);
      t += step;
    }
    carry = (carry + segLen) % step;
  }
  return out;
}

/** 경로 하나의 숲길 비율(0~100) */
export function greenShareOf(coords: LatLng[], polys: Poly[]): number {
  const pts = sampleAlong(coords);
  if (pts.length === 0) return 0;
  let hit = 0;
  for (const pt of pts) {
    for (const poly of polys) {
      if (inside(pt, poly)) {
        hit++;
        break;
      }
    }
  }
  return Math.round((hit / pts.length) * 100);
}

/**
 * 여러 경로의 숲길 비율을 한 번의 Overpass 호출로 구한다.
 * 실패·차단·시간 초과는 전부 null 로 돌려준다 — 부가 정보라 조용히 없던 일이 된다.
 */
export async function fetchGreenShares(routes: LatLng[][]): Promise<(number | null)[]> {
  const empty = routes.map(() => null);
  const bbox = bboxOf(routes);
  if (!bbox) return empty;
  if (bbox[2] - bbox[0] > MAX_SPAN_DEG || bbox[3] - bbox[1] > MAX_SPAN_DEG) return empty;

  const key = bbox.map((v) => v.toFixed(3)).join(',');
  const hit = cache.get(key);
  let polys: Poly[];
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    polys = hit.polys;
  } else {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      let res = await postQuery(bbox, ac.signal);
      if (res.status === 504 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000));
        if (ac.signal.aborted) return empty;
        res = await postQuery(bbox, ac.signal);
      }
      if (!res.ok) return empty;
      polys = parseGreenPolys(await res.json());
      rememberPolys(key, polys);
    } catch {
      return empty;
    } finally {
      clearTimeout(timer);
    }
  }
  if (polys.length === 0) return routes.map(() => 0);
  return routes.map((r) => greenShareOf(r, polys));
}

/**
 * 녹지를 조회할 반경(km). bbox 는 시작점 중심이라 '경로 길이'가 아니라
 * '시작점에서 얼마나 멀어지는가'로 잡아야 한다.
 *
 * 예전엔 목표거리 × 1.2 를 반경으로 썼는데, 15km 왕복은 시작점에서 최대
 * 7.5km(왕복 직선 최악)인데도 18km 반경을 물어봤다 — 필요한 면적의 5배가
 * 넘고, bbox 가 MAX_SPAN_DEG 를 넘겨 12km 이상 목표에서는 그늘이 조용히
 * 빠졌다(실측: 12km→0.267°, 15km→0.332° 로 조회 자체가 안 됐다).
 */
export function greenRadiusKm(targetKm: number, loop: boolean): number {
  // 왕복은 갔다 오므로 최대 반경이 절반, 편도는 한 방향으로 뻗는다
  // (편도는 직선거리를 0.8배로 줄여 잡는다 — courseBuilder.oneWayFromStart)
  return (loop ? targetKm / 2 : targetKm * 0.85) + 0.5;
}

/** bbox 한 변이 이 각도를 넘으면 조회하지 않는다 (검증용 공개) */
export const GREEN_MAX_SPAN_DEG = MAX_SPAN_DEG;
export const GREEN_MARGIN_DEG = MARGIN_DEG;

/**
 * 이미 받아 둔 숲길 비율을 그대로 써도 되는가.
 *
 * **개수나 내용으로 비교하면 안 된다.** 후보는 거의 항상 3개라, '다시 찾기'로
 * 완전히 다른 동네 코스를 만들어도 개수가 같아서 이전 값이 그대로 남는다
 * (실측: 여의도 31%/12%/4% 가 강남 코스 카드에 그대로 표시됐다).
 * 같은 결과 객체일 때만 재사용한다.
 */
export function greenIsFor(cachedFor: unknown, results: unknown): boolean {
  return cachedFor != null && cachedFor === results;
}

/**
 * 시작점 주변 영역의 녹지 폴리곤을 미리 받는다.
 * 경로 생성과 병렬로 돌려, 둘 다 끝나면 greenShareOf 로 채점한다.
 * 실패하면 null — 호출측은 이 축을 빼고 채점한다.
 */
export async function fetchGreenPolysForArea(
  center: LatLng,
  radiusKm: number,
): Promise<Poly[] | null> {
  // 위도 1도는 어디서나 ~111km 지만, 경도 1도는 위도에 따라 줄어든다
  // (서울 37.5°에서 ~88km). 위도 값을 경도에도 쓰면 동서 폭이 21% 모자라
  // 동쪽으로 뻗은 코스의 공원이 조회 범위 밖으로 빠진다 — 여름철 랭킹에서
  // 그 코스만 초록 점수를 덜 받는, 방향에 따라 갈리는 편향이 생긴다.
  const latMargin = radiusKm / 111;
  const lngMargin = radiusKm / (111 * Math.cos((center[0] * Math.PI) / 180));
  const bbox: [number, number, number, number] = [
    center[0] - latMargin - MARGIN_DEG,
    center[1] - lngMargin - MARGIN_DEG,
    center[0] + latMargin + MARGIN_DEG,
    center[1] + lngMargin + MARGIN_DEG,
  ];
  if (bbox[2] - bbox[0] > MAX_SPAN_DEG || bbox[3] - bbox[1] > MAX_SPAN_DEG) return null;

  const key = bbox.map((v) => v.toFixed(3)).join(',');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.polys;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    let res = await postQuery(bbox, ac.signal);
    if (res.status === 504 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000));
      if (ac.signal.aborted) return null;
      res = await postQuery(bbox, ac.signal);
    }
    if (!res.ok) return null;
    const polys = parseGreenPolys(await res.json());
    rememberPolys(key, polys);
    return polys;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function postQuery(bbox: [number, number, number, number], signal: AbortSignal): Promise<Response> {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass 는 정체불명의 User-Agent 를 406 으로 거절한다. 실측: 이 줄이
      // 없으면 node 기본 UA 로 100% 406 이 떨어졌다. 브라우저에서는 금지
      // 헤더라 조용히 무시되고 브라우저 UA 가 나가므로 해가 없다.
      // Overpass 이용 정책도 신원을 밝히라고 요구한다.
      'User-Agent': 'runcourse/1.0 (https://won-topiaa.github.io/Running-course/)',
    },
    body: `data=${encodeURIComponent(buildQuery(bbox))}`,
    signal,
  });
}
