// ---------------------------------------------------------------------------
// 내가 만든/기록한 코스 저장소 (localStorage) + 공유 링크 코덱
// ---------------------------------------------------------------------------

import {
  decodePolyline,
  decodeShare,
  downsample,
  encodePolyline,
  encodeShare,
  type SharePayload,
} from './polyline';
import { buildResult, type RouteResult } from './routing';
import type { RunStyle } from './routeStyle';
import type { LatLng } from './types';

const KEY = 'run-app-routes-v1';

export interface SavedRoute {
  id: string;
  name: string;
  createdAt: number;
  kind: 'built' | 'recorded';
  style?: RunStyle;
  distanceKm: number;
  ascentM: number;
  maxGradePct: number;
  source: 'ors' | 'offline' | 'gps';
  coords: LatLng[];
  elevations: number[];
  durationSec?: number; // 기록한 러닝에만
}

export function loadRoutes(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as SavedRoute[];
  } catch {
    /* 무시 */
  }
  return [];
}

export function persistRoutes(routes: SavedRoute[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(routes));
  } catch {
    /* 무시 */
  }
}

const rid = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** RouteView(만든/기록한/공유된 경로) → 저장 레코드 */
export function savedFromView(v: {
  name: string;
  route: RouteResult;
  kind: SavedRoute['kind'];
  style?: RunStyle;
  source: string;
  durationSec?: number;
}): SavedRoute {
  const src: SavedRoute['source'] =
    v.source === 'ors' || v.source === 'gps' ? v.source : 'offline';
  return {
    id: rid(),
    name: v.name,
    createdAt: Date.now(),
    kind: v.kind,
    style: v.style,
    distanceKm: v.route.distanceKm,
    ascentM: v.route.ascentM,
    maxGradePct: v.route.maxGradePct,
    source: v.kind === 'recorded' ? 'gps' : src,
    coords: v.route.coords,
    elevations: v.route.elevations,
    durationSec: v.durationSec,
  };
}

/** SavedRoute 를 지도/차트에서 쓰는 RouteResult 로 복원 */
export function toRouteResult(s: SavedRoute): RouteResult {
  const src = s.source === 'gps' ? 'offline' : s.source;
  return buildResult(s.coords, s.elevations, src, [s.coords[0]]);
}

// --- 공유 ------------------------------------------------------------------

export function buildShareToken(s: {
  name: string;
  style?: RunStyle;
  distanceKm: number;
  ascentM: number;
  maxGradePct: number;
  source: string;
  coords: LatLng[];
  elevations: number[];
}): string {
  const coords = downsample(s.coords, 100);
  const elev = downsample(s.elevations, 60).map((e) => Math.round(e));
  const payload: SharePayload = {
    n: s.name,
    s: s.style,
    d: Math.round(s.distanceKm * 100) / 100,
    a: s.ascentM,
    g: s.maxGradePct,
    src: s.source,
    p: encodePolyline(coords),
    e: elev,
  };
  return encodeShare(payload);
}

export function shareUrl(token: string): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#course=${token}`;
}

export interface SharedRoute {
  name: string;
  style?: string;
  distanceKm: number;
  ascentM: number;
  maxGradePct: number;
  source: string;
  route: RouteResult;
}

/** URL 해시(#course=...) 에서 공유된 코스 복원 */
export function parseSharedFromHash(hash: string): SharedRoute | null {
  const m = /[#&]course=([^&]+)/.exec(hash);
  if (!m) return null;
  const payload = decodeShare(decodeURIComponent(m[1]));
  if (!payload) return null;
  const coords = decodePolyline(payload.p);
  if (coords.length < 2) return null;
  // 고도 배열 길이를 좌표 수에 맞춰 선형 보간
  const elev = resample(payload.e, coords.length);
  return {
    name: payload.n,
    style: payload.s,
    distanceKm: payload.d,
    ascentM: payload.a,
    maxGradePct: payload.g,
    source: payload.src,
    route: buildResult(coords, elev, 'offline', [coords[0]]),
  };
}

function resample(values: number[], n: number): number[] {
  if (values.length === 0) return new Array(n).fill(0);
  if (values.length === n) return values.slice();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(values.length - 1, lo + 1);
    out.push(values[lo] + (values[hi] - values[lo]) * (t - lo));
  }
  return out;
}
