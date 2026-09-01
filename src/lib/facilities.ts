import facilityData from '../data/facilities.json';
import { haversineMeters } from './geo';
import type { LatLng } from './types';

export interface Facility {
  id: string;
  name: string;
  type: string;
  district: string;
  address: string;
  lat: number;
  lng: number;
  amenities: string[];
}

export type FacilityAmenity =
  | 'restroom'
  | 'parking'
  | 'shower'
  | 'locker'
  | 'track';

const AMENITY_LABEL: Record<FacilityAmenity, string> = {
  restroom: '화장실',
  parking: '주차장',
  shower: '샤워실',
  locker: '보관함',
  track: '트랙',
};

export function amenityLabel(a: FacilityAmenity): string {
  return AMENITY_LABEL[a] ?? a;
}

const AMENITY_ICON: Record<FacilityAmenity, string> = {
  restroom: '🚻',
  parking: '🅿️',
  shower: '🚿',
  locker: '🔐',
  track: '🏃',
};

export function amenityIcon(a: FacilityAmenity): string {
  return AMENITY_ICON[a] ?? '';
}

const allFacilities: Facility[] = facilityData.facilities as Facility[];

const MAX_RADIUS_M = 2000;

export interface NearbyFacility extends Facility {
  distanceM: number;
}

export function findNearby(
  center: LatLng,
  radiusM = MAX_RADIUS_M,
  limit = 5,
): NearbyFacility[] {
  const results: NearbyFacility[] = [];
  for (const f of allFacilities) {
    const d = haversineMeters(center, [f.lat, f.lng]);
    if (d <= radiusM) results.push({ ...f, distanceM: d });
  }
  results.sort((a, b) => a.distanceM - b.distanceM);
  return results.slice(0, limit);
}

export function findNearRoute(
  path: LatLng[],
  radiusM = 500,
  limit = 5,
): NearbyFacility[] {
  const seen = new Set<string>();
  const results: NearbyFacility[] = [];

  const step = Math.max(1, Math.floor(path.length / 20));
  for (let i = 0; i < path.length; i += step) {
    for (const f of allFacilities) {
      if (seen.has(f.id)) continue;
      const d = haversineMeters(path[i], [f.lat, f.lng]);
      if (d <= radiusM) {
        seen.add(f.id);
        results.push({ ...f, distanceM: d });
      }
    }
  }

  const startPt = path[0];
  const endPt = path[path.length - 1];
  for (const f of allFacilities) {
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

export function facilityCount(): number {
  return allFacilities.length;
}

export function isSeedData(): boolean {
  return !!(facilityData as { seed?: boolean }).seed;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
