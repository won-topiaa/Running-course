// ---------------------------------------------------------------------------
// 지하철역 — '역에서 역으로 뛰기'
//
// 피드백에서 나온 요청은 "지하철을 따라 뛰고 싶다" 였는데, 선로를 그대로
// 따라가게 만들면 오히려 나쁜 코스가 된다. 서울에서 2호선은 테헤란로,
// 신분당선은 강남대로 밑을 지난다 — 신호등이 가장 많고 차도 옆이고, 우리
// 혼잡도 모델이 핫존으로 집는 바로 그 길이다.
//
// 사람들이 지하철을 따라 뛰는 진짜 이유는 선로가 좋아서가 아니다.
//   · 길을 정할 필요가 없다      · 역이 이정표라 길을 잃지 않는다
//   · 아무 역에서나 그만둘 수 있다  · '몇 정거장' 이라는 거리 감각이 있다
//
// 그래서 역은 '이정표' 로만 쓴다. 출발역과 도착역만 정하고, 그 사이 경로는
// 기존 채점기(경사·신호등·흙길)가 좋은 길로 고른다.
//
// 노선 내 역 순서는 데이터에 없다 — 역번호가 노선 위상과 어긋나는 구간이
// 있어서(6호선 봉화산, 2호선 지선) 만들지 않았다. 대신 같은 노선 역을
// '출발역에서 가까운 순' 으로 보여준다. 사용자가 얻는 감각은 같고, 실제
// 거리라 '3정거장' 보다 오히려 정확하다.
// ---------------------------------------------------------------------------

import subwayData from '../data/subway.json';
import { haversineMeters } from './geo';
import type { LatLng } from './types';

export interface Station {
  name: string;
  lat: number;
  lng: number;
}

export interface SubwayLine {
  /** '2' · 'sinbundang' */
  line: string;
  /** '2호선' */
  name: string;
  /** 노선색 */
  color: string;
  /** 이 노선 좌표를 어느 공공데이터에서 골랐는지 */
  source: string;
  stations: Station[];
}

/** 노선 정보를 붙인 역 — 같은 이름의 환승역이 노선마다 따로 있다 */
export interface LineStation extends Station {
  line: string;
  lineName: string;
  color: string;
}

interface SubwayData {
  source: string;
  note: string;
  collectedAt: string;
  lineCount: number;
  stationCount: number;
  /** 수집 때 걸러낸 것들 — 무엇을 왜 뺐는지 */
  warnings: string[];
  lines: SubwayLine[];
}

const data = subwayData as SubwayData;

export const LINES: SubwayLine[] = data.lines;

export function subwaySource(): string {
  return data.source;
}

/** 노선 정보를 붙여 평평하게 편 전체 역 목록 */
const ALL: LineStation[] = data.lines.flatMap((l) =>
  l.stations.map((s) => ({ ...s, line: l.line, lineName: l.name, color: l.color })),
);

export function allStations(): LineStation[] {
  return ALL;
}

export function stationCount(): number {
  return ALL.length;
}

export function lineOf(line: string): SubwayLine | null {
  return data.lines.find((l) => l.line === line) ?? null;
}

/** 같은 역 이름이 여러 노선에 있으면(환승역) 그 노선들을 모두 준다 */
export function linesAtStation(name: string): string[] {
  return [...new Set(ALL.filter((s) => s.name === name).map((s) => s.line))].sort();
}

export interface NearStation extends LineStation {
  distanceM: number;
}

function withDistance(from: LatLng, s: LineStation): NearStation {
  return { ...s, distanceM: haversineMeters(from, [s.lat, s.lng]) };
}

/**
 * 가장 가까운 역. 출발역을 자동으로 제안할 때 쓴다.
 * 같은 자리에 환승역이 여러 노선으로 겹쳐 있으면 그중 하나가 나온다 —
 * 노선을 고르는 건 그다음 단계라 여기서는 아무거나로 충분하다.
 */
export function nearestStation(from: LatLng, maxM = 3000): NearStation | null {
  let best: NearStation | null = null;
  for (const s of ALL) {
    const d = haversineMeters(from, [s.lat, s.lng]);
    if (d > maxM) continue;
    if (!best || d < best.distanceM) best = { ...s, distanceM: d };
  }
  return best;
}

/** 가까운 역들 — 출발역을 직접 고를 때 쓴다 (역 이름 기준으로 중복 제거) */
export function nearbyStations(from: LatLng, maxM = 3000, limit = 8): NearStation[] {
  const seen = new Set<string>();
  const out: NearStation[] = [];
  for (const s of ALL.map((x) => withDistance(from, x)).sort((a, b) => a.distanceM - b.distanceM)) {
    if (s.distanceM > maxM) break;
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 도착역 후보 — 같은 노선의 다른 역을, 출발역에서 가까운 순으로.
 *
 * minM 을 두는 이유: 바로 옆 역(보통 1km 안쪽)은 러닝 코스로 너무 짧다.
 * maxM 은 하루에 뛸 만한 거리의 상한이다. 둘 다 직선거리 기준이고,
 * 실제 코스는 길을 따라가므로 1.2~1.4배쯤 길어진다.
 */
export function destinationsFrom(
  origin: LineStation,
  opts: { minM?: number; maxM?: number; limit?: number } = {},
): NearStation[] {
  const { minM = 800, maxM = 12000, limit = 12 } = opts;
  const line = lineOf(origin.line);
  if (!line) return [];

  return line.stations
    .filter((s) => s.name !== origin.name)
    .map((s) =>
      withDistance([origin.lat, origin.lng], {
        ...s,
        line: line.line,
        lineName: line.name,
        color: line.color,
      }),
    )
    .filter((s) => s.distanceM >= minM && s.distanceM <= maxM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

/**
 * 경로 주변의 역 — '중간에 그만둘 수 있는 곳'.
 *
 * 이게 이 기능의 핵심이다. 지도에서 두 점을 찍는 것과 다른 점은, 힘들거나
 * 비가 오면 다음 역에서 타고 집에 갈 수 있다는 것이다. 그 안전망이 보이면
 * 낯선 길로 나설 수 있다.
 *
 * 시설 검색(findNearRouteIn)과 같은 방식이다 — 경로를 20등분해 각 지점에서
 * 찾고, 출발점 기준 진행 거리를 함께 준다.
 */
export interface EscapeStation extends NearStation {
  /** 출발점에서 경로를 따라 여기까지 온 거리 */
  alongM: number;
}

/** 출발·도착역은 '중간에 그만둘 곳' 이 아니다. 이 거리 안이면 양 끝으로 본다 */
const ENDPOINT_M = 400;

export function escapeStations(
  path: LatLng[],
  radiusM = 700,
  limit = 6,
): EscapeStation[] {
  if (path.length < 2) return [];

  // 각 점까지의 누적 거리 — 역이 '몇 km 지점' 인지 말해 주려면 필요하다
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(path[i - 1], path[i]));
  }
  const totalM = cum[cum.length - 1];

  const startPt = path[0];
  const endPt = path[path.length - 1];

  const best = new Map<string, EscapeStation>();
  const step = Math.max(1, Math.floor(path.length / 20));

  for (let i = 0; i < path.length; i += step) {
    for (const s of ALL) {
      const d = haversineMeters(path[i], [s.lat, s.lng]);
      if (d > radiusM) continue;
      // 출발역·도착역을 여기 끼워 넣으면 '중간' 이라는 말이 거짓이 된다.
      // 코스를 시작한 자리와 끝나는 자리는 빼고 그 사이만 남긴다.
      if (haversineMeters(startPt, [s.lat, s.lng]) <= ENDPOINT_M) continue;
      if (haversineMeters(endPt, [s.lat, s.lng]) <= ENDPOINT_M) continue;
      // 같은 역이 여러 지점에서 잡히면 가장 가까운 지점만 남긴다
      const prev = best.get(s.name);
      if (!prev || d < prev.distanceM) {
        best.set(s.name, { ...s, distanceM: d, alongM: cum[i] });
      }
    }
  }

  return [...best.values()]
    .filter((s) => s.alongM > 0 && s.alongM < totalM)
    .sort((a, b) => a.alongM - b.alongM)
    .slice(0, limit);
}

/** 러닝 중에 쓰는 것 — 지금 위치에서 가장 가까운 역 하나 */
export function nearestEscape(from: LatLng, maxM = 1500): NearStation | null {
  return nearestStation(from, maxM);
}

export function formatStationDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
