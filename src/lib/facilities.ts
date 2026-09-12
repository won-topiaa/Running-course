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

/**
 * 같은 시설을 가리키는 행인가.
 *
 * 공공데이터 원본에 같은 시설이 여러 행으로 들어 있다 — 효창근린공원은 5행,
 * 도림천·금성윗들소공원 등도 2행씩이다(전체 1,284행 중 12행). id 가 서로
 * 달라서 id 로만 거르면 목록이 같은 이름으로 채워진다. 실제로 효창근린공원
 * 근처에서 코스를 만들면 '주변 시설' 네 칸이 전부 효창근린공원이었고, 다른
 * 시설은 전부 밀려났다.
 *
 * 원본 행은 그대로 두고(어떤 데이터를 받았는지가 증빙이다) 화면에 내보낼 때만
 * 합친다. 좌표는 소수점 5자리(약 1m)까지 같아야 같은 자리로 본다.
 */
function sameFacilityKey(f: Facility): string {
  return `${f.name.trim()}@${f.lat.toFixed(5)},${f.lng.toFixed(5)}`;
}

export function findNearbyIn(
  facilities: Facility[],
  center: LatLng,
  radiusM = MAX_RADIUS_M,
  limit = 5,
): NearbyFacility[] {
  const seen = new Set<string>();
  const results: NearbyFacility[] = [];
  for (const f of facilities) {
    const d = haversineMeters(center, [f.lat, f.lng]);
    if (d > radiusM) continue;
    const k = sameFacilityKey(f);
    if (seen.has(k)) continue; // 같은 시설의 중복 행
    seen.add(k);
    results.push({ ...f, distanceM: d });
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
      const k = sameFacilityKey(f);
      if (seen.has(k)) continue; // 같은 시설의 중복 행
      const d = haversineMeters(path[i], [f.lat, f.lng]);
      if (d <= radiusM) {
        seen.add(k);
        results.push({ ...f, distanceM: d });
      }
    }
  }

  // 출발·도착점은 러너가 실제로 들를 확률이 높아 반경을 1.5배로 넓힌다
  const startPt = path[0];
  const endPt = path[path.length - 1];
  for (const f of facilities) {
    const k = sameFacilityKey(f);
    if (seen.has(k)) continue; // 위 구간에서 이미 담았거나, 같은 시설의 중복 행
    const dStart = haversineMeters(startPt, [f.lat, f.lng]);
    const dEnd = haversineMeters(endPt, [f.lat, f.lng]);
    const d = Math.min(dStart, dEnd);
    if (d <= radiusM * 1.5) {
      seen.add(k);
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

/**
 * 시설까지의 거리(m) → "820m" / "1.2km".
 *
 * 이름에 Facility 를 붙여 둔다 — format.ts 의 formatDistance 는 **km** 를 받는다.
 * 둘 다 formatDistance 였을 때는 자동 임포트가 반대쪽을 집어와도 타입이 같아
 * (number → string) 아무 경고 없이 1000배 틀린 값이 찍힐 수 있었다.
 * subway.ts 의 formatStationDistance 와 같은 규칙이다.
 */
export function formatFacilityDistance(m: number): string {
  // 반올림을 단위 판정보다 먼저 — formatStationDistance 와 같은 이유
  const rounded = Math.round(m);
  if (rounded < 1000) return `${rounded}m`;
  return `${(rounded / 1000).toFixed(1)}km`;
}
