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
const MAX_PER_REQUEST = 100; // Open-Meteo 제한
const MAX_SAMPLES = 200; //     경로당 최대 샘플 수 (요청 2회)

/** 좌표 묶음의 고도(m) 조회 — 100개 초과 시 나눠서 요청 */
async function fetchElevations(points: LatLng[]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += MAX_PER_REQUEST) {
    const chunk = points.slice(i, i + MAX_PER_REQUEST);
    const lat = chunk.map((p) => p[0].toFixed(5)).join(',');
    const lng = chunk.map((p) => p[1].toFixed(5)).join(',');
    const res = await fetchWithTimeout(`${ENDPOINT}?latitude=${lat}&longitude=${lng}`);
    if (!res.ok) throw new Error(`elevation ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json?.elevation)) throw new Error('elevation malformed');
    out.push(...json.elevation.map((v: unknown) => (typeof v === 'number' ? v : 0)));
  }
  return out;
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
  const idx = sampleIndices(coords, MAX_SAMPLES);
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
