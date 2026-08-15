// ---------------------------------------------------------------------------
// 앱 설정 (localStorage 지속) — 외부 키(ORS·Mapbox·Strava), 기본 페이스, 홈 위치
// 각 키는 빌드시 주입된 VITE_* 값을 기본값으로, 없으면 사용자가 앱에서 입력한 값을 쓴다.
// ---------------------------------------------------------------------------

import { emptyFitnessProfile, type FitnessProfile } from './fitness';
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
  /**
   * 체력 프로필 — 별도 기능이 아니라 기본 항목이다.
   * 나이·성별만 있어도 또래 기준으로 코스를 맞춰 주고, 측정값이 있으면
   * 국민체력100 분포와 견줘 처방까지 낸다.
   */
  fitness: FitnessProfile;
  /** 공공데이터포털 서비스 키 (국민체력100 기준 분포 조회용, 선택) */
  kspoServiceKey: string | null;
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
// 공공데이터포털 서비스 키 — 국민체력100 기준 분포 조회 (없으면 체력 축을 뺀다)
const ENV_KSPO = import.meta.env.VITE_KSPO_SERVICE_KEY?.trim() || null;

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
    fitness: emptyFitnessProfile(),
    kspoServiceKey: ENV_KSPO,
  };
}

/**
 * 저장된 체력 프로필을 형태까지 확인해 되살린다.
 *
 * 손상된 값이 그대로 들어오면 백분위 계산에서 NaN 이 나오고, 그 NaN 이
 * 추천 점수를 타고 화면까지 올라간다 — 다른 저장값과 같은 규칙으로 거른다.
 */
function sanitizeFitness(v: unknown, base: FitnessProfile): FitnessProfile {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return base;
  const f = v as Partial<FitnessProfile>;
  const year =
    typeof f.birthYear === 'number' &&
    Number.isInteger(f.birthYear) &&
    f.birthYear >= 1900 &&
    f.birthYear <= new Date().getFullYear()
      ? f.birthYear
      : null;
  const sex = f.sex === 'male' || f.sex === 'female' ? f.sex : null;
  const measured: FitnessProfile['measured'] = {};
  if (f.measured && typeof f.measured === 'object' && !Array.isArray(f.measured)) {
    for (const [k, val] of Object.entries(f.measured)) {
      // 0 이하는 '측정 안 함' 이 잘못 저장된 값이다 — 표본 비교에 넣지 않는다
      if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
        (measured as Record<string, number>)[k] = val;
      }
    }
  }
  const measuredAt =
    typeof f.measuredAt === 'string' && /^\d{4}-\d{2}$/.test(f.measuredAt) ? f.measuredAt : null;
  return { birthYear: year, sex, measured, measuredAt };
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // 객체가 아니면(깨진 값·다른 버전) 통째로 무시한다. 문자열을 그대로
      // 펼치면 인덱스 키가 섞여 들어오고, 숫자여야 할 자리에 이상한 값이
      // 들어가면 지도·페이스 계산이 렌더 중에 터진다.
      const saved: Partial<Settings> =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      // 옛 기본 키가 저장돼 있으면 무시하고 새 기본 키를 쓴다
      const savedKakao = saved.kakaoJsKey === KAKAO_LEGACY ? null : saved.kakaoJsKey;
      // 좌표·페이스는 형태까지 확인한다 — 여기가 깨지면 지도가 못 뜬다
      const home =
        Array.isArray(saved.homeLocation) &&
        saved.homeLocation.length === 2 &&
        saved.homeLocation.every((n) => typeof n === 'number' && Number.isFinite(n))
          ? (saved.homeLocation as Settings['homeLocation'])
          : base.homeLocation;
      const pace =
        typeof saved.paceSecPerKm === 'number' &&
        Number.isFinite(saved.paceSecPerKm) &&
        saved.paceSecPerKm > 60
          ? saved.paceSecPerKm
          : base.paceSecPerKm;

      const weekGoal =
        typeof saved.weekGoalKm === 'number' &&
        Number.isFinite(saved.weekGoalKm) &&
        saved.weekGoalKm > 0
          ? saved.weekGoalKm
          : base.weekGoalKm;

      return {
        ...base,
        ...saved,
        homeLocation: home,
        paceSecPerKm: pace,
        weekGoalKm: weekGoal,
        fitness: sanitizeFitness(saved.fitness, base.fitness),
        kspoServiceKey: ENV_KSPO ?? saved.kspoServiceKey ?? null,
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
