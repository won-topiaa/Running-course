// ---------------------------------------------------------------------------
// 라우팅 provider 추상화
//
// 실제 도보 경로 + 지점별 고도(→ 구간 경사)를 만드는 계층.
// - OrsProvider : OpenRouteService 실 API (도보 경로 / 왕복 생성 / 고도)
// - OfflineProvider : 키·네트워크 없이도 UI가 도는 폴백 (직선 연결 + 합성 고도)
// 좌표는 앱 규약대로 [lat, lng]. ORS 요청 시에만 [lng, lat] 로 뒤집는다.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';
import {
  densifyPath,
  destinationPoint,
  haversineMeters,
  pathLengthMeters,
} from './geo';

const ORS_BASE = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson';

export interface RouteSegment {
  gradePct: number; // 구간 경사(%) (+오르막 / -내리막)
  lengthM: number;
}

export interface RouteResult {
  coords: LatLng[]; //     경로 좌표 [lat, lng]
  elevations: number[]; // 각 좌표의 고도(m)
  distanceKm: number;
  ascentM: number; //      누적 상승
  descentM: number; //     누적 하강
  maxGradePct: number; //  최대 경사(절댓값)
  segments: RouteSegment[];
  source: 'ors' | 'offline';
  waypoints: LatLng[]; //  입력 경유지/시작점
}

export type RoutingErrorCode =
  | 'invalid_key'
  | 'rate_limit'
  | 'blocked'
  | 'network'
  | 'no_route'
  | 'unknown';

export class RoutingError extends Error {
  constructor(
    public code: RoutingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}

export interface RouteOptions {
  points?: number; // 왕복 생성 시 경유 지점 수
  seed?: number; //   왕복 생성 시 시드
}

export interface RoutingProvider {
  readonly id: 'ors' | 'offline';
  readonly label: string;
  /** 경유지를 순서대로 잇는 도보 경로 */
  route(waypoints: LatLng[]): Promise<RouteResult>;
  /** 시작점에서 목표 거리에 맞춘 왕복(루프) 경로 */
  roundTrip(start: LatLng, targetKm: number, opts?: RouteOptions): Promise<RouteResult>;
}

// --- 공통: 좌표열 + 고도로부터 RouteResult 계산 -----------------------------

/** 고도 노이즈를 줄이기 위한 3점 이동평균 */
function smooth(values: number[]): number[] {
  if (values.length < 3) return values.slice();
  return values.map((v, i) => {
    if (i === 0 || i === values.length - 1) return v;
    return (values[i - 1] + v + values[i + 1]) / 3;
  });
}

export function buildResult(
  coords: LatLng[],
  rawElev: number[],
  source: RouteResult['source'],
  waypoints: LatLng[],
): RouteResult {
  const elevations = smooth(rawElev);
  let distance = 0;
  let ascent = 0;
  let descent = 0;
  let maxGrade = 0;
  const segments: RouteSegment[] = [];

  for (let i = 1; i < coords.length; i++) {
    const segLen = haversineMeters(coords[i - 1], coords[i]);
    distance += segLen;
    const dz = elevations[i] - elevations[i - 1];
    if (dz > 0) ascent += dz;
    else descent += -dz;
    const grade = segLen > 0.5 ? (dz / segLen) * 100 : 0;
    if (Math.abs(grade) > maxGrade) maxGrade = Math.abs(grade);
    segments.push({ gradePct: grade, lengthM: segLen });
  }

  return {
    coords,
    elevations,
    distanceKm: distance / 1000,
    ascentM: Math.round(ascent),
    descentM: Math.round(descent),
    maxGradePct: Math.round(maxGrade * 10) / 10,
    segments,
    source,
    waypoints,
  };
}

// --- OpenRouteService provider ---------------------------------------------

function parseOrsGeoJson(
  gj: any,
  source: RouteResult['source'],
  waypoints: LatLng[],
): RouteResult {
  const feat = gj?.features?.[0];
  const line = feat?.geometry?.coordinates;
  if (!Array.isArray(line) || line.length < 2) {
    throw new RoutingError('no_route', '경로를 만들 수 없습니다.');
  }
  const coords: LatLng[] = line.map((c: number[]) => [c[1], c[0]]);
  const elevations: number[] = line.map((c: number[]) => c[2] ?? 0);
  return buildResult(coords, elevations, source, waypoints);
}

export class OrsProvider implements RoutingProvider {
  readonly id = 'ors' as const;
  readonly label = 'OpenRouteService';
  constructor(private apiKey: string) {}

  async route(waypoints: LatLng[]): Promise<RouteResult> {
    const body = {
      coordinates: waypoints.map(([lat, lng]) => [lng, lat]),
      elevation: true,
      instructions: false,
    };
    const gj = await this.rawPost(body);
    return parseOrsGeoJson(gj, 'ors', waypoints);
  }

  async roundTrip(
    start: LatLng,
    targetKm: number,
    opts: RouteOptions = {},
  ): Promise<RouteResult> {
    const body = {
      coordinates: [[start[1], start[0]]],
      elevation: true,
      instructions: false,
      options: {
        round_trip: {
          length: Math.round(targetKm * 1000),
          points: opts.points ?? 5,
          seed: opts.seed ?? 0,
        },
      },
    };
    const gj = await this.rawPost(body);
    return parseOrsGeoJson(gj, 'ors', [start]);
  }

  /** 실제 fetch 후 GeoJSON 반환 (에러는 RoutingError 로 정규화) */
  private async rawPost(body: unknown): Promise<any> {
    let res: Response;
    try {
      res = await fetch(ORS_BASE, {
        method: 'POST',
        headers: {
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/geo+json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new RoutingError('network', '네트워크에 연결할 수 없습니다.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new RoutingError('invalid_key', 'API 키가 유효하지 않거나 권한이 없습니다.');
    }
    if (res.status === 429) {
      throw new RoutingError('rate_limit', '무료 요청 한도를 초과했습니다.');
    }
    if (!res.ok) {
      throw new RoutingError('unknown', `OpenRouteService 요청 실패 (${res.status})`);
    }
    return res.json();
  }
}

// --- 오프라인 폴백 provider --------------------------------------------------

/**
 * 위치 기반 합성 고도(m). 여러 주기의 사인파를 합쳐 자연스러운 완만한 지형을 만든다.
 * 키·네트워크가 없어도 경사 색상/스타일 점수/차트가 작동하도록 하기 위한 데모용.
 */
export function syntheticElevation(lat: number, lng: number): number {
  const x = lng * 111320 * Math.cos((lat * Math.PI) / 180);
  const y = lat * 110540;
  return (
    45 +
    20 * Math.sin(x / 1300) * Math.cos(y / 1600) +
    11 * Math.sin(x / 520 + 1.3) * Math.sin(y / 610 - 0.7) +
    5 * Math.cos((x + y) / 240)
  );
}

/** 시작점을 지나는 대략적인 루프(다각형) 정점열을 만든다. 목표 거리에 맞춰 반지름 보정. */
function generateLoop(
  start: LatLng,
  targetKm: number,
  points: number,
  seed: number,
): LatLng[] {
  const targetM = targetKm * 1000;
  const baseBearing = (seed * 63.7) % 360;

  const buildRing = (radius: number): LatLng[] => {
    // 시작점에서 baseBearing 방향으로 radius 떨어진 곳을 중심으로 잡으면
    // 중심에서 (baseBearing+180) 방향 정점이 시작점 부근이 된다.
    const center = destinationPoint(start, baseBearing, radius);
    const ring: LatLng[] = [start];
    for (let k = 1; k < points; k++) {
      const bearing = baseBearing + 180 + (360 / points) * k;
      ring.push(destinationPoint(center, bearing, radius));
    }
    ring.push(start); // 루프 닫기
    return ring;
  };

  let radius = targetM / (2 * Math.PI);
  let ring = buildRing(radius);
  // 실제 둘레를 재서 한 번 보정
  const measured = pathLengthMeters(ring);
  if (measured > 0) {
    radius *= targetM / measured;
    ring = buildRing(radius);
  }
  return ring;
}

export class OfflineProvider implements RoutingProvider {
  readonly id = 'offline' as const;
  readonly label = '오프라인 데모';

  async route(waypoints: LatLng[]): Promise<RouteResult> {
    if (waypoints.length < 2) {
      throw new RoutingError('no_route', '경유지가 2개 이상 필요합니다.');
    }
    const dense = densifyPath(waypoints, 45);
    const elev = dense.map(([lat, lng]) => syntheticElevation(lat, lng));
    return buildResult(dense, elev, 'offline', waypoints);
  }

  async roundTrip(
    start: LatLng,
    targetKm: number,
    opts: RouteOptions = {},
  ): Promise<RouteResult> {
    const ring = generateLoop(start, targetKm, opts.points ?? 5, opts.seed ?? 0);
    const dense = densifyPath(ring, 45);
    const elev = dense.map(([lat, lng]) => syntheticElevation(lat, lng));
    return buildResult(dense, elev, 'offline', [start]);
  }
}

/** 키가 있으면 ORS, 없으면 오프라인 provider */
export function makeProvider(orsKey: string | null): RoutingProvider {
  return orsKey ? new OrsProvider(orsKey) : new OfflineProvider();
}
