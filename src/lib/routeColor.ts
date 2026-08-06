// 경로를 경사 밴드별로 묶어 색상 폴리라인 그룹으로 변환 (Leaflet·카카오 공용)
import type { RouteResult } from './routing';
import { gradeBand, GRADE_COLORS } from './routeStyle';
import type { LatLng } from './types';

export interface ColorGroup {
  positions: LatLng[];
  color: string;
}

export function coloredSegments(route: RouteResult | null): ColorGroup[] {
  if (!route || route.coords.length < 2) return [];
  const groups: ColorGroup[] = [];
  let cur: LatLng[] = [route.coords[0]];
  let curBand = route.segments[0] ? gradeBand(route.segments[0].gradePct) : 'flat';
  for (let i = 0; i < route.segments.length; i++) {
    const band = gradeBand(route.segments[i].gradePct);
    if (band !== curBand) {
      groups.push({ positions: cur, color: GRADE_COLORS[curBand] });
      cur = [route.coords[i]];
      curBand = band;
    }
    cur.push(route.coords[i + 1]);
  }
  groups.push({ positions: cur, color: GRADE_COLORS[curBand] });
  return groups;
}
