// ---------------------------------------------------------------------------
// 코스 빌더 — 후보 경로 생성 → 스타일/거리 점수화 → 최적 랭킹
//
// "AI가 최적 코스를 추천" 을 결정론적·설명가능한 방식으로 구현한다:
//   여러 후보 경로를 만들고, 각 후보의 고도 프로파일을 사용자가 원한 스타일
//   (평지/완만/굴곡/경사)과 거리에 맞춰 채점해 가장 잘 맞는 것을 고른다.
// 후보들은 서로 독립이므로 병렬로 생성한다.
// ---------------------------------------------------------------------------

import { nearestNeighborOrder } from './geo';
import {
  RoutingError,
  type RouteResult,
  type RoutingProvider,
} from './routing';
import { evaluateStyle, type RunStyle, type StyleEval } from './routeStyle';
import type { LatLng } from './types';

export interface BuiltRoute {
  route: RouteResult;
  styleEval: StyleEval;
  /** 목표 거리 대비 근접도 0~1 (핀 모드는 1) */
  distanceScore: number;
  /** 종합 매칭 점수 0~100 */
  matchScore: number;
  label: string;
}

function distanceScore(distanceKm: number, targetKm: number | null): number {
  if (targetKm == null) return 1;
  const tol = Math.max(0.6, targetKm * 0.2);
  return Math.max(0, 1 - Math.abs(distanceKm - targetKm) / tol);
}

function toBuilt(
  route: RouteResult,
  style: RunStyle,
  targetKm: number | null,
  label: string,
): BuiltRoute {
  const styleEval = evaluateStyle(route, style);
  const dScore = distanceScore(route.distanceKm, targetKm);
  const matchScore =
    targetKm == null
      ? Math.round(styleEval.score * 100)
      : Math.round((0.7 * styleEval.score + 0.3 * dScore) * 100);
  return { route, styleEval, distanceScore: dScore, matchScore, label };
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
): Promise<BuiltRoute[]> {
  const settled = await Promise.allSettled(jobs);
  const built: BuiltRoute[] = [];
  let lastErr: unknown = null;
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') built.push(toBuilt(s.value, style, targetKm, labels[i]));
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

  const orders: { pts: LatLng[]; label: string }[] = [
    { pts: waypoints, label: '찍은 순서' },
  ];
  if (waypoints.length >= 3) {
    orders.push({ pts: nearestNeighborOrder(waypoints), label: '최단 연결' });
  }
  const close = (pts: LatLng[]) => (opts.loop ? [...pts, pts[0]] : pts);

  const built = await settleBuilt(
    orders.map((o) => provider.route(close(o.pts))),
    style,
    null,
    orders.map((o) => o.label),
  );
  return dedupe(built).sort((a, b) => b.matchScore - a.matchScore);
}

export interface DistanceBuildOptions {
  /** '다시 찾기' 때마다 올려서 새로운 루프 후보를 얻는 시드 오프셋 */
  seedBase?: number;
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
  // 굴곡/경사 스타일은 경유 지점을 늘려 더 다양한 기복을 유도
  const points = style === 'rolling' || style === 'hilly' ? 6 : 4;
  const base = (opts.seedBase ?? 0) * 101; // 시도마다 겹치지 않는 시드 대역
  const seeds = [11, 42, 73, 128].map((s) => s + base);

  const built = await settleBuilt(
    seeds.map((seed) => provider.roundTrip(start, targetKm, { points, seed })),
    style,
    targetKm,
    seeds.map((_, i) => `코스 ${i + 1}`),
  );
  return dedupe(built)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 3);
}
