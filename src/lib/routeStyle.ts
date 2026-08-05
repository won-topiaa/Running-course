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
  { id: 'hilly', label: '경사 훈련', desc: '빡센 언덕', emoji: '⛰️' },
];

export interface StyleMetrics {
  ascentPerKm: number; //     km당 누적 상승(m)
  undulationPerKm: number; // km당 오르막↔내리막 전환 횟수
  maxGradePct: number;
  flatSharePct: number; //    |경사|<3% 구간의 길이 비율
}

export interface StyleEval {
  style: RunStyle;
  score: number; // 0~1
  metrics: StyleMetrics;
  reason: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function computeMetrics(route: RouteResult): StyleMetrics {
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
  let score = 0;
  let reason = '';

  switch (style) {
    case 'flat': {
      const lowAscent = clamp01(1 - m.ascentPerKm / 22);
      const flatness = clamp01(m.flatSharePct / 90);
      score = 0.6 * lowAscent + 0.4 * flatness;
      reason = `누적 상승 ${m.ascentPerKm.toFixed(0)}m/km, 평지 비율 ${m.flatSharePct.toFixed(0)}% — 일정한 페이스에 좋아요.`;
      break;
    }
    case 'gentle': {
      // 완만: km당 상승 12~20m 부근이 최적
      const target = 16;
      score = clamp01(1 - Math.abs(m.ascentPerKm - target) / 22);
      reason = `누적 상승 ${m.ascentPerKm.toFixed(0)}m/km로 부담 없이 살짝 기복 있는 코스예요.`;
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
      reason = `누적 상승 ${m.ascentPerKm.toFixed(0)}m/km, 최대 경사 ${m.maxGradePct.toFixed(1)}% — 언덕 훈련에 제격.`;
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
