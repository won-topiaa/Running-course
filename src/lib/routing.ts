// ---------------------------------------------------------------------------
// 라우팅 provider 추상화
//
// 실제 '사람이 걷고 뛸 수 있는' 도보 경로 + 지점별 고도(→ 구간 경사)를 만드는 계층.
// - OrsProvider     : OpenRouteService (키 필요) — 도보 경로 + 왕복 생성 + 고도 한 번에
// - OsrmProvider    : FOSSGIS 공개 OSRM foot (키 불필요) — 실제 보도·산책로에 스냅.
//                     고도는 Open-Meteo Elevation 으로 따로 조회한다.
// - OfflineProvider : 네트워크가 없을 때만 쓰는 최후 폴백 (직선 연결 + 합성 고도).
//                     실제 도로가 아니므로 UI 에서 '데모'로 분명히 표시한다.
// 좌표는 앱 규약대로 [lat, lng]. 외부 API 요청 시에만 [lng, lat] 로 뒤집는다.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';
import { elevationsForPath } from './elevation';
import { fetchWithTimeout } from './fetchTimeout';
import { parseWayMix, type WayMix } from './wayMix';
import { densifyPath, destinationPoint, haversineMeters, pathLengthMeters } from './geo';

const ORS_BASE = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson';
// ORS 는 주 경로 provider 라 응답이 늦으면 빨리 포기하고 OSRM 으로 넘어가는 편이
// 낫다. 실측 응답은 15km 8점 링까지 1초 이내 — 8초면 정상 응답의 8배 여유다.
// (OSRM 은 최후 수단이라 기본값 12초를 그대로 쓴다)
const ORS_TIMEOUT_MS = 8_000;
// 좌표를 도로에 붙일 때 허용할 최대 거리(m). 기본 350m 는 강·공원 한복판에
// 떨어진 링 꼭짓점을 못 붙여 요청 전체를 실패시킨다.
const SNAP_RADIUS_M = 1_500;
// FOSSGIS 가 운영하는 공개 OSRM (도보 프로파일). 키가 필요 없다.
const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';

/** 경로를 무엇으로 만들었는지 — UI 뱃지/문구에 그대로 쓰인다 */
export type RouteSource = 'ors' | 'osrm' | 'offline';

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
  source: RouteSource;
  waypoints: LatLng[]; //  입력 경유지/시작점
  /**
   * 길 성격(산책로/차도/노면). ORS 로 만든 경로에만 있다 — OSRM·오프라인
   * 폴백은 이 정보를 안 주므로 undefined 이고, UI 는 그때 표시를 생략한다.
   */
  way?: WayMix;
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
  readonly id: RouteSource;
  readonly label: string;
  /** 실제 도로/보도를 따라가는 경로인지 (false 면 데모 직선) */
  readonly realRoads: boolean;
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

/** 경사를 신뢰할 수 있는 최소 구간 길이(m). 이보다 짧으면 고도 오차가 그대로 증폭된다. */
const GRADE_WINDOW_M = 25;
/** 사람이 뛸 수 있는 현실적인 경사 상한(%) — 이를 넘으면 데이터 오류로 본다 */
const MAX_REAL_GRADE = 35;

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
  const segments: RouteSegment[] = [];

  for (let i = 1; i < coords.length; i++) {
    const segLen = haversineMeters(coords[i - 1], coords[i]);
    distance += segLen;
    const dz = elevations[i] - elevations[i - 1];
    if (dz > 0) ascent += dz;
    else descent += -dz;
    segments.push({ gradePct: 0, lengthM: segLen }); // 경사는 아래에서 창(window)으로 채운다
  }

  // 경사는 구간 하나로 재면 짧은 구간에서 수백 %가 나온다(고도 오차 ÷ 몇 m).
  // GRADE_WINDOW_M 이상 모인 묶음의 고도차로 계산해 묶음 전체에 같은 경사를 부여한다.
  let bucketStart = 0;
  let bucketLen = 0;
  for (let i = 0; i < segments.length; i++) {
    bucketLen += segments[i].lengthM;
    const isLast = i === segments.length - 1;
    if (bucketLen >= GRADE_WINDOW_M || isLast) {
      const dz = elevations[i + 1] - elevations[bucketStart];
      let grade = bucketLen > 1 ? (dz / bucketLen) * 100 : 0;
      grade = Math.max(-MAX_REAL_GRADE, Math.min(MAX_REAL_GRADE, grade));
      for (let k = bucketStart; k <= i; k++) segments[k].gradePct = grade;
      bucketStart = i + 1;
      bucketLen = 0;
    }
  }

  const maxGrade = segments.reduce((m, s) => Math.max(m, Math.abs(s.gradePct)), 0);

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

function parseOrsGeoJson(gj: any, source: RouteResult['source'], waypoints: LatLng[]): RouteResult {
  const feat = gj?.features?.[0];
  const line = feat?.geometry?.coordinates;
  if (!Array.isArray(line) || line.length < 2) {
    throw new RoutingError('no_route', '경로를 만들 수 없습니다.');
  }
  const coords: LatLng[] = line.map((c: number[]) => [c[1], c[0]]);
  const elevations: number[] = line.map((c: number[]) => c[2] ?? 0);
  const result = buildResult(coords, elevations, source, waypoints);
  // waytype/surface 는 같은 응답에 실려 온다 — 추가 호출도 지연도 없다
  const way = parseWayMix(feat?.properties?.extras);
  return way ? { ...result, way } : result;
}

export class OrsProvider implements RoutingProvider {
  readonly id = 'ors' as const;
  readonly label = 'OpenRouteService';
  readonly realRoads = true;
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

  /**
   * 목표 거리에 맞춘 왕복 루프.
   *
   * ORS 의 round_trip 옵션은 length 를 잘 지키지 않는다(실측: 5km 요청에 6.8~8.3km).
   * 그래서 다른 provider 와 동일하게 '고리 경유지를 실제 도로로 잇고 실측 거리로
   * 반지름을 보정'하는 방식을 쓴다.
   */
  async roundTrip(start: LatLng, targetKm: number, opts: RouteOptions = {}): Promise<RouteResult> {
    const best = await ringRoundTrip(
      async (ring) => {
        const gj = await this.rawPost({
          coordinates: ring.map(([lat, lng]) => [lng, lat]),
          elevation: true,
          instructions: false,
        });
        const feat = gj?.features?.[0];
        const line = feat?.geometry?.coordinates;
        if (!Array.isArray(line) || line.length < 2) {
          throw new RoutingError('no_route', '경로를 만들 수 없습니다.');
        }
        return {
          coords: line.map((c: number[]) => [c[1], c[0]] as LatLng),
          elevations: line.map((c: number[]) => c[2] ?? 0),
          way: parseWayMix(feat?.properties?.extras) ?? undefined,
        };
      },
      start,
      targetKm,
      opts,
    );
    const result = buildResult(best.coords, best.elevations ?? [], 'ors', [start]);
    return best.way ? { ...result, way: best.way } : result;
  }

  /** 실제 fetch 후 GeoJSON 반환 (에러는 RoutingError 로 정규화) */
  private async rawPost(body: Record<string, unknown>): Promise<any> {
    // 링 꼭짓점은 '이 근처를 돌자'는 힌트일 뿐인데, ORS 기본 스냅 반경이 350m 라
    // 한강 위에 떨어진 점은 도로를 못 찾고 404(code 2010)로 요청 전체가 죽는다.
    // 실측: 여의도·강남 루프 요청의 25% 가 이걸로 실패했다. 반경을 넉넉히 주면
    // 가까운 실제 도로로 붙고, 목표 거리는 어차피 뒤에서 보정한다.
    const coords = (body.coordinates as number[][] | undefined) ?? [];
    let res: Response;
    try {
      res = await fetchWithTimeout(
        ORS_BASE,
        {
          method: 'POST',
          headers: {
            Authorization: this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/geo+json',
          },
          // 페리 회피: 한강 유람선 항로 같은 뱃길이 OSM 에 페리로 등록돼 있으면
          // 도보 프로파일이 태워버린다. 뛸 수 없는 경로이므로 전 요청에서 막는다.
          body: JSON.stringify({
            ...body,
            radiuses: coords.map(() => SNAP_RADIUS_M),
            // 같은 응답으로 길 성격을 받아 온다 (wayMix.ts)
            extra_info: ['waytype', 'surface'],
            options: { avoid_features: ['ferries'] },
          }),
        },
        ORS_TIMEOUT_MS,
      );
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

// --- 왕복 루프 공통 전략 ------------------------------------------------------

interface Geometry {
  coords: LatLng[];
  elevations?: number[];
  /** ORS 만 채운다 — 보정 시도마다 다른 경로가 나오므로 채택된 시도의 것을 써야 한다 */
  way?: WayMix;
}

/**
 * 목표 거리에 맞춘 왕복 루프를 '실제 도로'로 만든다.
 *
 * 시작점 주변에 고리 모양 경유지를 만들어 provider 의 도보 라우팅으로 잇고,
 * 나온 경로의 실측 거리로 고리 반지름을 보정해 목표에 수렴시킨다(최대 3회).
 * 라우팅 엔진의 자체 왕복 기능보다 거리 정확도가 훨씬 좋다.
 */
async function ringRoundTrip(
  geomFn: (ring: LatLng[]) => Promise<Geometry>,
  start: LatLng,
  targetKm: number,
  opts: RouteOptions = {},
): Promise<Geometry> {
  const points = opts.points ?? 5;
  const seed = opts.seed ?? 0;
  let scale = 1;
  let best: Geometry | null = null;
  let bestErr = Infinity;

  // 보정 상한 3회. 실측(서울 3개 출발점 × 4개 목표거리)에서 4회째가 낸 개선은
  // 평균 1.25%p(8.83% → 7.58%)뿐이고 최악 오차는 22.5% 로 동일했다.
  // 응답이 느린 회선에서는 이 한 번이 그대로 대기 시간으로 붙으므로 3회에서 끊는다.
  // (2회로 줄이면 평균 오차가 14.87% 로 크게 나빠져 그 아래로는 못 내린다)
  for (let attempt = 0; attempt < 3; attempt++) {
    const ring = generateLoop(start, targetKm * scale, points, seed);
    const geom = await geomFn(ring);
    const km = pathLengthMeters(geom.coords) / 1000;
    const err = Math.abs(km - targetKm);
    if (err < bestErr) {
      bestErr = err;
      best = geom;
    }
    // 목표의 10% 안이면 충분히 맞은 것으로 본다
    if (err / targetKm < 0.1 || km <= 0) break;
    // 도로망은 연속적이지 않아 반지름을 그대로 비례 조정하면 진동한다.
    // 보정량을 감쇠(0.75)시키고 한 번에 ±40% 넘게 흔들리지 않도록 제한한다.
    const raw = targetKm / km;
    const damped = 1 + (raw - 1) * 0.75;
    scale *= Math.max(0.6, Math.min(1.4, damped));
  }

  if (!best) throw new RoutingError('no_route', '왕복 코스를 만들지 못했어요.');
  return best;
}

// --- OSRM(도보) provider — 키 불필요 ----------------------------------------

/**
 * FOSSGIS 공개 OSRM 도보 프로파일.
 * 실제 보도·공원길·산책로를 따라가는 경로를 돌려주므로 '사람이 뛸 수 있는 길'이 된다.
 * 고도는 제공하지 않아 Open-Meteo Elevation 으로 따로 조회하고, 실패 시 합성 고도로 대체한다.
 */
export class OsrmProvider implements RoutingProvider {
  readonly id = 'osrm' as const;
  readonly label = 'OSM 도보 경로';
  readonly realRoads = true;

  /** 경유지를 순서대로 잇는 실제 도보 경로 좌표 */
  private async fetchGeometry(waypoints: LatLng[]): Promise<LatLng[]> {
    const coordStr = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
    const url = `${OSRM_FOOT}/${coordStr}?overview=full&geometries=geojson&continue_straight=false`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url);
    } catch {
      throw new RoutingError('network', '경로 서버에 연결할 수 없습니다.');
    }
    if (res.status === 429) {
      throw new RoutingError('rate_limit', '요청이 많아요. 잠시 후 다시 시도해 주세요.');
    }
    if (!res.ok) {
      throw new RoutingError('unknown', `도보 경로 요청 실패 (${res.status})`);
    }
    const json = await res.json();
    if (json?.code !== 'Ok' || !json?.routes?.[0]?.geometry?.coordinates?.length) {
      throw new RoutingError('no_route', '이 지점들을 잇는 보행 경로를 찾지 못했어요.');
    }
    const line: number[][] = json.routes[0].geometry.coordinates;
    return line.map((c) => [c[1], c[0]] as LatLng);
  }

  /** 좌표열에 실제 고도를 입힌 RouteResult (고도 조회 실패 시 합성 고도) */
  private async withElevation(coords: LatLng[], waypoints: LatLng[]): Promise<RouteResult> {
    let elev: number[];
    try {
      elev = await elevationsForPath(coords);
    } catch {
      elev = coords.map(([lat, lng]) => syntheticElevation(lat, lng));
    }
    return buildResult(coords, elev, 'osrm', waypoints);
  }

  async route(waypoints: LatLng[]): Promise<RouteResult> {
    if (waypoints.length < 2) {
      throw new RoutingError('no_route', '경유지가 2개 이상 필요합니다.');
    }
    const coords = await this.fetchGeometry(waypoints);
    return this.withElevation(coords, waypoints);
  }

  /** 목표 거리에 맞춘 왕복 루프 (공통 ringRoundTrip 전략) */
  async roundTrip(start: LatLng, targetKm: number, opts: RouteOptions = {}): Promise<RouteResult> {
    const best = await ringRoundTrip(
      async (ring) => ({ coords: await this.fetchGeometry(ring) }),
      start,
      targetKm,
      opts,
    );
    return this.withElevation(best.coords, [start]);
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
function generateLoop(start: LatLng, targetKm: number, points: number, seed: number): LatLng[] {
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
  readonly label = '데모(직선)';
  readonly realRoads = false;

  async route(waypoints: LatLng[]): Promise<RouteResult> {
    if (waypoints.length < 2) {
      throw new RoutingError('no_route', '경유지가 2개 이상 필요합니다.');
    }
    const dense = densifyPath(waypoints, 45);
    const elev = dense.map(([lat, lng]) => syntheticElevation(lat, lng));
    return buildResult(dense, elev, 'offline', waypoints);
  }

  async roundTrip(start: LatLng, targetKm: number, opts: RouteOptions = {}): Promise<RouteResult> {
    const ring = generateLoop(start, targetKm, opts.points ?? 5, opts.seed ?? 0);
    const dense = densifyPath(ring, 45);
    const elev = dense.map(([lat, lng]) => syntheticElevation(lat, lng));
    return buildResult(dense, elev, 'offline', [start]);
  }
}

/**
 * 사용할 provider 우선순위.
 * ORS 키가 있으면 ORS(경로+고도 한 번에), 없으면 키가 필요 없는 OSRM 도보 경로를 쓴다.
 * 어느 쪽이든 **실제 사람이 다닐 수 있는 길**을 따라간다. 데모(직선)는 둘 다 실패할 때만.
 */
export function makeProvider(orsKey: string | null): RoutingProvider {
  return orsKey ? new OrsProvider(orsKey) : new OsrmProvider();
}

/** 실패 시 다음으로 시도할 provider (없으면 null) */
export function fallbackProvider(current: RoutingProvider): RoutingProvider | null {
  if (current.id === 'ors') return new OsrmProvider();
  if (current.id === 'osrm') return new OfflineProvider();
  return null;
}
