// ---------------------------------------------------------------------------
// 앱 설정 (localStorage 지속) — ORS 키, 기본 페이스, 홈 위치
// ORS 키는 빌드시 주입된 VITE_ORS_API_KEY 를 기본값으로, 없으면 사용자가 앱에서
// 입력한 값을 사용한다.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';

const KEY = 'run-app-settings-v1';

export interface Settings {
  /** OpenRouteService API 키 (없으면 오프라인 데모 모드) */
  orsKey: string | null;
  /** 기본 러닝 페이스 (초/km) */
  paceSecPerKm: number;
  /** 홈/시작 위치 */
  homeLocation: LatLng;
}

const ENV_KEY = import.meta.env.VITE_ORS_API_KEY?.trim() || null;

/** 서울시청 */
export const DEFAULT_LOCATION: LatLng = [37.5665, 126.978];

export function defaultSettings(): Settings {
  return {
    orsKey: ENV_KEY,
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
        // env 키가 있으면 항상 우선 (배포 환경 주입값)
        orsKey: ENV_KEY ?? saved.orsKey ?? null,
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
