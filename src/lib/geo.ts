// ---------------------------------------------------------------------------
// 지리 계산 헬퍼
// 좌표 규약: 앱 전체에서 [위도(lat), 경도(lng)] 순서를 사용한다 (Leaflet 규약).
// OpenRouteService 는 [lng, lat] 를 쓰므로 provider 내부에서만 뒤집는다.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';

const R_EARTH = 6371008.8; // 지구 평균 반지름(m)
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** 두 좌표 사이 거리(m) — 하버사인 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 경로 전체 길이(m) */
export function pathLengthMeters(path: LatLng[]): number {
  let sum = 0;
  for (let i = 1; i < path.length; i++) sum += haversineMeters(path[i - 1], path[i]);
  return sum;
}

/** 시작점에서 방위각(도)·거리(m)만큼 이동한 좌표 */
export function destinationPoint(
  origin: LatLng,
  bearingDeg: number,
  distanceMeters: number,
): LatLng {
  const δ = distanceMeters / R_EARTH;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(origin[0]);
  const λ1 = toRad(origin[1]);
  const sinφ2 =
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);
  return [toDeg(φ2), ((toDeg(λ2) + 540) % 360) - 180];
}

/** 두 점 사이를 stepMeters 간격으로 촘촘히 채운 좌표열 (offline 라우팅용) */
export function densifySegment(
  a: LatLng,
  b: LatLng,
  stepMeters = 60,
): LatLng[] {
  const dist = haversineMeters(a, b);
  const n = Math.max(1, Math.round(dist / stepMeters));
  const out: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** 여러 지점을 직선으로 연결하며 촘촘히 채운다 (offline 라우팅용) */
export function densifyPath(points: LatLng[], stepMeters = 60): LatLng[] {
  if (points.length === 0) return [];
  const out: LatLng[] = [];
  for (let i = 1; i < points.length; i++) {
    out.push(...densifySegment(points[i - 1], points[i], stepMeters));
  }
  out.push(points[points.length - 1]);
  return out;
}

/** 좌표열을 최대 maxPoints 개로 균등 다운샘플 (고도 API 한도 대응) */
/**
 * 최근접 이웃(Nearest-Neighbor) 순서로 경유지를 재배열한다.
 * 첫 지점은 고정하고 이후 가장 가까운 지점을 차례로 잇는다. (핀 순서 최적화 후보용)
 */
export function nearestNeighborOrder(points: LatLng[]): LatLng[] {
  if (points.length <= 2) return [...points];
  const remaining = points.slice(1);
  const ordered: LatLng[] = [points[0]];
  let current = points[0];
  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(current, remaining[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    current = remaining.splice(best, 1)[0];
    ordered.push(current);
  }
  return ordered;
}
