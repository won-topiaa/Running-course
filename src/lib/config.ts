// ---------------------------------------------------------------------------
// 앱 설정 (localStorage 지속) — 외부 키(ORS·Mapbox·Strava), 기본 페이스, 홈 위치
// 각 키는 빌드시 주입된 VITE_* 값을 기본값으로, 없으면 사용자가 앱에서 입력한 값을 쓴다.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';

const KEY = 'run-app-settings-v1';

export interface Settings {
  /** OpenRouteService API 키 (없으면 오프라인 데모 모드) */
  orsKey: string | null;
  /** Mapbox access token (없으면 OSM 타일) */
  mapboxToken: string | null;
  /** Strava OAuth client id (없으면 GPX 내보내기만) */
  stravaClientId: string | null;
  /** 기본 러닝 페이스 (초/km) */
  paceSecPerKm: number;
  /** 홈/시작 위치 */
  homeLocation: LatLng;
}

const ENV_ORS = import.meta.env.VITE_ORS_API_KEY?.trim() || null;
const ENV_MAPBOX = import.meta.env.VITE_MAPBOX_TOKEN?.trim() || null;
const ENV_STRAVA = import.meta.env.VITE_STRAVA_CLIENT_ID?.trim() || null;

/** 서울시청 */
export const DEFAULT_LOCATION: LatLng = [37.5665, 126.978];

export function defaultSettings(): Settings {
  return {
    orsKey: ENV_ORS,
    mapboxToken: ENV_MAPBOX,
    stravaClientId: ENV_STRAVA,
    paceSecPerKm: 360, // 6'00"/km
    homeLocation: DEFAULT_LOCATION,
  };
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      return {
        ...base,
        ...saved,
        // env 값이 있으면 항상 우선 (배포 환경 주입값)
        orsKey: ENV_ORS ?? saved.orsKey ?? null,
        mapboxToken: ENV_MAPBOX ?? saved.mapboxToken ?? null,
        stravaClientId: ENV_STRAVA ?? saved.stravaClientId ?? null,
      };
    }
  } catch {
    /* 무시 */
  }
  return base;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 무시 */
  }
}
