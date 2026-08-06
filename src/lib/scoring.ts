import {
  COURSE_TYPE_LABEL,
  ELEVATION_LABEL,
  type Course,
  type FactorKey,
  type FactorScore,
  type Preferences,
  type Recommendation,
} from './types';

// ---------------------------------------------------------------------------
// 취향 가중치 기반 러닝 코스 추천 엔진
//
// 각 코스에 대해 6요소별 원점수(raw, 0~1)를 구하고, 사용자가 지정한 중요도
// 가중치(weight, 0~5)를 곱해 가중 평균으로 종합 매칭 점수(0~100)를 계산한다.
// 동시에 왜 추천됐는지(reasons)와 주의할 점(cautions)을 자연어로 생성한다.
// ---------------------------------------------------------------------------

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 코스 형태별 경사 강도 (0=평지, 1=언덕 많음) */
const gradientIntensity: Record<Course['elevation']['category'], number> = {
  flat: 0,
  rolling: 0.5,
  hilly: 1,
};

/** 1) 경사도 점수 — 사용자의 경사 선호와 코스 경사가 얼마나 맞는지 */
function scoreGradient(course: Course, prefs: Preferences): number {
  const intensity = gradientIntensity[course.elevation.category];
  switch (prefs.gradientPref) {
    case 'flat':
      return clamp01(1 - intensity); // 평지일수록 만점
    case 'hilly':
      return clamp01(0.15 + intensity * 0.85); // 언덕일수록 만점
    case 'any':
    default:
      return 0.8; // 상관없음 → 감점 없이 무난
  }
}

/** 2) 코스 취향 점수 — 선택한 취향 태그와의 겹침 비율 */
function scorePreference(course: Course, prefs: Preferences): number {
  if (prefs.courseTypes.length === 0) return 0.7; // 취향 미선택 → 중립
  const matched = prefs.courseTypes.filter((t) =>
    course.courseTypes.includes(t),
  ).length;
  const ratio = matched / prefs.courseTypes.length;
  // 하나도 안 맞으면 0.1 바닥, 전부 맞으면 1.0
  return clamp01(0.1 + ratio * 0.9);
}

/** 3) 안전·조명 점수 — 야간 러닝이면 조명·야간적합 비중을 강화 */
function scoreSafety(course: Course, prefs: Preferences): number {
  const s = course.safety;
  const light = s.lighting / 5;
  const cctv = s.cctv ? 1 : 0;
  const night = s.nightFriendly ? 1 : 0;
  const trafficFree = s.trafficFree / 5;
  if (prefs.nightRun) {
    // 야간: 조명·야간적합을 크게, 미적합 코스는 강하게 감점
    const base = 0.4 * light + 0.1 * cctv + 0.35 * night + 0.15 * trafficFree;
    return clamp01(s.nightFriendly ? base : base * 0.6);
  }
  return clamp01(0.35 * light + 0.15 * cctv + 0.2 * night + 0.3 * trafficFree);
}

/** 4) 편의시설 점수 — 식수·화장실 비중을 조금 더 높게 */
function scoreAmenities(course: Course): number {
  const a = course.amenities;
  return clamp01(
    0.25 * (a.waterFountain ? 1 : 0) +
      0.25 * (a.restroom ? 1 : 0) +
      0.2 * (a.convenienceStore ? 1 : 0) +
      0.15 * (a.parking ? 1 : 0) +
      0.15 * (a.subwayAccess ? 1 : 0),
  );
}

/** 5) 경관·환경 점수 — 야간 러닝이면 야경 비중 강화 */
function scoreScenery(course: Course, prefs: Preferences): number {
  const sc = course.scenery;
  const g = sc.greenery / 5;
  const n = sc.nightView / 5;
  const sh = sc.shade / 5;
  if (prefs.nightRun) return clamp01(0.25 * g + 0.55 * n + 0.2 * sh);
  return clamp01(0.4 * g + 0.4 * n + 0.2 * sh);
}

/** 6) 거리 점수 — 목표 거리와의 근접도 (코스 형태에 따른 조절 가능성 반영) */
function scoreDistance(course: Course, prefs: Preferences): number {
  const target = prefs.targetDistanceKm;
  const tolerance = Math.max(1.5, target * 0.35);
  let raw = 1 - Math.abs(course.distanceKm - target) / tolerance;

  // 왕복 코스: 반환 지점을 앞당겨 목표보다 짧게 조절 가능
  if (course.loopType === 'out-and-back' && target <= course.distanceKm) {
    raw = Math.max(raw, 1 - (course.distanceKm - target) * 0.015);
  }
  // 순환 코스: 여러 바퀴로 목표에 근접시킬 수 있음
  if (course.loopType === 'loop') {
    const laps = Math.max(1, Math.round(target / course.distanceKm));
    const achievable = laps * course.distanceKm;
    raw = Math.max(raw, 1 - Math.abs(achievable - target) / tolerance);
  }
  return clamp01(raw);
}

const SCORERS: Record<FactorKey, (c: Course, p: Preferences) => number> = {
  gradient: scoreGradient,
  preference: scorePreference,
  safety: scoreSafety,
  amenities: (c) => scoreAmenities(c),
  scenery: scoreScenery,
  distance: scoreDistance,
};

const FACTOR_ORDER: FactorKey[] = [
  'gradient',
  'preference',
  'safety',
  'amenities',
  'scenery',
  'distance',
];

/** 코스 하나에 대한 추천 결과 계산 */
export function scoreCourse(course: Course, prefs: Preferences): Recommendation {
  const factors: FactorScore[] = FACTOR_ORDER.map((key) => {
    const raw = clamp01(SCORERS[key](course, prefs));
    const weight = prefs.weights[key];
    return { key, raw, weight, weighted: raw * weight };
  });

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const matchScore =
    totalWeight > 0
      ? (factors.reduce((s, f) => s + f.weighted, 0) / totalWeight) * 100
      : (factors.reduce((s, f) => s + f.raw, 0) / factors.length) * 100;

  const { reasons, cautions } = explain(course, prefs, factors);

  return {
    course,
    matchScore: Math.round(matchScore),
    factors,
    reasons,
    cautions,
  };
}

/** 전체 코스를 점수순으로 정렬해 추천 목록 반환 */
export function recommend(
  courses: Course[],
  prefs: Preferences,
): Recommendation[] {
  return courses
    .map((c) => scoreCourse(c, prefs))
    .sort((a, b) => b.matchScore - a.matchScore);
}

// ---------------------------------------------------------------------------
// 자연어 설명 생성
// ---------------------------------------------------------------------------

function explain(
  course: Course,
  prefs: Preferences,
  factors: FactorScore[],
): { reasons: string[]; cautions: string[] } {
  const reasons: string[] = [];
  const cautions: string[] = [];
  const byKey = Object.fromEntries(factors.map((f) => [f.key, f])) as Record<
    FactorKey,
    FactorScore
  >;

  // --- 경사도 ---
  if (prefs.weights.gradient > 0) {
    if (prefs.gradientPref === 'flat' && course.elevation.category === 'flat') {
      reasons.push('원하시는 평지 코스라 일정한 페이스를 유지하기 좋아요.');
    } else if (
      prefs.gradientPref === 'hilly' &&
      course.elevation.category === 'hilly'
    ) {
      reasons.push(
        `언덕 훈련에 제격 (총 오르막 ${course.elevation.gainM}m, 최대 경사 ${course.elevation.maxGradePct}%).`,
      );
    } else if (
      prefs.gradientPref === 'flat' &&
      course.elevation.category === 'hilly'
    ) {
      cautions.push(
        `평지를 원하셨지만 언덕이 많아요 (총 오르막 ${course.elevation.gainM}m).`,
      );
    } else if (
      prefs.gradientPref === 'hilly' &&
      course.elevation.category === 'flat'
    ) {
      cautions.push('언덕을 원하셨지만 거의 평지예요.');
    }
  }

  // --- 취향 태그 ---
  const matchedTypes = prefs.courseTypes.filter((t) =>
    course.courseTypes.includes(t),
  );
  if (matchedTypes.length > 0) {
    reasons.push(
      `선택한 취향과 일치: ${matchedTypes
        .map((t) => COURSE_TYPE_LABEL[t])
        .join(' · ')}.`,
    );
  } else if (prefs.courseTypes.length > 0 && prefs.weights.preference > 0) {
    cautions.push('선택한 취향 태그와는 겹치지 않는 코스예요.');
  }

  // --- 안전 ---
  if (prefs.nightRun) {
    if (course.safety.nightFriendly && course.safety.lighting >= 4) {
      reasons.push('가로등이 밝고 야간 러닝에 적합해요.');
    } else if (!course.safety.nightFriendly) {
      cautions.push('야간 러닝을 선택하셨는데 이 코스는 밤엔 조명이 약해요.');
    }
  } else if (prefs.weights.safety >= 3 && byKey.safety.raw >= 0.8) {
    reasons.push('가로등·CCTV가 잘 갖춰져 안전한 편이에요.');
  }
  if (
    prefs.courseTypes.includes('uninterrupted') &&
    course.safety.trafficFree < 4
  ) {
    cautions.push('중간에 도로·횡단보도와 만나 완전히 끊김 없는 코스는 아니에요.');
  }

  // --- 편의시설 ---
  if (prefs.weights.amenities >= 3) {
    const a = course.amenities;
    const have: string[] = [];
    if (a.waterFountain) have.push('식수대');
    if (a.restroom) have.push('화장실');
    if (a.convenienceStore) have.push('편의점');
    if (byKey.amenities.raw >= 0.8) {
      reasons.push(`편의시설이 충분해요 (${have.join('·')} 등).`);
    } else if (!a.waterFountain || !a.convenienceStore) {
      cautions.push('식수대·편의점 간격이 넓으니 물을 챙기세요.');
    }
  }

  // --- 경관 ---
  if (prefs.weights.scenery >= 3 && byKey.scenery.raw >= 0.75) {
    reasons.push(`경관이 좋아요: ${course.scenery.tags.slice(0, 3).join(' · ')}.`);
  }

  // --- 거리 ---
  if (prefs.weights.distance > 0) {
    const diff = course.distanceKm - prefs.targetDistanceKm;
    if (Math.abs(diff) <= 0.6) {
      reasons.push(`목표 거리와 거의 일치해요 (${course.distanceKm}km).`);
    } else if (course.loopType === 'loop' && diff < 0) {
      const laps = Math.max(1, Math.round(prefs.targetDistanceKm / course.distanceKm));
      reasons.push(
        `한 바퀴 ${course.distanceKm}km 순환 코스 — ${laps}바퀴면 목표(${prefs.targetDistanceKm}km)에 맞출 수 있어요.`,
      );
    } else if (course.loopType === 'out-and-back' && diff > 0) {
      reasons.push(
        `왕복 ${course.distanceKm}km 코스 — 반환 지점을 앞당겨 ${prefs.targetDistanceKm}km로 줄일 수 있어요.`,
      );
    } else if (diff > 1.5) {
      cautions.push(`목표보다 다소 길어요 (${course.distanceKm}km).`);
    } else if (diff < -1.5) {
      cautions.push(`목표보다 다소 짧아요 (${course.distanceKm}km).`);
    }
  }

  // 아무 이유도 없으면 카테고리 기반 기본 문장
  if (reasons.length === 0) {
    reasons.push(
      `${ELEVATION_LABEL[course.elevation.category]} · ${course.distanceKm}km 코스로 무난하게 즐길 수 있어요.`,
    );
  }

  return { reasons: reasons.slice(0, 4), cautions: cautions.slice(0, 3) };
}

// ---------------------------------------------------------------------------
// 기본 선호값
// ---------------------------------------------------------------------------

export function defaultPreferences(): Preferences {
  return {
    targetDistanceKm: 5,
    gradientPref: 'flat',
    courseTypes: ['uninterrupted', 'waterfront'],
    nightRun: false,
    weights: {
      gradient: 3,
      preference: 4,
      safety: 3,
      amenities: 2,
      scenery: 3,
      distance: 4,
    },
  };
}
