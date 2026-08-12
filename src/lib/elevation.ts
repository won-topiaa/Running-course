// ---------------------------------------------------------------------------
// 실제 고도 조회 — Open-Meteo Elevation API (API 키 불필요)
//
// 경로 좌표가 수백~수천 개라 전부 조회할 수 없으므로(요청당 100개 제한),
// 경로를 따라 균등 샘플링해 조회한 뒤 나머지 좌표에 선형 보간한다.
// 실패하면 합성 고도로 폴백해 UI 가 깨지지 않게 한다.
// ---------------------------------------------------------------------------

import { fetchWithTimeout } from './fetchTimeout';
import { haversineMeters } from './geo';
import type { LatLng } from './types';

const ENDPOINT = 'https://api.open-meteo.com/v1/elevation';
const MAX_PER_REQUEST = 100; // Open-Meteo 한 요청에 담을 수 있는 좌표 수

// ── 요청량 ───────────────────────────────────────────────────────────────
// Open-Meteo 무료 한도는 '분당 좌표 약 600개'다. 실측: 100좌표 요청을 7번
// 연달아 보내면 7번째에 429 와 함께
//   {"reason":"Minutely API request limit exceeded..."}
// 가 온다.
//
// 예전엔 경로마다 200개를 뽑았고 추천받기 한 번이 후보 4개를 만드니 800개 —
// 한 번만 눌러도 한도를 넘겼다. 넘긴 뒤엔 조회가 실패하고 호출측이 조용히
// 합성 고도(데모용 사인파)를 대신 넣어서, 실제로는 상승 20m 인 코스가
// 368m 로 보이거나 그 반대가 됐다. 스타일 점수도 그 가짜 값으로 매겨졌다.
//
// 100m 에 한 점이면 러닝 코스의 오르내림을 놓치지 않는다(고도 프로파일은
// 어차피 3점 이동평균으로 다듬는다). 5km→50점, 15km 이상이어도 100점 상한.
const SAMPLE_SPACING_M = 100;
const MAX_SAMPLES = 100;
const MIN_SAMPLES = 12;

// ── 좌표 캐시 ────────────────────────────────────────────────────────────
// 같은 출발점에서 만든 후보들은 앞뒤 구간이 많이 겹친다. 11m 격자로 반올림해
// 기억해 두면 그만큼 요청이 준다. 지형은 안 변하므로 만료가 필요 없고,
// 개수만 막는다.
const MAX_CACHE = 4000;
const cache = new Map<string, number>();
const cacheKey = (p: LatLng) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;

function remember(p: LatLng, m: number): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey(p), m);
}

/** 검증용 — 지금 캐시에 몇 점이 들어 있는지 */
export function elevationCacheSize(): number {
  return cache.size;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 좌표 묶음의 고도(m) 조회 — 캐시에 없는 것만 100개씩 나눠 요청 */
async function fetchElevations(points: LatLng[]): Promise<number[]> {
  const missing: LatLng[] = [];
  const seen = new Set<string>();
  for (const p of points) {
    const k = cacheKey(p);
    if (cache.has(k) || seen.has(k)) continue;
    seen.add(k);
    missing.push(p);
  }

  for (let i = 0; i < missing.length; i += MAX_PER_REQUEST) {
    const chunk = missing.slice(i, i + MAX_PER_REQUEST);
    const lat = chunk.map((p) => p[0].toFixed(5)).join(',');
    const lng = chunk.map((p) => p[1].toFixed(5)).join(',');
    const url = `${ENDPOINT}?latitude=${lat}&longitude=${lng}`;
    // 한도는 '분당'이라 잠깐 기다리면 풀린다. 한 번만 더 물어본다 —
    // 여기서 포기하면 호출측이 가짜 고도를 넣게 된다.
    let res = await fetchWithTimeout(url);
    if (res.status === 429) {
      await sleep(1500);
      res = await fetchWithTimeout(url);
    }
    if (!res.ok) throw new Error(`elevation ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json?.elevation)) throw new Error('elevation malformed');
    json.elevation.forEach((v: unknown, k: number) => {
      if (typeof v === 'number' && Number.isFinite(v) && chunk[k]) remember(chunk[k], v);
    });
  }

  return points.map((p) => cache.get(cacheKey(p)) ?? 0);
}

/** 경로 길이에 맞춘 샘플 개수 — 100m 에 한 점, 12~100개 사이 */
function sampleCountFor(coords: LatLng[]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) len += haversineMeters(coords[i - 1], coords[i]);
  const wanted = Math.round(len / SAMPLE_SPACING_M) + 1;
  return Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, wanted));
}

/** 경로를 따라 누적 거리 기준 균등 샘플링한 인덱스 목록 */
function sampleIndices(coords: LatLng[], maxSamples: number): number[] {
  if (coords.length <= maxSamples) return coords.map((_, i) => i);
  const step = (coords.length - 1) / (maxSamples - 1);
  const idx: number[] = [];
  for (let i = 0; i < maxSamples; i++) idx.push(Math.round(i * step));
  return idx;
}

/**
 * 경로 전체 좌표의 실제 고도.
 * 샘플 지점만 조회하고 그 사이는 누적 거리 기준으로 선형 보간한다.
 */
export async function elevationsForPath(coords: LatLng[]): Promise<number[]> {
  if (coords.length === 0) return [];
  const idx = sampleIndices(coords, sampleCountFor(coords));
  const sampled = await fetchElevations(idx.map((i) => coords[i]));

  if (idx.length === coords.length) return sampled;

  // 누적 거리 계산 (보간 기준)
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(coords[i - 1], coords[i]));
  }

  const out: number[] = new Array(coords.length);
  let s = 0; // 현재 구간의 좌측 샘플
  for (let i = 0; i < coords.length; i++) {
    while (s < idx.length - 2 && idx[s + 1] < i) s++;
    const i0 = idx[s];
    const i1 = idx[Math.min(s + 1, idx.length - 1)];
    if (i1 === i0) {
      out[i] = sampled[s];
      continue;
    }
    const span = cum[i1] - cum[i0] || 1;
    const t = Math.max(0, Math.min(1, (cum[i] - cum[i0]) / span));
    out[i] = sampled[s] + (sampled[Math.min(s + 1, sampled.length - 1)] - sampled[s]) * t;
  }
  return out;
}
