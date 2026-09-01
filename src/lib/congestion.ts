import type { LatLng } from './types';

export type CongestionLevel = 'low' | 'moderate' | 'high' | 'very-high';

export interface CongestionEstimate {
  level: CongestionLevel;
  score: number;
  label: string;
  suggestion: string | null;
  bestHours: number[];
}

interface HotZone {
  center: LatLng;
  radiusM: number;
  baseDensity: number;
  name: string;
}

const HOT_ZONES: HotZone[] = [
  { center: [37.4979, 127.0276], radiusM: 800, baseDensity: 0.95, name: '강남역' },
  { center: [37.5563, 126.9237], radiusM: 600, baseDensity: 0.90, name: '홍대입구' },
  { center: [37.5660, 126.9784], radiusM: 500, baseDensity: 0.85, name: '광화문' },
  { center: [37.5636, 126.9830], radiusM: 400, baseDensity: 0.82, name: '종각' },
  { center: [37.5610, 127.0340], radiusM: 500, baseDensity: 0.80, name: '건대입구' },
  { center: [37.5116, 127.0598], radiusM: 500, baseDensity: 0.78, name: '잠실' },
  { center: [37.5547, 126.9707], radiusM: 400, baseDensity: 0.80, name: '시청' },
  { center: [37.5283, 126.9294], radiusM: 600, baseDensity: 0.75, name: '여의도' },
  { center: [37.5044, 127.0247], radiusM: 400, baseDensity: 0.82, name: '교대/서초' },
  { center: [37.4844, 127.0343], radiusM: 500, baseDensity: 0.78, name: '양재' },
  { center: [37.5140, 127.1005], radiusM: 400, baseDensity: 0.72, name: '송파' },
  { center: [37.6511, 127.0560], radiusM: 500, baseDensity: 0.70, name: '노원' },
  { center: [37.5445, 126.8372], radiusM: 500, baseDensity: 0.68, name: '목동' },
  { center: [37.5596, 126.9427], radiusM: 500, baseDensity: 0.72, name: '마포' },
  { center: [37.5401, 126.9942], radiusM: 600, baseDensity: 0.65, name: '이태원/한남' },
];

const QUIET_ZONES: { center: LatLng; radiusM: number; quietFactor: number }[] = [
  { center: [37.5284, 126.9344], radiusM: 1200, quietFactor: 0.25 },
  { center: [37.5665, 126.9693], radiusM: 500, quietFactor: 0.20 },
  { center: [37.5480, 127.0448], radiusM: 800, quietFactor: 0.30 },
  { center: [37.5208, 127.1214], radiusM: 1000, quietFactor: 0.20 },
  { center: [37.5088, 127.0628], radiusM: 600, quietFactor: 0.30 },
  { center: [37.5520, 126.9720], radiusM: 500, quietFactor: 0.25 },
  { center: [37.5700, 126.9680], radiusM: 500, quietFactor: 0.30 },
  { center: [37.5680, 127.0080], radiusM: 400, quietFactor: 0.30 },
  { center: [37.5135, 127.1025], radiusM: 800, quietFactor: 0.25 },
  { center: [37.6455, 127.0113], radiusM: 1500, quietFactor: 0.15 },
  { center: [37.6572, 127.0520], radiusM: 1000, quietFactor: 0.20 },
];

const TIME_MULTIPLIERS: Record<number, number> = {
  0: 0.15, 1: 0.10, 2: 0.08, 3: 0.08, 4: 0.10, 5: 0.15,
  6: 0.25, 7: 0.45, 8: 0.80, 9: 0.90,
  10: 0.65, 11: 0.60,
  12: 0.85, 13: 0.80,
  14: 0.60, 15: 0.55, 16: 0.60,
  17: 0.85, 18: 0.95, 19: 0.80,
  20: 0.60, 21: 0.45, 22: 0.35, 23: 0.25,
};

const WEEKEND_SCALE = 0.7;

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

function quickDist(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function baseDensityAt(pt: LatLng): number {
  let maxHot = 0.35;
  for (const z of HOT_ZONES) {
    const d = quickDist(pt, z.center);
    if (d < z.radiusM) {
      const ratio = 1 - d / z.radiusM;
      const density = z.baseDensity * ratio;
      if (density > maxHot) maxHot = density;
    }
  }

  let quietest = 1;
  for (const z of QUIET_ZONES) {
    const d = quickDist(pt, z.center);
    if (d < z.radiusM) {
      const ratio = 1 - d / z.radiusM;
      const factor = 1 - (1 - z.quietFactor) * ratio;
      if (factor < quietest) quietest = factor;
    }
  }

  return Math.max(0, Math.min(1, maxHot * quietest));
}

function timeMultiplier(hour: number, isWeekend: boolean): number {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const m = TIME_MULTIPLIERS[h] ?? 0.5;
  return isWeekend ? m * WEEKEND_SCALE : m;
}

export function estimateCongestion(
  path: LatLng[],
  hour = new Date().getHours(),
  isWeekend = [0, 6].includes(new Date().getDay()),
): CongestionEstimate {
  if (path.length === 0) {
    return { level: 'low', score: 0, label: '정보 없음', suggestion: null, bestHours: [] };
  }

  const step = Math.max(1, Math.floor(path.length / 15));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < path.length; i += step) {
    sum += baseDensityAt(path[i]);
    count++;
  }
  const avgBase = sum / count;
  const timeMul = timeMultiplier(hour, isWeekend);
  const score = Math.min(1, avgBase * timeMul);

  const level = toLevel(score);
  const label = LEVEL_LABELS[level];

  const bestHours = findBestHours(avgBase, isWeekend);
  const suggestion = makeSuggestion(level, bestHours, hour);

  return { level, score, label, suggestion, bestHours };
}

export function estimateCongestionAtPoint(
  center: LatLng,
  hour = new Date().getHours(),
  isWeekend = [0, 6].includes(new Date().getDay()),
): CongestionEstimate {
  return estimateCongestion([center], hour, isWeekend);
}

function toLevel(score: number): CongestionLevel {
  if (score < 0.2) return 'low';
  if (score < 0.4) return 'moderate';
  if (score < 0.65) return 'high';
  return 'very-high';
}

const LEVEL_LABELS: Record<CongestionLevel, string> = {
  low: '한적해요',
  moderate: '보통이에요',
  high: '혼잡해요',
  'very-high': '매우 혼잡해요',
};

export const LEVEL_COLORS: Record<CongestionLevel, string> = {
  low: '#7A9A8B',
  moderate: '#E8A753',
  high: '#EF7A3C',
  'very-high': '#EF5A3C',
};

function findBestHours(avgBase: number, isWeekend: boolean): number[] {
  const scored: { h: number; s: number }[] = [];
  for (let h = 5; h <= 22; h++) {
    const s = avgBase * timeMultiplier(h, isWeekend);
    scored.push({ h, s });
  }
  scored.sort((a, b) => a.s - b.s);
  return scored.slice(0, 3).map((x) => x.h);
}

function makeSuggestion(
  level: CongestionLevel,
  bestHours: number[],
  currentHour: number,
): string | null {
  if (level === 'low') return null;
  if (bestHours.length === 0) return null;

  if (bestHours.includes(currentHour)) return null;

  const fmt = (h: number) => (h < 12 ? `오전 ${h}시` : h === 12 ? '낮 12시' : `오후 ${h - 12}시`);
  const early = bestHours.filter((h) => h < 9);
  const evening = bestHours.filter((h) => h >= 19);

  if (early.length > 0 && evening.length > 0) {
    return `이른 아침(${fmt(early[0])}) 또는 저녁(${fmt(evening[0])})이 한적해요.`;
  }
  if (early.length > 0) {
    return `이른 아침 ${fmt(early[0])}경이 가장 한적해요.`;
  }
  return `${fmt(bestHours[0])}경이 가장 한적해요.`;
}
