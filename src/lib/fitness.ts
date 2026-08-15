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
 * 측정 항목 — 실제 응답의 '채워진 비율' 을 재서 고른 것들이다.
 *
 * 2023년 이후 30대 남성 1,000행 실측:
 *   체지방율 100% · 악력 99.8% · VO₂max 합계 ~100%(스텝 70/왕복 20/트레드밀 10)
 *   제자리멀리뛰기 65% · 허리둘레 54%
 *   윗몸말아올리기·반복점프·절대악력(f052) 은 0% — 명세엔 있어도 값이 없다.
 *
 * 그래서 명세에 있는 40여 항목 중 실제로 쓸 수 있는 것만 남겼다. 없는 항목을
 * 입력칸으로 두면 사용자는 넣을 수 없는 값을 찾아 헤매고, 기준 분포도 못 만든다.
 *
 * 왕복오래달리기(회)는 VO₂max 로 이미 환산돼 들어오므로 따로 두지 않는다 —
 * 같은 검사를 두 번 세면 심폐 축에 이중 가중치가 걸린다.
 * BMI 는 뺐다. '낮을수록 좋음' 으로 다루면 저체중이 만점을 받는데 그건
 * 러너에게 좋은 신호가 아니다.
 */
export type FitnessItem =
  | 'vo2max' //       최대산소섭취량(ml/kg/min)  높을수록 좋음 ★ 러닝 핵심
  | 'bodyFatPct' //   체지방율(%)                낮을수록 좋음
  | 'longJumpCm' //   제자리 멀리뛰기(cm)         높을수록 좋음 (하지 순발력)
  | 'gripKg' //       악력(kg)                   높을수록 좋음
  | 'waistCm'; //     허리둘레(cm)               낮을수록 좋음

/** 값이 낮을수록 좋은 항목 — 백분위를 뒤집어 계산한다 */
const LOWER_IS_BETTER: ReadonlySet<FitnessItem> = new Set<FitnessItem>([
  'bodyFatPct',
  'waistCm',
]);

export const FITNESS_ITEM_LABEL: Record<FitnessItem, string> = {
  vo2max: '심폐지구력(VO₂max)',
  bodyFatPct: '체지방율',
  longJumpCm: '제자리 멀리뛰기',
  gripKg: '악력',
  waistCm: '허리둘레',
};

export const FITNESS_ITEM_UNIT: Record<FitnessItem, string> = {
  vo2max: 'ml/kg/min',
  bodyFatPct: '%',
  longJumpCm: 'cm',
  gripKg: 'kg',
  waistCm: 'cm',
};

/**
 * 사람이 낼 수 있는 값의 범위. 밖이면 버린다.
 *
 * 실측 응답에 허리둘레 1cm, 제자리멀리뛰기 2435cm(24m), BMI 0.6 같은 값이
 * 섞여 있다. 입력 실수나 단위 오류로 보이는데, 그대로 표본에 넣으면 백분위가
 * 통째로 밀린다 — '상위 30%' 가 거짓말이 되는 가장 흔한 경로다.
 */
export const PLAUSIBLE_RANGE: Record<FitnessItem, [number, number]> = {
  vo2max: [10, 90],
  bodyFatPct: [3, 60],
  longJumpCm: [50, 380],
  gripKg: [5, 100],
  waistCm: [40, 160],
};

/**
 * 표본·입력값이 상식 범위 안인지.
 *
 * 모르는 항목이면 false 다. 항목 집합은 실제 API 커버리지에 따라 바뀌는데,
 * 사용자 기기에는 예전 버전에서 저장한 항목이 그대로 남아 있다 — 그걸
 * 그대로 구조분해하면 렌더 중에 터진다(실제로 검사에서 잡혔다).
 */
export function isPlausible(item: FitnessItem, v: number): boolean {
  const range = PLAUSIBLE_RANGE[item];
  if (!range) return false;
  return Number.isFinite(v) && v >= range[0] && v <= range[1];
}

/** 지금 버전이 다루는 항목인지 */
export function isKnownItem(k: string): k is FitnessItem {
  return Object.prototype.hasOwnProperty.call(PLAUSIBLE_RANGE, k);
}

/**
 * 러닝에 얼마나 직결되는지의 가중치.
 *
 * VO₂max 가 달리기 능력을 가장 직접 설명하므로 지배적으로 둔다. 체성분이
 * 다음인데, 같은 심폐능력이라도 체중을 옮기는 비용이 다르기 때문이다.
 * 이 가중치는 우리가 정한 값이지 공단이 준 값이 아니다 — basis 에 밝힌다.
 */
const RUN_WEIGHT: Record<FitnessItem, number> = {
  vo2max: 0.45,
  bodyFatPct: 0.25,
  longJumpCm: 0.12,
  gripKg: 0.1,
  waistCm: 0.08,
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
  /**
   * 항목별 오름차순 백분위 지점(p0~p100).
   * 원본 표본을 다 싣지 않는다 — 분포의 모양만 있으면 백분위는 낼 수 있고,
   * 원본을 통째로 묶으면 파일이 앱 전체보다 커진다.
   */
  samples: Partial<Record<FitnessItem, number[]>>;
  /** 항목별 원본 표본 수 — 신뢰도 판정은 압축본이 아니라 이 값으로 한다 */
  counts?: Partial<Record<FitnessItem, number>>;
  /** 표본 수 */
  n: number;
  /**
   * VO₂max 표본이 어느 검사에서 왔는지 (스텝·트레드밀 건수).
   *
   * 왕복오래달리기는 같은 집단에서 중앙값이 2~3 낮아 눈금이 달라 빼 두었다.
   * 어느 자로 잰 분포인지는 '상위 몇 %' 만큼이나 중요한 정보라 함께 싣는다.
   */
  vo2Methods?: Record<string, number>;
  /** 표본을 모은 기간 (측정연월 기준) */
  period?: { from: string; to: string; months: number } | null;
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
  /**
   * 이 값이 실측인지 앱 추정인지.
   * 화면에서 반드시 구분해 보여 준다 — 추정치를 실측인 척하면,
   * 사용자는 국가 기준으로 진단받았다고 믿는다.
   */
  estimated?: boolean;
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
  /**
   * 앱이 러닝 기록에서 추정한 값 (vo2max.ts).
   * 사용자가 직접 넣은 실측값이 있으면 그쪽이 언제나 이긴다 — 추정은
   * 실측을 대신하는 게 아니라 실측이 없는 사람을 위한 출발점이다.
   */
  estimates: Partial<Record<FitnessItem, number>> = {},
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
  // 실측 + 추정을 합치되, 겹치면 실측이 이긴다
  const merged: Partial<Record<FitnessItem, { v: number; est: boolean }>> = {};
  for (const [k, v] of Object.entries(estimates)) {
    if (isKnownItem(k) && typeof v === 'number' && Number.isFinite(v)) {
      merged[k] = { v, est: true };
    }
  }
  for (const [k, v] of Object.entries(profile.measured)) {
    if (isKnownItem(k) && typeof v === 'number' && Number.isFinite(v)) {
      merged[k] = { v, est: false };
    }
  }
  const measuredKeys = Object.keys(merged) as FitnessItem[];
  if (measuredKeys.length === 0) {
    return none('러닝을 몇 번 기록하거나 체력인증센터 측정값을 넣으면 또래 대비 내 체력을 볼 수 있어요.');
  }
  if (!norm) {
    return none('체력 기준 데이터를 아직 불러오지 못했어요.');
  }

  const items: ItemPercentile[] = [];
  for (const item of measuredKeys) {
    const { v: value, est } = merged[item]!;
    if (!isPlausible(item, value)) continue;
    // 신뢰도는 압축본 길이(101 고정)가 아니라 원본 표본 수로 본다.
    // counts 가 없는 옛 캐시는 압축본 길이로 판정한다(예전과 같은 동작).
    const raw = norm.counts?.[item];
    if (raw != null && raw < MIN_SAMPLES) continue;
    const p = percentileOf(norm.samples[item], value, LOWER_IS_BETTER.has(item));
    if (p != null) items.push({ item, value, percentile: p, estimated: est });
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
 * 처방의 기준점 — 이 세 지점 사이를 이어서 쓴다.
 *
 * 값 자체는 공단이 준 게 아니라 우리가 정한 초기 기준이다(basis 에 밝힌다).
 * 공단 API 의 '운동처방' 필드를 받아오면 그쪽으로 대체하는 게 맞다.
 */
const RX_ANCHORS = [
  { p: 15, minKm: 2, maxKm: 4, perWeek: 3, ascent: 12 },
  { p: 50, minKm: 3, maxKm: 6, perWeek: 3, ascent: 25 },
  { p: 85, minKm: 5, maxKm: 10, perWeek: 4, ascent: 45 },
] as const;

/**
 * 종합 백분위 + 나이 → 러닝 처방.
 *
 * ── 왜 3단계가 아니라 이어진 값인가 ────────────────────────────────────────
 * 예전에는 백분위 34·67 에서 뚝 끊었다. 그런데 기준 분포를 페이스로 환산해
 * 보니 그 경계가 너무 촘촘했다 — 남 30대는 12분 검사 5:11/km 와 4:51/km,
 * 딱 20초 사이에서 처방이 갈렸다. 그 20초를 넘느냐 마느냐로 권장량이
 * 2~4km·주3회에서 5~10km·주4회로 2.5배 뛰었다.
 *
 * 일반 인구의 VO₂max 분포가 좁아서(표준편차 4~5) 작은 기록 차이가 큰 백분위
 * 차이로 증폭되기 때문이다. 바람 부는 날, GPS 오차 한 번, 컨디션 난조 하나로
 * 밴드가 뒤집히는데 사용자에게는 그게 '앱이 갑자기 두 배를 시킨다' 로 보인다.
 *
 * 기준점은 그대로 두고 사이를 이어서 쓴다. 같은 설계 의도인데 절벽만 없앴다.
 *
 * 백분위를 못 낸 경우(null)에는 처방도 하지 않는다. 모르면 모른다고 한다.
 */
export function prescribe(
  overall: number | null,
  age: number | null,
): RunPrescription | null {
  if (overall == null || age == null) return null;

  // 기준점 사이를 선형으로 잇는다. 양 끝 밖은 끝 값으로 고정한다 —
  // 상위 1% 라고 해서 10km 를 넘겨 권하지 않는다(그건 근거가 없는 외삽이다).
  const lerp = (pick: (a: (typeof RX_ANCHORS)[number]) => number): number => {
    const first = RX_ANCHORS[0];
    const last = RX_ANCHORS[RX_ANCHORS.length - 1];
    if (overall <= first.p) return pick(first);
    if (overall >= last.p) return pick(last);
    for (let i = 1; i < RX_ANCHORS.length; i++) {
      const a = RX_ANCHORS[i - 1];
      const b = RX_ANCHORS[i];
      if (overall <= b.p) {
        const t = (overall - a.p) / (b.p - a.p);
        return pick(a) + (pick(b) - pick(a)) * t;
      }
    }
    return pick(last);
  };

  // 나이에 따른 완충 — 같은 백분위라도 60대는 회복이 더 걸린다.
  // (또래 대비 백분위라 이미 나이가 반영돼 있으므로 조정은 작게 둔다)
  const easeOff = age >= 60 ? 0.8 : age >= 50 ? 0.9 : 1;
  const round1 = (v: number) => Math.round(v * 10) / 10;

  return {
    sessionKm: {
      min: round1(lerp((a) => a.minKm) * easeOff),
      max: round1(lerp((a) => a.maxKm) * easeOff),
    },
    // 횟수만은 정수여야 말이 된다 ('주 3.5회' 는 지킬 수 없는 지시다)
    perWeek: Math.round(lerp((a) => a.perWeek)),
    maxAscentPerKm: Math.round(lerp((a) => a.ascent) * easeOff),
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
