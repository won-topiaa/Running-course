// ---------------------------------------------------------------------------
// 러닝 스타일 점수화
// 사용자가 원하는 경사 스타일(평지 / 완만 / 오르막내리막 / 경사)과
// 생성된 경로의 고도 프로파일이 얼마나 맞는지 채점한다.
// ---------------------------------------------------------------------------

import type { RouteResult } from './routing';

export type RunStyle = 'flat' | 'gentle' | 'rolling' | 'hilly';

export const RUN_STYLES: {
  id: RunStyle;
  label: string;
  desc: string;
  emoji: string;
}[] = [
  { id: 'flat', label: '평지 위주', desc: '일정한 페이스로 편하게', emoji: '🛣️' },
  { id: 'gentle', label: '완만한 언덕', desc: '살짝 기복 있게', emoji: '🌿' },
  { id: 'rolling', label: '오르막내리막', desc: '굴곡 반복', emoji: '🌊' },
  { id: 'hilly', label: '언덕 훈련', desc: '빡센 언덕', emoji: '⛰️' },
];

/**
 * 화면에 실제로 내놓는 선택지.
 *
 * '오르막내리막'과 '경사 훈련'은 사용자가 보기에 둘 다 "언덕 있는 코스"라
 * 무엇이 다른지 설명 없이는 구분이 안 됐다. 고르는 축을 셋(평지 / 완만 /
 * 언덕)으로 줄인다. rolling 은 타입에서 빼지 않고 목록에만 안 넣는다 —
 * 이미 rolling 으로 저장된 기록의 이름표를 RUN_STYLES 로 계속 찾아야 한다.
 */
export const RUN_STYLE_CHOICES = RUN_STYLES.filter((s) => s.id !== 'rolling');

export interface StyleMetrics {
  ascentPerKm: number; //     km당 누적 상승(m)
  undulationPerKm: number; // km당 오르막↔내리막 전환 횟수
  maxGradePct: number;
  flatSharePct: number; //    |경사|<3% 구간의 길이 비율
}

export interface StyleEval {
  style: RunStyle;
  /** 0~1 — 고도를 못 받았으면 null (호출측이 이 축을 빼고 계산한다) */
  score: number | null;
  metrics: StyleMetrics;
  reason: string;
}

// --- 두 번째 취향 축: 길 성격 -------------------------------------------------
//
// 경사만으로는 한국에서 "어디를 뛸까"의 절반밖에 못 고른다. 대로변 5km 와
// 천변 산책로 5km 는 고도가 같아도 완전히 다른 러닝이다 — 신호등에 몇 번
// 걸리는지, 여름에 가로수 그늘이 있는지, 노면이 무릎에 어떤지가 다르다.
// ORS 가 같이 주는 waytype/surface 로 이걸 점수화한다 (wayMix.ts).

export type PathPref = 'any' | 'trail' | 'soft';

export const PATH_PREFS: { id: PathPref; label: string; desc: string; emoji: string }[] = [
  { id: 'any', label: '상관없음', desc: '길 종류는 따지지 않아요', emoji: '🧭' },
  {
    id: 'trail',
    label: '산책로 위주',
    desc: '신호등에 덜 걸리고 여름엔 가로수 그늘이 있어요',
    emoji: '🌳',
  },
  { id: 'soft', label: '흙길·트레일', desc: '포장 대신 흙·자갈 노면으로', emoji: '🍂' },
];

export interface PathEval {
  pref: PathPref;
  /** 0~1 — 정보를 모르면(OSRM·오프라인) null */
  score: number | null;
  reason: string | null;
}

/**
 * 길 성격 점수. way 정보가 없으면 null 을 돌려주고, 호출측은 이 축을
 * 아예 빼고 계산한다 — 모르는 걸 0점으로 두면 폴백 경로가 부당하게 밀린다.
 */
export function evaluatePath(route: RouteResult, pref: PathPref): PathEval {
  const w = route.way;
  if (pref === 'any') return { pref, score: null, reason: null };
  if (!w) return { pref, score: null, reason: null };

  if (pref === 'trail') {
    // 비율을 먼저 0~1 로 누른 뒤에 계단을 깎는다. 순서를 바꾸면 보행자 길이
    // 80% 를 넘는 순간 감점이 clamp 에 먹혀 사라진다(계단 120m 가 무시됐다).
    const base = clamp01(w.trailPct / 80);
    const stepPenalty = clamp01(w.stepsM / 300) * 0.35;
    const score = clamp01(base - stepPenalty);
    const reason =
      w.trailPct >= 60
        ? `보행자 길이 ${w.trailPct}% — 신호등에 거의 안 걸려요.`
        : w.trailPct >= 30
          ? `보행자 길 ${w.trailPct}%, 차도 옆 ${w.roadPct}% 가 섞여 있어요.`
          : `차도 옆이 ${w.roadPct}% 라 신호등에 자주 걸릴 수 있어요.`;
    return { pref, score, reason };
  }

  // soft: 흙·자갈 노면 비율
  const score = clamp01(w.softPct / 45);
  const reason =
    w.softPct >= 30
      ? `흙·자갈 노면이 ${w.softPct}% — 무릎에 부담이 덜해요.`
      : w.softPct >= 10
        ? `흙길이 ${w.softPct}% 섞여 있어요.`
        : '거의 포장길이에요.';
  return { pref, score, reason };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function computeMetrics(route: RouteResult): StyleMetrics {
  const totalM = route.distanceKm * 1000 || 1;
  let flatLen = 0;
  let transitions = 0;
  let prevSign = 0;
  for (const seg of route.segments) {
    if (Math.abs(seg.gradePct) < 3) flatLen += seg.lengthM;
    const sign = seg.gradePct > 1 ? 1 : seg.gradePct < -1 ? -1 : 0;
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) transitions++;
    if (sign !== 0) prevSign = sign;
  }
  return {
    ascentPerKm: route.ascentM / (route.distanceKm || 1),
    undulationPerKm: transitions / (route.distanceKm || 1),
    maxGradePct: route.maxGradePct,
    flatSharePct: (flatLen / totalM) * 100,
  };
}

export function evaluateStyle(route: RouteResult, style: RunStyle): StyleEval {
  const m = computeMetrics(route);
  // 고도를 못 받은 경로는 전부 평평해 보인다. 그대로 채점하면 '평지 위주'가
  // 만점을 받고 '언덕 훈련'이 0점을 받는데, 둘 다 근거 없는 점수다.
  // 길 성격(evaluatePath)과 같은 규칙으로 이 축을 아예 뺀다.
  if (route.elevationKnown === false) {
    return { style, score: null, metrics: m, reason: '이 코스는 지형 고도를 받지 못했어요.' };
  }
  let score = 0;
  let reason = '';

  switch (style) {
    case 'flat': {
      const lowAscent = clamp01(1 - m.ascentPerKm / 22);
      const flatness = clamp01(m.flatSharePct / 90);
      score = 0.6 * lowAscent + 0.4 * flatness;
      reason = `1km당 오르막 ${m.ascentPerKm.toFixed(0)}m, 평지 비율 ${m.flatSharePct.toFixed(0)}% — 일정한 페이스에 좋아요.`;
      break;
    }
    case 'gentle': {
      // 완만: km당 상승 12~20m 부근이 최적
      const target = 16;
      score = clamp01(1 - Math.abs(m.ascentPerKm - target) / 22);
      reason = `1km당 오르막 ${m.ascentPerKm.toFixed(0)}m로 부담 없이 살짝 기복 있는 코스예요.`;
      break;
    }
    case 'rolling': {
      const undul = clamp01(m.undulationPerKm / 5);
      const moderate = clamp01(m.ascentPerKm / 30);
      score = 0.7 * undul + 0.3 * moderate;
      reason = `km당 오르막·내리막이 약 ${m.undulationPerKm.toFixed(1)}회 반복돼 굴곡 있는 코스예요.`;
      break;
    }
    case 'hilly': {
      const climb = clamp01(m.ascentPerKm / 45);
      const steep = clamp01(m.maxGradePct / 12);
      score = 0.6 * climb + 0.4 * steep;
      reason = `1km당 오르막 ${m.ascentPerKm.toFixed(0)}m, 최대 경사 ${m.maxGradePct.toFixed(1)}% — 언덕 훈련에 제격.`;
      break;
    }
  }

  return { style, score: clamp01(score), metrics: m, reason };
}

// --- 경사 색상 밴드 (지도 폴리라인 / 고도 차트 공용) --------------------------

export type GradeBand = 'down-steep' | 'down' | 'flat' | 'up' | 'up-steep';

export function gradeBand(gradePct: number): GradeBand {
  if (gradePct <= -8) return 'down-steep';
  if (gradePct <= -3) return 'down';
  if (gradePct < 3) return 'flat';
  if (gradePct < 8) return 'up';
  return 'up-steep';
}

export const GRADE_COLORS: Record<GradeBand, string> = {
  'down-steep': '#3B82F6', // 급한 내리막 (파랑)
  down: '#60C6C0', //         내리막 (청록)
  flat: '#7A9A8B', //         평지 (세이지)
  up: '#FF9E5E', //           오르막 (연코랄)
  'up-steep': '#EF5A3C', //   급한 오르막 (진코랄)
};

export const GRADE_LEGEND: { band: GradeBand; label: string }[] = [
  { band: 'down-steep', label: '급내리막' },
  { band: 'down', label: '내리막' },
  { band: 'flat', label: '평지' },
  { band: 'up', label: '오르막' },
  { band: 'up-steep', label: '급오르막' },
];
