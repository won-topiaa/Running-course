import type { RouteResult } from '../lib/routing';
import type { LatLng } from '../lib/types';

/** 지도 공용 provider 키 */
export interface MapKeys {
  kakaoKey?: string | null;
  mapboxToken?: string | null;
}

export interface RouteMapProps extends MapKeys {
  mode: 'pins' | 'distance';
  center: LatLng;
  waypoints: LatLng[];
  start: LatLng | null;
  route: RouteResult | null;
  onMapClick: (p: LatLng) => void;
  /** 선택되지 않은 후보 경로 — 흐린 점선으로 함께 표시해 비교를 돕는다 */
  alternatives?: LatLng[][];
  /** 핀을 눌렀을 때 (잘못 찍은 핀 삭제용) */
  onPinClick?: (index: number) => void;
  /** 아직 안 뛴 계획 경로 — 눈금(점선)으로 표시 */
  plannedPath?: LatLng[];
  /**
   * 오버레이(상단 카드·바텀시트)에 가려지는 위/아래 픽셀.
   * 화면 맞추기를 이 여백만큼 비대칭으로 줘야 경로가 '보이는 창' 안에 들어온다.
   * 안 주면 경로가 화면 정중앙에 놓여 절반이 시트 뒤로 숨는다.
   */
  fitInsets?: { top: number; bottom: number };
}

export interface PathMapProps extends MapKeys {
  path: LatLng[];
}

export interface LiveMapProps extends MapKeys {
  coords: LatLng[];
  center: LatLng;
  /** 따라 뛸 계획 경로 — 아직 안 지난 구간을 눈금(점선)으로 깔아둔다 */
  plannedPath?: LatLng[];
  /** 지나온 구간을 경사 색상으로 칠하기 위한 색상 그룹 */
  traveled?: { positions: LatLng[]; color: string }[];
}
