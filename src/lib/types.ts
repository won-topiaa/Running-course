// ---------------------------------------------------------------------------
// 도메인 타입 정의
// 러닝 코스를 6가지 핵심 요소로 모델링한다:
//   1) 경사도  2) 코스 취향  3) 안전·조명  4) 편의시설  5) 경관·환경  6) 거리
// ---------------------------------------------------------------------------

/** 지도에 그릴 GPS 좌표 [위도, 경도] */
export type LatLng = [number, number];

/** 코스 취향 태그 — 리서치로 도출한 최근 러너들이 원하는 코스 유형 */
export type CourseType =
  | 'city' //          시티런: 도심·야경
  | 'uninterrupted' // 끊김 없는 코스: 신호등·횡단보도·차량 없음
  | 'green' //         그린런: 공원·숲·자연
  | 'waterfront' //    워터프론트: 강변·호수·해안
  | 'trail' //         트레일런: 흙길·비포장
  | 'track'; //        트랙/우레탄: 정확한 페이스 훈련

export const COURSE_TYPE_LABEL: Record<CourseType, string> = {
  city: '시티런',
  uninterrupted: '끊김 없는',
  green: '그린런',
  waterfront: '워터프론트',
  trail: '트레일',
  track: '트랙·우레탄',
};

export const COURSE_TYPE_EMOJI: Record<CourseType, string> = {
  city: '🏙️',
  uninterrupted: '🔁',
  green: '🌳',
  waterfront: '🌊',
  trail: '🥾',
  track: '🏟️',
};

/** 코스 형태 */
export type LoopType = 'loop' | 'out-and-back' | 'point-to-point';

export const LOOP_TYPE_LABEL: Record<LoopType, string> = {
  loop: '순환(루프)',
  'out-and-back': '왕복',
  'point-to-point': '편도',
};

/** 노면 종류 */
export type Surface = 'asphalt' | 'urethane' | 'dirt' | 'track' | 'boardwalk';

export const SURFACE_LABEL: Record<Surface, string> = {
  asphalt: '아스팔트',
  urethane: '우레탄',
  dirt: '흙길',
  track: '트랙',
  boardwalk: '데크',
};

/** 경사도 정보 (1번 요소) */
export interface Elevation {
  gainM: number; //        누적 상승 고도(m)
  maxGradePct: number; //  구간 최대 경사(%)
  /** 거리에 따른 고도 프로파일(m). 등간격 샘플. 차트/경사 계산에 사용 */
  profile: number[];
  category: 'flat' | 'rolling' | 'hilly';
}

export const ELEVATION_LABEL: Record<Elevation['category'], string> = {
  flat: '평지',
  rolling: '완만한 언덕',
  hilly: '언덕 많음',
};

/** 안전·조명 (3번 요소) */
export interface Safety {
  lighting: number; //      조명 수준 1~5 (가로등)
  cctv: boolean; //         CCTV 유무
  nightFriendly: boolean; // 야간 러닝 적합
  /** 끊김 없는 정도 1~5 (신호등·차량 없음). '끊김 없는 코스' 취향과 연동 */
  trafficFree: number;
}

/** 편의시설 (4번 요소) */
export interface Amenities {
  waterFountain: boolean; //    식수대
  restroom: boolean; //         화장실
  convenienceStore: boolean; // 편의점
  parking: boolean; //          주차장
  subwayAccess: boolean; //     지하철 접근성
}

/** 경관·환경 (5번 요소) */
export interface Scenery {
  greenery: number; //  녹지·자연 1~5
  nightView: number; // 야경 1~5
  shade: number; //     그늘(여름 쾌적도) 1~5
  /** 표시용 경관 태그 (예: 야경, 강뷰, 벚꽃, 숲) */
  tags: string[];
}

/** 러닝 코스 한 개 */
export interface Course {
  id: string;
  name: string;
  area: string; //         행정구역/권역 (예: 서초구 반포동)
  summary: string; //      한 줄 소개
  distanceKm: number; //   대표 거리 (6번 요소)
  /** 지도에 그릴 실제 경로 좌표 */
  path: LatLng[];
  loopType: LoopType;
  surface: Surface[];
  courseTypes: CourseType[]; // 취향 태그 (2번 요소)
  elevation: Elevation; //     경사도 (1번)
  safety: Safety; //           안전·조명 (3번)
  amenities: Amenities; //     편의시설 (4번)
  scenery: Scenery; //         경관·환경 (5번)
  /** 코스에 대한 러너 팁 */
  tips: string;
}

// ---------------------------------------------------------------------------
// 추천 관련 타입
// ---------------------------------------------------------------------------

/** 6가지 요소 키 */
export type FactorKey =
  | 'gradient'
  | 'preference'
  | 'safety'
  | 'amenities'
  | 'scenery'
  | 'distance';

export const FACTOR_META: Record<
  FactorKey,
  { label: string; emoji: string; hint: string }
> = {
  gradient: { label: '경사도', emoji: '⛰️', hint: '원하는 경사 난이도와 얼마나 맞는지' },
  preference: { label: '코스 취향', emoji: '💚', hint: '선택한 취향 태그와 얼마나 겹치는지' },
  safety: { label: '안전·조명', emoji: '🛡️', hint: '가로등·CCTV·야간 적합·끊김 없음' },
  amenities: { label: '편의시설', emoji: '🚰', hint: '식수대·화장실·편의점·주차·지하철' },
  scenery: { label: '경관·환경', emoji: '🌆', hint: '녹지·야경·그늘 등 풍경 만족도' },
  distance: { label: '거리', emoji: '📏', hint: '목표 거리와 얼마나 가까운지' },
};

/** 경사 선호 */
export type GradientPreference = 'flat' | 'any' | 'hilly';

export const GRADIENT_PREF_LABEL: Record<GradientPreference, string> = {
  flat: '평지 위주',
  any: '상관없음',
  hilly: '언덕 원함',
};

/** 사용자 선호 입력 */
export interface Preferences {
  /** 목표 거리(km) */
  targetDistanceKm: number;
  /** 경사 선호 */
  gradientPref: GradientPreference;
  /** 선택한 취향 태그 */
  courseTypes: CourseType[];
  /** 야간 러닝 여부 (켜면 안전·조명 비중 강화) */
  nightRun: boolean;
  /** 6요소별 중요도 가중치 0~5 */
  weights: Record<FactorKey, number>;
}

/** 요소별 점수 상세 (0~1 정규화) */
export interface FactorScore {
  key: FactorKey;
  /** 해당 코스의 원점수 0~1 */
  raw: number;
  /** 사용자 가중치 */
  weight: number;
  /** 가중 기여분 (raw * weight) */
  weighted: number;
}

/** 한 코스에 대한 추천 결과 */
export interface Recommendation {
  course: Course;
  /** 종합 매칭 점수 0~100 */
  matchScore: number;
  factors: FactorScore[];
  /** 사람이 읽는 추천 이유 문장들 */
  reasons: string[];
  /** 감점/주의 문장들 */
  cautions: string[];
}
