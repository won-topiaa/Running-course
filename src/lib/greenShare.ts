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
// 순위에는 넣지 않는다. 결과가 나온 뒤에 도착하는 값이라 여기서 재정렬하면
// 사용자가 카드를 고르는 도중에 순서가 바뀐다.
// ---------------------------------------------------------------------------

import { haversineMeters } from './geo';
import type { LatLng } from './types';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const TIMEOUT_MS = 8_000;
/** 경로 주변 여유 (bbox 를 이만큼 넓혀 가장자리 공원도 잡는다) */
const MARGIN_DEG = 0.004; // 약 400m
/** 이보다 넓은 영역은 조회하지 않는다 — Overpass 가 오래 걸리고 예의도 아니다 */
const MAX_SPAN_DEG = 0.25; // 약 25km
/** 경로를 이 간격으로 찍어 판정한다 */
const SAMPLE_M = 40;
const MAX_SAMPLES = 250;

/** 그늘이 있다고 볼 만한 OSM 면(面) 태그 */
const AREA_FILTERS = [
  'leisure=park',
  'leisure=garden',
  'leisure=nature_reserve',
  'landuse=forest',
  'landuse=grass',
  'landuse=recreation_ground',
  'natural=wood',
  'natural=scrub',
];

interface Poly {
  pts: LatLng[];
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// bbox 당 결과를 잠깐 기억한다. '다시 찾기'를 눌러도 같은 동네면 재조회하지 않는다.
const cache = new Map<string, { at: number; polys: Poly[] }>();
const CACHE_TTL_MS = 10 * 60_000;

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
  const parts = AREA_FILTERS.map((f) => {
    const [k, v] = f.split('=');
    // way 와 relation 을 모두 본다 — 남산·서울숲 같은 큰 공원은 relation 이다
    return `way["${k}"="${v}"](${b});relation["${k}"="${v}"](${b});`;
  }).join('');
  return `[out:json][timeout:20];(${parts});out geom;`;
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
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(buildQuery(bbox))}`,
        signal: ac.signal,
      });
      if (!res.ok) return empty;
      polys = parseGreenPolys(await res.json());
      cache.set(key, { at: Date.now(), polys });
    } catch {
      return empty;
    } finally {
      clearTimeout(timer);
    }
  }
  if (polys.length === 0) return routes.map(() => 0);
  return routes.map((r) => greenShareOf(r, polys));
}
