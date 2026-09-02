import { haversineMeters } from './geo';
import type { LatLng } from './types';

/**
 * 공공체육시설 (데이터셋 15107764).
 *
 * 편의시설(화장실·샤워실 등) 필드는 이 데이터셋에 없다. 예전에는 시설명에서
 * 키워드를 주워 추측했는데, 그건 데이터가 아니라 지어낸 값이라 걷어냈다.
 * 여기 있는 건 전부 개방 데이터에 실제로 실린 값이다.
 */
export interface Facility {
  id: string;
  name: string;
  /** 시설 유형 (ftype_nm) — 축구장, 테니스장 … */
  type: string;
  /** 종목 (fcob_nm) */
  bizType: string;
  district: string;
  address: string;
  lat: number;
  lng: number;
  /** faci_gb_nm === '공공' */
  isPublic: boolean;
  /** nation_yn === 'Y' */
  isNational: boolean;
}

export interface NearbyFacility extends Facility {
  distanceM: number;
}

/**
 * 시설 1,284건이 420KB 다. 홈 화면(만들기)이 이 모듈을 참조하는 탓에
 * 정적으로 import 하면 첫 로딩에 그대로 얹힌다 — 근처 시설을 실제로 그릴 때만
 * 받아 오도록 잘라 둔다. 한 번 받으면 캐시한다.
 */
let cache: Facility[] | null = null;
let inflight: Promise<Facility[]> | null = null;

export function loadFacilities(): Promise<Facility[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = import('../data/facilities.json')
      .then((m) => {
        cache = (m.default as { facilities: Facility[] }).facilities;
        return cache;
      })
      .catch(() => {
        // 못 받아 오면 시설 칸만 빠진다 — 코스 자체는 그대로 쓸 수 있어야 한다
        inflight = null;
        return [];
      });
  }
  return inflight;
}

/** 이미 받아 둔 경우에만 즉시 돌려준다 (첫 렌더에서 깜빡임을 줄이는 용도) */
export function loadedFacilities(): Facility[] | null {
  return cache;
}

const MAX_RADIUS_M = 2000;

export function findNearbyIn(
  facilities: Facility[],
  center: LatLng,
  radiusM = MAX_RADIUS_M,
  limit = 5,
): NearbyFacility[] {
  const results: NearbyFacility[] = [];
  for (const f of facilities) {
    const d = haversineMeters(center, [f.lat, f.lng]);
    if (d <= radiusM) results.push({ ...f, distanceM: d });
  }
  results.sort((a, b) => a.distanceM - b.distanceM);
  return results.slice(0, limit);
}

export function findNearRouteIn(
  facilities: Facility[],
  path: LatLng[],
  radiusM = 500,
  limit = 5,
): NearbyFacility[] {
  const seen = new Set<string>();
  const results: NearbyFacility[] = [];

  const step = Math.max(1, Math.floor(path.length / 20));
  for (let i = 0; i < path.length; i += step) {
    for (const f of facilities) {
      if (seen.has(f.id)) continue;
      const d = haversineMeters(path[i], [f.lat, f.lng]);
      if (d <= radiusM) {
        seen.add(f.id);
        results.push({ ...f, distanceM: d });
      }
    }
  }

  // 출발·도착점은 러너가 실제로 들를 확률이 높아 반경을 1.5배로 넓힌다
  const startPt = path[0];
  const endPt = path[path.length - 1];
  for (const f of facilities) {
    if (seen.has(f.id)) continue;
    const dStart = haversineMeters(startPt, [f.lat, f.lng]);
    const dEnd = haversineMeters(endPt, [f.lat, f.lng]);
    const d = Math.min(dStart, dEnd);
    if (d <= radiusM * 1.5) {
      seen.add(f.id);
      results.push({ ...f, distanceM: d });
    }
  }

  results.sort((a, b) => a.distanceM - b.distanceM);
  return results.slice(0, limit);
}

export async function findNearby(
  center: LatLng,
  radiusM = MAX_RADIUS_M,
  limit = 5,
): Promise<NearbyFacility[]> {
  return findNearbyIn(await loadFacilities(), center, radiusM, limit);
}

export async function findNearRoute(
  path: LatLng[],
  radiusM = 500,
  limit = 5,
): Promise<NearbyFacility[]> {
  return findNearRouteIn(await loadFacilities(), path, radiusM, limit);
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
