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
  /** 이번 주 러닝 목표 거리 (km) */
  weekGoalKm: number;
  /** Supabase 프로젝트 URL — 이메일 로그인 동기화 (선택) */
  supabaseUrl: string | null;
  /** Supabase anon key (공개용 클라이언트 키, RLS 가 데이터 보호) */
  supabaseAnonKey: string | null;
  /** 홈/시작 위치 */
  homeLocation: LatLng;
}

// 카카오 JavaScript 키는 도메인 제한으로 보호되는 공개용 클라이언트 키.
// 소유자의 카카오맵 사용 설정이 살아있는 앱의 키를 쓴다 (콘솔에서 해당 앱의
// JavaScript SDK 도메인에 배포 도메인이 등록돼 있어야 지도가 뜬다).
// 교체하려면 마이 페이지에 새 키를 넣거나 VITE_KAKAO_JS_KEY 로 주입.
const KAKAO_DEFAULT = '75ab8b6a544d1d4a8c64326c2c3d9f81';
// 예전 기본 키 — 카카오맵 미활성 앱의 키라 지도가 안 떴다. 이 값이 저장돼
// 있으면 사용자가 직접 넣은 게 아니라 옛 기본값이 남은 것이므로 새 키로 넘긴다.
const KAKAO_LEGACY = 'f8d52c354ff017870d132f16204d56ab';

// OpenRouteService 무료 키 (도보 경로·왕복 생성·고도).
// 소유자 결정으로 기본값 내장 — 무료 한도(일일 쿼터)라 남용 시 소진될 수 있으며,
// 그 경우 openrouteservice.org 에서 재발급해 교체하면 된다. 소진되면 앱은 자동으로
// OSRM 도보 경로로 폴백하므로 기능이 멈추지는 않는다.
const ORS_DEFAULT =
  'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjZiMjU3YzY3Y2FhZjQ0MTdhNjc5N2FhN2NjZmI1OTUyIiwiaCI6Im11cm11cjY0In0=';

// Supabase 이메일 로그인 동기화. publishable(구 anon) 키는 브라우저 공개용으로 설계된
// 클라이언트 키이며, 실제 데이터 보호는 backups 테이블의 RLS(auth.uid() = user_id)가 한다.
// 서버 전용 secret/service_role 키는 절대 여기에 넣지 않는다.
const SUPABASE_URL_DEFAULT = 'https://tpolklovxtxveouogian.supabase.co';
const SUPABASE_KEY_DEFAULT = 'sb_publishable_txfUhRgEImnZzJAU1oC6tg_tR1A0Yum';

const ENV_KAKAO = import.meta.env.VITE_KAKAO_JS_KEY?.trim() || null;
const ENV_ORS = import.meta.env.VITE_ORS_API_KEY?.trim() || null;
const ENV_MAPBOX = import.meta.env.VITE_MAPBOX_TOKEN?.trim() || null;
const ENV_STRAVA = import.meta.env.VITE_STRAVA_WORKER_URL?.trim() || null;
const ENV_SB_URL = import.meta.env.VITE_SUPABASE_URL?.trim() || null;
const ENV_SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || null;

/** 서울시청 */
export const DEFAULT_LOCATION: LatLng = [37.5665, 126.978];

export function defaultSettings(): Settings {
  return {
    kakaoJsKey: ENV_KAKAO ?? KAKAO_DEFAULT,
    orsKey: ENV_ORS ?? ORS_DEFAULT,
    mapboxToken: ENV_MAPBOX,
    stravaWorkerUrl: ENV_STRAVA,
    paceSecPerKm: 360, // 6'00"/km
    weekGoalKm: 15,
    supabaseUrl: ENV_SB_URL ?? SUPABASE_URL_DEFAULT,
    supabaseAnonKey: ENV_SB_KEY ?? SUPABASE_KEY_DEFAULT,
    homeLocation: DEFAULT_LOCATION,
  };
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      // 옛 기본 키가 저장돼 있으면 무시하고 새 기본 키를 쓴다
      const savedKakao = saved.kakaoJsKey === KAKAO_LEGACY ? null : saved.kakaoJsKey;
      return {
        ...base,
        ...saved,
        // env 값이 있으면 항상 우선 (배포 환경 주입값)
        kakaoJsKey: ENV_KAKAO ?? savedKakao ?? KAKAO_DEFAULT,
        orsKey: ENV_ORS ?? saved.orsKey ?? ORS_DEFAULT,
        mapboxToken: ENV_MAPBOX ?? saved.mapboxToken ?? null,
        stravaWorkerUrl: ENV_STRAVA ?? saved.stravaWorkerUrl ?? null,
        supabaseUrl: ENV_SB_URL ?? saved.supabaseUrl ?? SUPABASE_URL_DEFAULT,
        supabaseAnonKey: ENV_SB_KEY ?? saved.supabaseAnonKey ?? SUPABASE_KEY_DEFAULT,
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
