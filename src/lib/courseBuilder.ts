// ---------------------------------------------------------------------------
// 코스 빌더 — 후보 경로 생성 → 스타일/거리 점수화 → 최적 랭킹
//
// "AI가 최적 코스를 추천" 을 결정론적·설명가능한 방식으로 구현한다:
//   여러 후보 경로를 만들고, 각 후보의 고도 프로파일을 사용자가 원한 스타일
//   (평지/완만/굴곡/경사)과 거리에 맞춰 채점해 가장 잘 맞는 것을 고른다.
// 후보들은 서로 독립이므로 병렬로 생성한다.
// ---------------------------------------------------------------------------

import { destinationPoint, haversineMeters, nearestNeighborOrder } from './geo';
import { RoutingError, type RouteResult, type RoutingProvider } from './routing';
import {
  evaluateStyle,
  type RunStyle,
  type StyleEval,
  evaluatePath,
  type PathEval,
  type PathPrefs,
  type PathPref,
} from './routeStyle';
import type { LatLng } from './types';

export interface BuiltRoute {
  route: RouteResult;
  styleEval: StyleEval;
  /** 길 성격 평가 — 취향이 '상관없음'이거나 정보가 없으면 score 가 null */
  pathEval: PathEval;
  /** 목표 거리 대비 근접도 0~1 (핀 모드는 1) */
  distanceScore: number;
  /** 종합 매칭 점수 0~100 — 잴 수 있는 기준이 하나도 없으면 null */
  matchScore: number | null;
  label: string;
  /** 숲길 비율(%) — 아직 없으면 undefined */
  greenPct?: number;
  /** 가중합 / 가중치 (여름 그늘 재채점용). 수역 감점 전 값 */
  _rawSum: number;
  _rawW: number;
  _suspectGap: boolean;
}

function distanceScore(distanceKm: number, targetKm: number | null): number {
  if (targetKm == null) return 1;
  const tol = Math.max(0.6, targetKm * 0.2);
  return Math.max(0, 1 - Math.abs(distanceKm - targetKm) / tol);
}

/**
 * 인접 좌표 사이 최대 간격(m). 정상 경로는 도로망을 따라 점이 촘촘하고,
 * 다리 위 직선 구간도 서울에서는 한 구간 500m 대가 최대다(동작대교 실측 522m).
 * 그 이상 점프하는 구간은 강 위에 잘못 그려진 OSM 길(수역 위 자전거도로 등)을
 * 탔을 가능성이 높다 — 실측: 여의도 북서쪽 수역에서 659m 직선.
 */
function maxAdjacentGapM(coords: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    m = Math.max(m, haversineMeters(coords[i - 1], coords[i]));
  }
  return m;
}

const SUSPECT_GAP_M = 600;

function toBuilt(
  route: RouteResult,
  style: RunStyle,
  targetKm: number | null,
  label: string,
  pathPref: PathPref | PathPrefs = 'any',
): BuiltRoute {
  const styleEval = evaluateStyle(route, style);
  const pathEval = evaluatePath(route, pathPref);
  const dScore = distanceScore(route.distanceKm, targetKm);

  // 축별 가중치. 길 성격은 정보가 있을 때만 끼워 넣고, 없으면 나머지 축의
  // 비중을 그대로 키운다 — 모르는 축을 0점으로 두면 OSRM 폴백 경로가
  // 이유 없이 밀린다.
  const parts: { w: number; v: number }[] = [];
  // 경사 취향은 고도를 실제로 받았을 때만 센다 — 못 받은 경로를 평지로 쳐서
  // '평지 위주' 만점을 주면, 조회가 실패한 후보가 부당하게 1위가 된다.
  if (styleEval.score != null) parts.push({ w: 0.7, v: styleEval.score });
  if (targetKm != null) parts.push({ w: 0.3, v: dScore });
  // 길 취향은 경사 취향과 같은 무게로 둔다. 둘 다 사용자가 직접 고른 축이고,
  // 한쪽만 세게 주면 '신호등 적은 길'을 골라도 순위가 안 움직이거나(0.5) 반대로
  // 경사 취향이 완전히 무시된다(0.9). 실측으로 0.7 이 두 축이 다 살아 있는 값이다.
  //
  // 여러 항목을 골랐으면 각각을 독립된 축으로 싣는다 — 평균 하나로 합치면
  // 서울처럼 흙길이 드문 곳에서 '흙길' 축(전원 0 근처)이 '신호등' 축의
  // 변별력을 반토막 내, 대로변이 1위로 올라오는 역전이 났다(베타 피드백).
  for (const e of pathEval.each) parts.push({ w: 0.7, v: e.score });
  const rawW = parts.reduce((t, p) => t + p.w, 0);
  const rawSum = parts.reduce((t, p) => t + p.w * p.v, 0);
  // 잴 수 있는 축이 하나도 없을 수 있다 — 핀 모드(거리 목표 없음) + OSRM
  // 폴백(waytype 없음) + 고도 조회 실패가 겹치면 세 축이 전부 null 이다.
  // 그대로 0/0 을 계산하면 카드에 'NaN%' 가 뜬다(실측). 모르면 숫자를
  // 지어내지 말고 모른다고 한다 — 다른 '모름' 처리와 같은 규칙.
  let matchScore: number | null = rawW > 0 ? Math.round((rawSum / rawW) * 100) : null;

  // 수역 위 의심 구간이 있는 후보는 순위를 크게 내린다.
  // 확신이 아니라 의심이므로 배제하진 않는다 — 깨끗한 후보가 있으면 그쪽이 이긴다.
  const suspectGap = maxAdjacentGapM(route.coords) > SUSPECT_GAP_M;
  if (suspectGap && matchScore != null) {
    matchScore = Math.round(matchScore * 0.45);
  }
  return {
    route, styleEval, pathEval, distanceScore: dScore, matchScore, label,
    _rawSum: rawSum, _rawW: rawW, _suspectGap: suspectGap,
  };
}

/**
 * 후보 정렬. 매칭 점수가 같으면 목표 거리에 더 가까운 쪽을 앞에 둔다.
 * 점수는 정수로 반올림돼 있어 동점이 자주 나는데, 그때 순서가 사실상
 * 무작위였다 — 실측에서 15km 요청에 15.0km 후보를 두고 15.6km 가 1위로
 * 올라오는 일이 있었다. 사용자가 고른 거리는 지켜주는 편이 낫다.
 */
function byMatchThenDistance(a: BuiltRoute, b: BuiltRoute): number {
  // 점수를 못 매긴 후보(잴 축이 하나도 없음)는 뒤로 민다. 셋 다 못 매겼으면
  // 순서를 흔들지 않고 거리 근접도로만 가른다.
  const am = a.matchScore;
  const bm = b.matchScore;
  if (am == null || bm == null) {
    if (am != null) return -1;
    if (bm != null) return 1;
    return b.distanceScore - a.distanceScore;
  }
  if (bm !== am) return bm - am;
  return b.distanceScore - a.distanceScore;
}

/** 중복(거의 같은 거리/상승) 후보 제거 */
function dedupe(routes: BuiltRoute[]): BuiltRoute[] {
  const seen: BuiltRoute[] = [];
  for (const r of routes) {
    const dup = seen.some(
      (s) =>
        Math.abs(s.route.distanceKm - r.route.distanceKm) < 0.15 &&
        Math.abs(s.route.ascentM - r.route.ascentM) < 8,
    );
    if (!dup) seen.push(r);
  }
  return seen;
}

/** 병렬 생성 공통부: 성공한 후보만 모으고, 전부 실패하면 마지막 오류를 던진다 */
async function settleBuilt(
  jobs: Promise<RouteResult>[],
  style: RunStyle,
  targetKm: number | null,
  labels: string[],
  pathPref: PathPref | PathPrefs = 'any',
): Promise<BuiltRoute[]> {
  const settled = await Promise.allSettled(jobs);
  const built: BuiltRoute[] = [];
  let lastErr: unknown = null;
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled')
      built.push(toBuilt(s.value, style, targetKm, labels[i], pathPref));
    else lastErr = s.reason;
  });
  if (built.length === 0) {
    throw lastErr ?? new RoutingError('no_route', '경로 생성 실패');
  }
  return built;
}

export interface PinBuildOptions {
  /** 마지막에 시작점으로 되돌아오는 순환 코스로 만들지 */
  loop?: boolean;
  /** 길 성격 취향 (신호등 적은 길 등) */
  pathPref?: PathPref | PathPrefs;
}

/**
 * 핀(경유지) + 스타일 → 최적 코스 후보들.
 * 경유지 순서를 (입력 순서 / 최근접이웃 순서)로 바꿔 후보를 만들고 채점한다.
 * 순서 최적화는 항상 '열린' 경로 기준으로 하고, 순환은 그 뒤에 시작점을 붙여 닫는다
 * — 닫힌 경로에 최근접이웃을 돌리면 중복된 시작점 때문에 순서가 망가진다.
 */
export async function buildFromPins(
  waypoints: LatLng[],
  style: RunStyle,
  provider: RoutingProvider,
  opts: PinBuildOptions = {},
): Promise<BuiltRoute[]> {
  if (waypoints.length < 2) {
    throw new RoutingError('no_route', '핀을 2개 이상 찍어주세요.');
  }

  const orders: { pts: LatLng[]; label: string }[] = [{ pts: waypoints, label: '찍은 순서' }];
  if (waypoints.length >= 3) {
    orders.push({ pts: nearestNeighborOrder(waypoints), label: '최단 연결' });
  }
  const close = (pts: LatLng[]) => (opts.loop ? [...pts, pts[0]] : pts);

  const built = await settleBuilt(
    orders.map((o) => provider.route(close(o.pts))),
    style,
    null,
    orders.map((o) => o.label),
    opts.pathPref,
  );
  return dedupe(built).sort(byMatchThenDistance);
}

export interface DistanceBuildOptions {
  /** '다시 찾기' 때마다 올려서 새로운 후보를 얻는 시드 오프셋 */
  seedBase?: number;
  /** true 면 시작점으로 돌아오지 않는 편도 코스 */
  oneWay?: boolean;
  /** 길 성격 취향 (신호등 적은 길 등) */
  pathPref?: PathPref | PathPrefs;
}

const DIRECTION_NAMES = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

function directionLabel(bearingDeg: number): string {
  const idx = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return `${DIRECTION_NAMES[idx]}쪽 방면`;
}

/**
 * 시작점에서 한 방향으로 뻗는 편도 코스.
 * 직선거리 목표 × 축소계수로 끝점을 잡아 실제 도로로 잇고,
 * 실측 거리로 끝점 거리를 보정해 목표에 수렴시킨다(왕복과 같은 감쇠 보정).
 */
async function oneWayFromStart(
  provider: RoutingProvider,
  start: LatLng,
  targetKm: number,
  bearingDeg: number,
): Promise<RouteResult> {
  let scale = 0.8; // 도로는 직선보다 길게 감기므로 처음부터 줄여 잡는다
  let best: RouteResult | null = null;
  let bestErr = Infinity;

  for (let attempt = 0; attempt < 3; attempt++) {
    const d = targetKm * 1000 * scale;
    // 중간점을 살짝 비껴 놓아 큰길만 따라가는 단조로운 직선을 피한다
    const mid = destinationPoint(start, bearingDeg + 18, d * 0.48);
    const end = destinationPoint(start, bearingDeg, d);
    const r = await provider.route([start, mid, end]);
    const err = Math.abs(r.distanceKm - targetKm);
    if (err < bestErr) {
      bestErr = err;
      best = r;
    }
    if (err / targetKm < 0.1 || r.distanceKm <= 0) break;
    const raw = targetKm / r.distanceKm;
    scale *= Math.max(0.6, Math.min(1.4, 1 + (raw - 1) * 0.75));
  }

  if (!best) throw new RoutingError('no_route', '편도 코스를 만들지 못했어요.');
  return best;
}

/**
 * 시작점 + 목표 거리 + 스타일 → 왕복(루프) 코스 후보들.
 * 시드를 바꿔 여러 루프를 병렬 생성하고 스타일·거리로 채점한다.
 */
export async function buildFromDistance(
  start: LatLng,
  targetKm: number,
  style: RunStyle,
  provider: RoutingProvider,
  opts: DistanceBuildOptions = {},
): Promise<BuiltRoute[]> {
  if (opts.oneWay) {
    // 편도: 서로 다른 네 방향으로 후보를 만들고, '다시 찾기'마다 방향을 회전
    const base = ((opts.seedBase ?? 0) * 53) % 360;
    const bearings = [0, 90, 180, 270].map((b) => (base + b) % 360);
    const built = await settleBuilt(
      bearings.map((b) => oneWayFromStart(provider, start, targetKm, b)),
      style,
      targetKm,
      bearings.map(directionLabel),
      opts.pathPref,
    );
    return dedupe(built).sort(byMatchThenDistance).slice(0, 3);
  }

  // 후보 풀은 스타일과 무관하게 같은 것을 쓴다.
  //
  // 예전엔 언덕·굴곡 스타일만 꼭짓점을 6개로 늘려, 스타일마다 아예 다른 4개를
  // 보고 골랐다. 그래서 순위가 뒤집히는 일이 실제로 났다 — 남산 5km 에서
  // '언덕 훈련'은 km당 상승 8m 짜리 평지를 1위로, '완만한 언덕'은 km당 43m
  // 최대경사 35% 짜리를 1위로 골랐다(실측). 사용자가 고른 축과 정반대다.
  //
  // 꼭짓점 수를 후보마다 섞어 한 풀 안에 완만한 것과 굴곡진 것이 같이 있게
  // 한다. 요청 수는 예전과 같은 4개라 무료 한도에도 영향이 없다.
  const base = (opts.seedBase ?? 0) * 101; // 시도마다 겹치지 않는 시드 대역
  const plan = [
    { seed: 11, points: 4 }, //  넓게 도는 단순한 고리
    { seed: 42, points: 4 },
    { seed: 73, points: 6 }, //  더 꺾여 기복이 생기기 쉬운 고리
    { seed: 128, points: 6 },
  ];

  const built = await settleBuilt(
    plan.map(({ seed, points }) =>
      provider.roundTrip(start, targetKm, { points, seed: seed + base }),
    ),
    style,
    targetKm,
    plan.map((_, i) => `코스 ${i + 1}`),
    opts.pathPref,
  );
  return dedupe(built).sort(byMatchThenDistance).slice(0, 3);
}

// --- 여름 그늘 재채점 -------------------------------------------------------
//
// Overpass 녹지 데이터(OSM 공원·숲 폴리곤)는 경로 생성보다 느려 결과가 뒤에
// 온다. 여름(6~8월)에는 이 값을 순위에 반영한다 — 같은 5km 라도 한강공원
// 안 코스와 대로변 코스는 체감이 완전히 다르기 때문이다.
//
// 데이터가 안 오면(Overpass 실패·타임아웃) 이 축을 빼고 원래 점수를 그대로
// 쓴다 — 모르는 값으로 채점하면 거짓말이 된다.

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 6~8월이면 true */
export function isSummerSeason(): boolean {
  const m = new Date().getMonth();
  return m >= 5 && m <= 7;
}

/**
 * 녹지 비율(greenPct)을 기존 점수에 합산해 재정렬한다.
 * 여름이 아니면 greenPct 만 기록하고 순위는 건드리지 않는다.
 *
 * 가중치 0.3 — 경사 스타일(0.7)·길 취향(0.7) 보다 낮다. 그늘이 중요하긴 해도
 * 사용자가 '언덕 훈련' 을 골랐는데 평지-공원 코스가 1위로 올라오면 안 된다.
 * 실측: 여의도 5km 에서 숲길 31% 후보가 0% 후보를 3~5점 앞서는 정도다.
 */
export function rescoreWithGreen(
  routes: BuiltRoute[],
  greenPcts: (number | null)[],
): BuiltRoute[] {
  const summer = isSummerSeason();
  const scored = routes.map((r, i) => {
    const gp = greenPcts[i];
    if (gp == null || !summer) return { ...r, greenPct: gp ?? undefined };

    const greenScore = clamp01(gp / 50);
    const newSum = r._rawSum + 0.3 * greenScore;
    const newW = r._rawW + 0.3;
    let matchScore = Math.round((newSum / newW) * 100);
    if (r._suspectGap) matchScore = Math.round(matchScore * 0.45);
    return { ...r, greenPct: gp, matchScore, _rawSum: newSum, _rawW: newW };
  });
  if (summer) scored.sort(byMatchThenDistance);
  return scored;
}
