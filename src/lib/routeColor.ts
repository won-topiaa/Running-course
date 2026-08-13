// 경로를 경사 밴드별로 묶어 색상 폴리라인 그룹으로 변환 (Leaflet·카카오 공용)
import { retracedSegmentMask, separateRetraced } from './geo';
import type { RouteResult } from './routing';
import { gradeBand, GRADE_COLORS } from './routeStyle';
import type { LatLng } from './types';

export interface ColorGroup {
  positions: LatLng[];
  color: string;
}

/** 겹치는 구간을 좌우로 벌리는 양(m). 확대해야 보이고 축소하면 한 선으로 합쳐진다. */
const RETRACE_OFFSET_M = 7;

export interface RetraceInfo {
  /** 같은 길을 두 번 지나는 구간이 있는가 */
  has: boolean;
  /** 그런 구간의 길이 합(km). 갔다 오는 두 몫을 모두 더한 값이다. */
  km: number;
}

interface Prepared {
  coords: LatLng[]; // 그리기용 좌표 (겹치는 구간은 좌우로 벌어져 있다)
  retrace: RetraceInfo;
}

// 같은 RouteResult 로 여러 번 그릴 때 겹침 계산을 되풀이하지 않는다.
const cache = new WeakMap<RouteResult, Prepared>();

function prepare(route: RouteResult): Prepared {
  const hit = cache.get(route);
  if (hit) return hit;
  const mask = retracedSegmentMask(route.coords);
  let meters = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) meters += route.segments[i]?.lengthM ?? 0;
  }
  const prepared: Prepared = {
    coords: separateRetraced(route.coords, mask, RETRACE_OFFSET_M),
    retrace: { has: mask.some(Boolean), km: meters / 1000 },
  };
  cache.set(route, prepared);
  return prepared;
}

/**
 * 그리기용 좌표. 겹치는 구간이 좌우로 벌어져 있다.
 * 색상 선 밑에 까는 흰 테두리도 이 좌표를 써야 두 선이 나란히 보인다 —
 * 원본 좌표로 테두리를 깔면 벌어진 두 선 밑에 한 줄이 지나가 지저분해진다.
 */
export function displayCoords(route: RouteResult | null): LatLng[] {
  if (!route || route.coords.length < 2) return route?.coords ?? [];
  return prepare(route).coords;
}

/** 같은 길을 두 번 지나는 구간이 얼마나 되는지 (범례 문구용) */
export function retraceInfo(route: RouteResult | null): RetraceInfo {
  if (!route || route.coords.length < 2) return { has: false, km: 0 };
  return prepare(route).retrace;
}

export function coloredSegments(route: RouteResult | null): ColorGroup[] {
  if (!route || route.coords.length < 2) return [];
  return groupsUpTo(route, route.segments.length);
}

/**
 * 러닝 화면용: 계획 경로의 앞쪽 endSeg 개 구간만 경사 색으로.
 *
 * 지나온 구간을 그릴 때 경로를 idx 에서 잘라 새 객체로 만들면 두 가지가
 * 깨진다 — 매 틱 새 객체라 겹침 계산 캐시가 빗나가 초당 한 번씩 전부 다시
 * 돌고, 접두사만 보면 반환점 이후에야 겹침이 '생겨나' 지나온 선은 벌어지는데
 * 남은 점선은 원본 좌표라 러너 발밑에서 선이 7m 꺾인다. 전체 경로(안정된
 * 객체) 기준으로 한 번만 계산하고 앞부분을 잘라 쓰면 둘 다 사라진다.
 * 남은 구간은 displayCoords(route).slice(idx) 로 잘라 같은 기하에 얹는다.
 */
export function coloredSegmentsUpTo(route: RouteResult | null, endSeg: number): ColorGroup[] {
  if (!route || route.coords.length < 2 || endSeg <= 0) return [];
  return groupsUpTo(route, Math.min(endSeg, route.segments.length));
}

// 갔다 오는 구간은 선이 정확히 겹쳐 나중 선이 앞선 선을 덮는다. 좌우로 조금
// 벌려 두 방향이 나란히 보이게 한다 — 좌표는 그리기용으로만 바꾸고,
// 거리·경사·내비게이션은 원본 좌표를 그대로 쓴다.
function groupsUpTo(route: RouteResult, endSeg: number): ColorGroup[] {
  const { coords } = prepare(route);
  const groups: ColorGroup[] = [];
  let cur: LatLng[] = [coords[0]];
  let curBand = route.segments[0] ? gradeBand(route.segments[0].gradePct) : 'flat';
  for (let i = 0; i < endSeg; i++) {
    const band = gradeBand(route.segments[i].gradePct);
    if (band !== curBand) {
      groups.push({ positions: cur, color: GRADE_COLORS[curBand] });
      cur = [coords[i]];
      curBand = band;
    }
    cur.push(coords[i + 1]);
  }
  groups.push({ positions: cur, color: GRADE_COLORS[curBand] });
  return groups;
}
