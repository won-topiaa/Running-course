// ---------------------------------------------------------------------------
// 앱 설정 (localStorage 지속) — 외부 키(ORS·Mapbox·Strava), 기본 페이스, 홈 위치
// 각 키는 빌드시 주입된 VITE_* 값을 기본값으로, 없으면 사용자가 앱에서 입력한 값을 쓴다.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';

const KEY = 'run-app-settings-v1';

export interface Settings {
  /** 카카오맵 JavaScript 키 (있으면 지도를 카카오맵으로 표시) */
  kakaoJsKey: string | null;
  /** OpenRouteService API 키 (없으면 오프라인 데모 모드) */
  orsKey: string | null;
  /** Mapbox access token (카카오·OSM 대신 사용, 선택) */
  mapboxToken: string | null;
  /** Strava 연동 Worker 주소 (없으면 GPX 내보내기 + 수동 업로드) */
  stravaWorkerUrl: string | null;
  /** 기본 러닝 페이스 (초/km) */
  paceSecPerKm: number;
  /** 홈/시작 위치 */
  homeLocation: LatLng;
}

// 카카오 JavaScript 키는 도메인 제한으로 보호되는 공개용 클라이언트 키.
// 배포 도메인을 카카오 개발자 콘솔의 Web 플랫폼에 등록해야 지도가 뜬다.
// 교체하려면 마이 페이지에 새 키를 넣거나 VITE_KAKAO_JS_KEY 로 주입.
const KAKAO_DEFAULT = 'f8d52c354ff017870d132f16204d56ab';

// OpenRouteService 무료 키 (도보 경로·왕복 생성·고도).
// 소유자 결정으로 기본값 내장 — 무료 한도(일일 쿼터)라 남용 시 소진될 수 있으며,
// 그 경우 openrouteservice.org 에서 재발급해 교체하면 된다. 소진되면 앱은 자동으로
// OSRM 도보 경로로 폴백하므로 기능이 멈추지는 않는다.
const ORS_DEFAULT =
  'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjZiMjU3YzY3Y2FhZjQ0MTdhNjc5N2FhN2NjZmI1OTUyIiwiaCI6Im11cm11cjY0In0=';

const ENV_KAKAO = import.meta.env.VITE_KAKAO_JS_KEY?.trim() || null;
const ENV_ORS = import.meta.env.VITE_ORS_API_KEY?.trim() || null;
const ENV_MAPBOX = import.meta.env.VITE_MAPBOX_TOKEN?.trim() || null;
const ENV_STRAVA = import.meta.env.VITE_STRAVA_WORKER_URL?.trim() || null;

/** 서울시청 */
export const DEFAULT_LOCATION: LatLng = [37.5665, 126.978];

export function defaultSettings(): Settings {
  return {
    kakaoJsKey: ENV_KAKAO ?? KAKAO_DEFAULT,
    orsKey: ENV_ORS ?? ORS_DEFAULT,
    mapboxToken: ENV_MAPBOX,
    stravaWorkerUrl: ENV_STRAVA,
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
        kakaoJsKey: ENV_KAKAO ?? saved.kakaoJsKey ?? KAKAO_DEFAULT,
        orsKey: ENV_ORS ?? saved.orsKey ?? ORS_DEFAULT,
        mapboxToken: ENV_MAPBOX ?? saved.mapboxToken ?? null,
        stravaWorkerUrl: ENV_STRAVA ?? saved.stravaWorkerUrl ?? null,
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
