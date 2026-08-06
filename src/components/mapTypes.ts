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
}

export interface PathMapProps extends MapKeys {
  path: LatLng[];
}

export interface LiveMapProps extends MapKeys {
  coords: LatLng[];
  center: LatLng;
}
