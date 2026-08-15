// ---------------------------------------------------------------------------
// 체력 기반 코스 처방 — 순수 로직
//
// 국민체육진흥공단 「국민체력100 체력인증센터 측정결과」(공공데이터포털
// 15108938)의 측정 분포와 사용자의 측정값을 견줘 백분위를 내고, 그 결과를
// '어떤 코스를 뛰면 되는가'로 옮긴다.
//
// 이 파일은 계산만 한다. 분포를 어디서 가져오는지는 kspoFitness.ts 가 맡는다.
//
// ── 지키는 원칙 ────────────────────────────────────────────────────────────
// 기준 분포가 없으면 백분위를 만들지 않는다(null). 이 앱은 고도를 못 받으면
// '0m' 대신 '—' 를 쓰고, 잴 축이 하나도 없으면 매칭 점수를 null 로 둔다.
// 체력도 같다 — 표본 없이 "상위 30%" 라고 말하는 순간 그건 지어낸 숫자다.
// ---------------------------------------------------------------------------

import type { Course } from './types';

export type Sex = 'male' | 'female';

/**
 * 측정 항목. 포털 설명에 명시된 항목만 둔다.
 * (신장·체중·체지방률·허리둘레·혈압·악력·윗몸말아올리기·반복점프)
 *
 * 심폐지구력(왕복오래달리기 등)은 설명문에 명시돼 있지 않아 넣지 않았다.
 * 실제 응답 필드에 있으면 여기에 추가하면 되고, 그 전까지 없는 항목을
 * 있는 척 두지 않는다.
 */
export type FitnessItem =
  | 'bodyFatPct' //   체지방률(%)      낮을수록 좋음
  | 'waistCm' //      허리둘레(cm)     낮을수록 좋음
  | 'gripKg' //       악력(kg)         높을수록 좋음
  | 'sitUpReps' //    윗몸말아올리기(회) 높을수록 좋음
  | 'jumpReps'; //    반복점프(회)      높을수록 좋음

/** 값이 낮을수록 좋은 항목 — 백분위를 뒤집어 계산한다 */
const LOWER_IS_BETTER: ReadonlySet<FitnessItem> = new Set<FitnessItem>([
  'bodyFatPct',
  'waistCm',
]);

export const FITNESS_ITEM_LABEL: Record<FitnessItem, string> = {
  bodyFatPct: '체지방률',
  waistCm: '허리둘레',
  gripKg: '악력',
  sitUpReps: '윗몸말아올리기',
  jumpReps: '반복점프',
};

/**
 * 러닝에 얼마나 직결되는지의 가중치.
 *
 * 반복점프(하지 근지구력·탄성)와 체지방률(체중 부하)이 달리기에 가장 크게
 * 걸리고, 악력은 전신 근력의 대리 지표라 약하게 본다. 이 가중치는 우리가
 * 정한 값이지 공단이 준 값이 아니다 — prescribe() 의 basis 에 그렇게 밝힌다.
 */
const RUN_WEIGHT: Record<FitnessItem, number> = {
  jumpReps: 0.3,
  bodyFatPct: 0.25,
  sitUpReps: 0.2,
  waistCm: 0.15,
  gripKg: 0.1,
};

/** 사용자가 입력하는 체력 프로필. 나이·성별만 있어도 시작할 수 있다. */
export interface FitnessProfile {
  birthYear: number | null;
  sex: Sex | null;
  /** 체력인증센터에서 받은 측정값 (있는 항목만) */
  measured: Partial<Record<FitnessItem, number>>;
  /** 측정 연월 (YYYY-MM) — 오래된 값은 화면에서 그렇게 표시한다 */
  measuredAt: string | null;
}

export function emptyFitnessProfile(): FitnessProfile {
  return { birthYear: null, sex: null, measured: {}, measuredAt: null };
}

/**
 * 기준 분포 한 덩어리 — 같은 성별·연령대의 측정값 표본.
 * kspoFitness.ts 가 공단 API 응답을 모아 이 모양으로 만든다.
 */
export interface FitnessNorm {
  sex: Sex;
  /** 연령대 라벨 (예: '30대') */
  ageBand: string;
  /** 항목별 오름차순 표본값 */
  samples: Partial<Record<FitnessItem, number[]>>;
  /** 표본 수 */
  n: number;
  /** 출처 문구 — 화면에 그대로 노출해 어디서 온 숫자인지 밝힌다 */
  source: string;
}

/** 만 나이 (생년만 아는 값이라 근사치다) */
export function ageFromBirthYear(birthYear: number, now = new Date()): number {
  return now.getFullYear() - birthYear;
}

/** 국민체력100 이 쓰는 연령대 구간 라벨 */
export function ageBandOf(age: number): string {
  if (age < 20) return '10대';
  if (age >= 70) return '70대 이상';
  return `${Math.floor(age / 10) * 10}대`;
}

/**
 * 표본 안에서 value 가 상위 몇 %인지 (0~100, 클수록 좋음).
 *
 * 표본이 적으면 백분위가 튄다 — 30개 미만이면 계산하지 않는다.
 * "상위 12%" 라는 말은 표본이 그 정밀도를 뒷받침할 때만 할 수 있다.
 */
export const MIN_SAMPLES = 30;

export function percentileOf(
  sortedAsc: number[] | undefined,
  value: number,
  lowerIsBetter: boolean,
): number | null {
  if (!sortedAsc || sortedAsc.length < MIN_SAMPLES || !Number.isFinite(value)) {
    return null;
  }
  // value 미만인 표본 수 → 하위 비율
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  const below = (lo / sortedAsc.length) * 100;
  return Math.round(lowerIsBetter ? 100 - below : below);
}

/** 항목별 백분위 결과 */
export interface ItemPercentile {
  item: FitnessItem;
  value: number;
  /** 0~100, 클수록 좋음 */
  percentile: number;
}

/** 체력 평가 결과 — 잴 수 없으면 전부 null 이다 */
export interface FitnessAssessment {
  /** 러닝 관련 항목을 가중 평균한 종합 백분위 (0~100). 잴 게 없으면 null */
  overall: number | null;
  items: ItemPercentile[];
  /** 못 잰 이유 — 화면에 그대로 보여 준다 */
  missing: string | null;
  norm: FitnessNorm | null;
}

/**
 * 프로필 + 기준 분포 → 백분위 평가.
 * 어느 단계에서 막혔는지 missing 에 남긴다(화면이 이유를 말할 수 있게).
 */
export function assess(
  profile: FitnessProfile,
  norm: FitnessNorm | null,
): FitnessAssessment {
  const none = (missing: string): FitnessAssessment => ({
    overall: null,
    items: [],
    missing,
    norm,
  });

  if (!profile.sex || profile.birthYear == null) {
    return none('나이와 성별을 알려주면 같은 또래와 견줘 볼 수 있어요.');
  }
  const measuredKeys = (Object.keys(profile.measured) as FitnessItem[]).filter((k) =>
    Number.isFinite(profile.measured[k]),
  );
  if (measuredKeys.length === 0) {
    return none('체력인증센터 측정값을 넣으면 또래 대비 내 체력을 볼 수 있어요.');
  }
  if (!norm) {
    return none('체력 기준 데이터를 아직 불러오지 못했어요.');
  }

  const items: ItemPercentile[] = [];
  for (const item of measuredKeys) {
    const value = profile.measured[item] as number;
    const p = percentileOf(norm.samples[item], value, LOWER_IS_BETTER.has(item));
    if (p != null) items.push({ item, value, percentile: p });
  }
  if (items.length === 0) {
    return none('넣어 주신 항목은 기준 표본이 모자라 비교하지 못했어요.');
  }

  let sum = 0;
  let wSum = 0;
  for (const it of items) {
    const w = RUN_WEIGHT[it.item];
    sum += w * it.percentile;
    wSum += w;
  }
  return { overall: Math.round(sum / wSum), items, missing: null, norm };
}

// ---------------------------------------------------------------------------
// 처방 — 백분위를 '무엇을 뛰면 되는가' 로 옮긴다
// ---------------------------------------------------------------------------

export interface RunPrescription {
  /** 1회 권장 거리(km) */
  sessionKm: { min: number; max: number };
  /** 권장 주간 횟수 */
  perWeek: number;
  /** 감당할 만한 km당 누적 상승(m) 상한 */
  maxAscentPerKm: number;
  /** 이 처방이 어디서 나온 값인지 — 화면·보고서에 그대로 쓴다 */
  basis: string;
}

/**
 * 종합 백분위 + 나이 → 러닝 처방.
 *
 * 여기 숫자(거리 구간·주간 횟수·경사 상한)는 공단이 준 값이 아니라 우리가
 * 정한 초기 기준이다. 공단 API 의 '운동처방' 필드를 받아오면 그쪽으로
 * 대체하는 게 맞다 — basis 에 출처를 남겨 두는 이유다.
 *
 * 백분위를 못 낸 경우(null)에는 처방도 하지 않는다. 모르면 모른다고 한다.
 */
export function prescribe(
  overall: number | null,
  age: number | null,
): RunPrescription | null {
  if (overall == null || age == null) return null;

  // 백분위 → 3단계. 경계에서 처방이 튀지 않게 폭을 넉넉히 둔다.
  const band = overall >= 67 ? 'high' : overall >= 34 ? 'mid' : 'low';
  const base =
    band === 'high'
      ? { sessionKm: { min: 5, max: 10 }, perWeek: 4, maxAscentPerKm: 45 }
      : band === 'mid'
        ? { sessionKm: { min: 3, max: 6 }, perWeek: 3, maxAscentPerKm: 25 }
        : { sessionKm: { min: 2, max: 4 }, perWeek: 3, maxAscentPerKm: 12 };

  // 나이에 따른 완충 — 같은 백분위라도 60대는 회복이 더 걸린다.
  // (또래 대비 백분위라 이미 나이가 반영돼 있으므로 조정은 작게 둔다)
  const easeOff = age >= 60 ? 0.8 : age >= 50 ? 0.9 : 1;
  const round1 = (v: number) => Math.round(v * 10) / 10;

  return {
    sessionKm: {
      min: round1(base.sessionKm.min * easeOff),
      max: round1(base.sessionKm.max * easeOff),
    },
    perWeek: base.perWeek,
    maxAscentPerKm: Math.round(base.maxAscentPerKm * easeOff),
    basis:
      '국민체력100 측정결과(국민체육진흥공단) 기준 또래 백분위로 산출했습니다. ' +
      '거리·횟수·경사 상한은 앱이 정한 초기 기준입니다.',
  };
}

/**
 * 코스가 이 처방에 얼마나 맞는지 0~1.
 *
 * 추천 엔진의 한 축으로 항상 들어간다 — 사용자가 켜고 끄는 기능이 아니라,
 * 체력을 알면 그만큼 더 잘 맞는 코스를 고르는 게 기본 동작이다.
 * 처방이 없으면(체력을 모르면) null 을 돌려주고, 호출부는 이 축을 빼고
 * 나머지로 점수를 낸다 — 모르는 축을 0점으로 두면 멀쩡한 코스가 밀린다.
 */
export function courseFitScore(
  course: Course,
  rx: RunPrescription | null,
): number | null {
  if (!rx) return null;

  // 거리: 권장 구간 안이면 만점, 벗어난 만큼 선형 감점
  const { min, max } = rx.sessionKm;
  const d = course.distanceKm;
  const span = Math.max(1, max - min);
  const distScore = d < min ? Math.max(0, 1 - (min - d) / span) : d > max ? Math.max(0, 1 - (d - max) / span) : 1;

  // 경사: 상한 이하면 만점, 넘으면 감점. 고도를 모르는 코스는 이 축을 뺀다.
  const ascentPerKm = course.distanceKm > 0 ? course.elevation.gainM / course.distanceKm : 0;
  const gradeScore = Math.max(0, Math.min(1, 1 - (ascentPerKm - rx.maxAscentPerKm) / Math.max(15, rx.maxAscentPerKm)));

  return Math.max(0, Math.min(1, distScore * 0.6 + gradeScore * 0.4));
}

/** 코스 카드에 붙일 한 마디 — 처방 대비 이 코스가 어느 쪽인지 */
export function fitLabel(
  course: Course,
  rx: RunPrescription | null,
): { text: string; tone: 'good' | 'push' | 'easy' } | null {
  if (!rx) return null;
  const d = course.distanceKm;
  const ascentPerKm = course.distanceKm > 0 ? course.elevation.gainM / course.distanceKm : 0;
  if (d > rx.sessionKm.max * 1.25 || ascentPerKm > rx.maxAscentPerKm * 1.5) {
    return { text: '도전적이에요', tone: 'push' };
  }
  if (d < rx.sessionKm.min * 0.75) return { text: '가볍게 풀기 좋아요', tone: 'easy' };
  return { text: '지금 체력에 맞아요', tone: 'good' };
}
