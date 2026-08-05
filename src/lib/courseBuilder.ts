// ---------------------------------------------------------------------------
// 코스 빌더 — 후보 경로 생성 → 스타일/거리 점수화 → 최적 랭킹
//
// "AI가 최적 코스를 추천" 을 결정론적·설명가능한 방식으로 구현한다:
//   여러 후보 경로를 만들고, 각 후보의 고도 프로파일을 사용자가 원한 스타일
//   (평지/완만/굴곡/경사)과 거리에 맞춰 채점해 가장 잘 맞는 것을 고른다.
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

/**
 * 핀(경유지) + 스타일 → 최적 코스 후보들.
 * 경유지 순서를 (입력 순서 / 최근접이웃 최적화 순서)로 바꿔 후보를 만들고 채점한다.
 */
export async function buildFromPins(
  waypoints: LatLng[],
  style: RunStyle,
  provider: RoutingProvider,
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

  const built: BuiltRoute[] = [];
  let lastErr: unknown = null;
  for (const o of orders) {
    try {
      const route = await provider.route(o.pts);
      built.push(toBuilt(route, style, null, o.label));
    } catch (e) {
      lastErr = e;
    }
  }
  if (built.length === 0) throw lastErr ?? new RoutingError('no_route', '경로 생성 실패');

  return dedupe(built).sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * 시작점 + 목표 거리 + 스타일 → 왕복(루프) 코스 후보들.
 * 시드를 바꿔 여러 루프를 생성하고 스타일·거리로 채점한다.
 */
export async function buildFromDistance(
  start: LatLng,
  targetKm: number,
  style: RunStyle,
  provider: RoutingProvider,
): Promise<BuiltRoute[]> {
  // 굴곡/경사 스타일은 경유 지점을 늘려 더 다양한 기복을 유도
  const points = style === 'rolling' || style === 'hilly' ? 6 : 4;
  const seeds = [11, 42, 73, 128];

  const built: BuiltRoute[] = [];
  let lastErr: unknown = null;
  for (let i = 0; i < seeds.length; i++) {
    try {
      const route = await provider.roundTrip(start, targetKm, {
        points,
        seed: seeds[i],
      });
      built.push(toBuilt(route, style, targetKm, `코스 ${i + 1}`));
    } catch (e) {
      lastErr = e;
    }
  }
  if (built.length === 0) throw lastErr ?? new RoutingError('no_route', '경로 생성 실패');

  return dedupe(built)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 3);
}
