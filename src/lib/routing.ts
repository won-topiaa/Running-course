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
import {
  densifyPath,
  destinationPoint,
  haversineMeters,
  pathLengthMeters,
  spurKeptIndices,
  thinWaypoints,
} from './geo';

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
// 한 요청에 실어 보낼 수 있는 경유지 상한. 넘기면 요청 전체가 거절된다.
// ORS 무료 플랜은 50개, 공개 OSRM 은 넉넉하지만 URL 길이가 있어 100개로 둔다.
const ORS_MAX_WAYPOINTS = 50;
const OSRM_MAX_WAYPOINTS = 100;

// ── ORS 분당 한도 냉각 ────────────────────────────────────────────────────
// ORS 무료 키는 일일 한도(2000)와 별개로 '분당 40회' 제한이 있다.
// 추천받기 한 번에 링 보정까지 최대 9회를 부르므로, 연달아 몇 번 누르면
// 429 가 난다. 문제는 429 가 난 뒤에도 다음 누름이 최대 9회를 또 때려
// 한도가 영영 회복되지 않는 것 — 429 를 한 번 맞으면 이 시간 동안 ORS 를
// 아예 건너뛰고(즉시 rate_limit) OSRM 폴백으로 직행하게 한다.
// 창이 지나면 조용히 원래대로 돌아온다.
const ORS_COOLDOWN_MS = 65_000;
let orsBlockedUntil = 0;

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
  /**
   * 고도가 '실제로 조회된 값'인지. false 면 지형 고도를 못 받아 평평하게
   * 둔 상태다 — 상승·경사를 숫자로 내놓으면 안 되고, 스타일 점수도 이 축을
   * 빼고 매겨야 한다. 없으면(=undefined) 실제 값으로 본다.
   */
  elevationKnown?: boolean;
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
/**
 * 고도 잡음 문턱(m). 이보다 작은 오르내림은 세지 않는다.
 * 워치·러닝앱이 공통으로 쓰는 방식이다 — 없으면 평지를 뛰어도 측정 오차가
 * 전부 '상승'으로 쌓인다(잔떨림의 양수 쪽만 더해지므로 항상 부풀려진다).
 */
const ELEV_NOISE_M = 3;

/**
 * 누적 상승·하강.
 *
 * 두 겹으로 거른다.
 *  1) 구간 길이로 물리적으로 불가능한 고도차를 잘라낸다. 휴대폰 GPS 고도는
 *     ±수십 m 씩 튀는데 그대로 더하면 0.39km 를 뛰고 '총 오르막 144m'
 *     같은 숫자가 나온다 — 실측 기록에 그대로 찍혔다. 같은 화면의 '최대 경사'는
 *     이미 35% 로 잘라 쓰고 있어서 두 숫자가 서로 모순이었다.
 *  2) 문턱 미만의 잔떨림은 무시한다.
 */
function climbProfile(
  elev: number[],
  segments: RouteSegment[],
): { profile: number[]; ascent: number; descent: number } {
  if (elev.length < 2) return { profile: elev.slice(), ascent: 0, descent: 0 };
  const profile: number[] = [elev[0]];
  for (let i = 1; i < elev.length; i++) {
    const segLen = segments[i - 1]?.lengthM ?? 0;
    const maxDz = Math.max(1, (MAX_REAL_GRADE / 100) * segLen);
    const dz = Math.max(-maxDz, Math.min(maxDz, elev[i] - elev[i - 1]));
    profile.push(profile[i - 1] + dz);
  }
  let ascent = 0;
  let descent = 0;
  let ref = profile[0];
  for (let i = 1; i < profile.length; i++) {
    const d = profile[i] - ref;
    if (d >= ELEV_NOISE_M) {
      ascent += d;
      ref = profile[i];
    } else if (d <= -ELEV_NOISE_M) {
      descent += -d;
      ref = profile[i];
    }
  }
  return { profile, ascent, descent };
}

export function buildResult(
  rawCoords: LatLng[],
  rawElevIn: number[],
  source: RouteResult['source'],
  waypoints: LatLng[],
  opts: { trimSpurs?: boolean } = {},
): RouteResult {
  // 라우터가 만든 경로에만 켠다. GPS 로 기록한 실제 달리기는 그대로 둬야 한다 —
  // 막다른 길에 들어갔다 나온 게 사실이면 그건 잘라낼 오류가 아니라 기록이다.
  const kept = opts.trimSpurs ? spurKeptIndices(rawCoords, { protect: waypoints }) : null;
  const trimmed = kept !== null && kept.length < rawCoords.length;
  const coords = trimmed ? kept!.map((i) => rawCoords[i]) : rawCoords;
  const rawElev = trimmed ? kept!.map((i) => rawElevIn[i]) : rawElevIn;
  // 고도 배열을 좌표 수에 정확히 맞춘다. 고도는 별도 API 에서 오므로 배열이
  // 짧거나 구멍(NaN·undefined)이 있을 수 있는데, 그대로 빼기 연산에 들어가면
  // NaN 이 상승·최대경사를 타고 화면까지 올라간다 — 실측에서 카드에
  // '최대 NaN%', '고도 NaN~NaNm' 가 그대로 찍혔다. 구멍은 이웃 값으로 메운다.
  const norm: number[] = new Array(coords.length);
  for (let i = 0; i < coords.length; i++) {
    const v = rawElev[i];
    norm[i] = typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  }
  for (let i = 1; i < norm.length; i++) if (Number.isNaN(norm[i])) norm[i] = norm[i - 1];
  for (let i = norm.length - 2; i >= 0; i--) if (Number.isNaN(norm[i])) norm[i] = norm[i + 1];
  // 전부 구멍이면(고도를 아예 못 받음) 0 평지로 — 경사 없음으로 그려진다
  const smoothed = smooth(norm.map((v) => (Number.isNaN(v) ? 0 : v)));
  let distance = 0;
  const segments: RouteSegment[] = [];

  for (let i = 1; i < coords.length; i++) {
    const segLen = haversineMeters(coords[i - 1], coords[i]);
    distance += segLen;
    segments.push({ gradePct: 0, lengthM: segLen }); // 경사는 아래에서 창(window)으로 채운다
  }

  // 고도 프로파일도 잘라낸 쪽을 쓴다 — 차트·상승·최대경사가 서로 어긋나면
  // 어느 숫자를 믿어야 할지 알 수 없다.
  const { profile: elevations, ascent, descent } = climbProfile(smoothed, segments);

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
  const result = buildResult(coords, elevations, source, waypoints, { trimSpurs: true });
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
      coordinates: thinWaypoints(waypoints, ORS_MAX_WAYPOINTS).map(([lat, lng]) => [lng, lat]),
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
    const result = buildResult(best.coords, best.elevations ?? [], 'ors', [start], {
      trimSpurs: true,
    });
    return best.way ? { ...result, way: best.way } : result;
  }

  /** 실제 fetch 후 GeoJSON 반환 (에러는 RoutingError 로 정규화) */
  private async rawPost(body: Record<string, unknown>): Promise<any> {
    // 링 꼭짓점은 '이 근처를 돌자'는 힌트일 뿐인데, ORS 기본 스냅 반경이 350m 라
    // 한강 위에 떨어진 점은 도로를 못 찾고 404(code 2010)로 요청 전체가 죽는다.
    // 실측: 여의도·강남 루프 요청의 25% 가 이걸로 실패했다. 반경을 넉넉히 주면
    // 가까운 실제 도로로 붙고, 목표 거리는 어차피 뒤에서 보정한다.
    const coords = (body.coordinates as number[][] | undefined) ?? [];
    if (Date.now() < orsBlockedUntil) {
      throw new RoutingError('rate_limit', '무료 요청 한도를 초과했습니다.');
    }
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
      orsBlockedUntil = Date.now() + ORS_COOLDOWN_MS;
      throw new RoutingError('rate_limit', '무료 요청 한도를 초과했습니다.');
    }
    if (!res.ok) {
      throw new RoutingError('unknown', `OpenRouteService 요청 실패 (${res.status})`);
    }
    return res.json();
  }
}

// --- 왕복 루프 공통 전략 ------------------------------------------------------

export interface Geometry {
  coords: LatLng[];
  elevations?: number[];
  /** ORS 만 채운다 — 보정 시도마다 다른 경로가 나오므로 채택된 시도의 것을 써야 한다 */
  way?: WayMix;
}

/**
 * 고리 정점이 막다른 길에 스냅돼 생긴 돌기를 걷어낸다.
 *
 * 반지름 보정 '전에' 걷어내야 한다. 나중에(buildResult 에서) 걷어내면 보정은
 * 돌기까지 포함한 길이로 목표를 맞춰 놓고 그 뒤에 돌기가 빠지므로, 5km 를
 * 요청해도 최종 거리가 그만큼 짧아진다.
 */
function trimGeometrySpurs(geom: Geometry, start: LatLng): Geometry {
  const kept = spurKeptIndices(geom.coords, { protect: [start] });
  if (kept.length === geom.coords.length) return geom;
  return {
    ...geom,
    coords: kept.map((i) => geom.coords[i]),
    elevations: geom.elevations ? kept.map((i) => geom.elevations![i]) : geom.elevations,
  };
}

/**
 * 목표 거리에 맞춘 왕복 루프를 '실제 도로'로 만든다.
 *
 * 시작점 주변에 고리 모양 경유지를 만들어 provider 의 도보 라우팅으로 잇고,
 * 나온 경로의 실측 거리로 고리 반지름을 보정해 목표에 수렴시킨다(최대 3회).
 * 라우팅 엔진의 자체 왕복 기능보다 거리 정확도가 훨씬 좋다.
 */
export async function ringRoundTrip(
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
    const geom = trimGeometrySpurs(await geomFn(ring), start);
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
    const coordStr = thinWaypoints(waypoints, OSRM_MAX_WAYPOINTS)
      .map(([lat, lng]) => `${lng},${lat}`)
      .join(';');
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

  /**
   * 좌표열에 실제 지형 고도를 입힌 RouteResult.
   *
   * 조회에 실패하면 예전엔 합성 고도(데모용 사인파)를 대신 넣었다. 그런데
   * 그건 실제 지형과 아무 상관이 없어서, 상승 20m 인 코스가 368m 로 뜨거나
   * 북한산 입구(실제 751m)가 42m 로 뜨는 일이 실제로 있었다 — 게다가
   * 스타일 점수까지 그 가짜 값으로 매겨져 '언덕 훈련'이 평지를 골랐다.
   * 지어낸 숫자를 진짜처럼 보여주느니 '모른다'고 하는 편이 낫다.
   */
  private async withElevation(coords: LatLng[], waypoints: LatLng[]): Promise<RouteResult> {
    try {
      const elev = await elevationsForPath(coords);
      return buildResult(coords, elev, 'osrm', waypoints, { trimSpurs: true });
    } catch {
      const flat = buildResult(
        coords,
        coords.map(() => 0),
        'osrm',
        waypoints,
        { trimSpurs: true },
      );
      return { ...flat, elevationKnown: false };
    }
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
    // 사인파로 지어낸 값이다 — 잰 값인 척하면 안 된다. 이 표시가 있어야
    // 화면·공유·GPX 가 고도를 '—' 로 비운다.
    return { ...buildResult(dense, elev, 'offline', waypoints), elevationKnown: false };
  }

  async roundTrip(start: LatLng, targetKm: number, opts: RouteOptions = {}): Promise<RouteResult> {
    const ring = generateLoop(start, targetKm, opts.points ?? 5, opts.seed ?? 0);
    const dense = densifyPath(ring, 45);
    const elev = dense.map(([lat, lng]) => syntheticElevation(lat, lng));
    return { ...buildResult(dense, elev, 'offline', [start]), elevationKnown: false };
  }
}

/**
 * 사용할 provider 우선순위.
 * ORS 키가 있으면 ORS(경로+고도 한 번에), 없으면 키가 필요 없는 OSRM 도보 경로를 쓴다.
 * 어느 쪽이든 **실제 사람이 다닐 수 있는 길**을 따라간다. 데모(직선)는 둘 다 실패할 때만.
 */
export function makeProvider(orsKey: string | null): RoutingProvider {
  // 기기가 '네트워크 없음'이라고 확실히 말하면 두 서버를 타임아웃까지 기다리지
  // 않는다. 실측: 연결이 안 되는 환경에서 ORS(8초)와 OSRM(12초)을 차례로
  // 기다리느라 결과가 나오기까지 20.6초가 걸렸고, 그동안 화면에는 스피너뿐이었다
  // (지하철·통신 음영에서 실제로 겪는 상황이다).
  // navigator.onLine 은 'false 면 확실히 오프라인'만 믿을 수 있는 신호라
  // 빠른 길로 새는 용도로만 쓴다 — true 라고 연결을 보장하지는 않는다.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new OfflineProvider();
  }
  return orsKey ? new OrsProvider(orsKey) : new OsrmProvider();
}

/** 실패 시 다음으로 시도할 provider (없으면 null) */
export function fallbackProvider(current: RoutingProvider): RoutingProvider | null {
  if (current.id === 'ors') return new OsrmProvider();
  if (current.id === 'osrm') return new OfflineProvider();
  return null;
}
