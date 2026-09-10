import data from '../data/testCounts.json';

export interface YearlyTrend {
  year: number;
  totalTests: number;
  centers: number;
}

export interface SeoulCenter {
  name: string;
  address: string;
  totalTests: number;
}

export interface TestCountData {
  source: string;
  /** 마지막으로 집계된 측정 연월 (YYYYMM) */
  latestMonth: string;
  /** 개방 데이터에 들어 있는 전체 행 수 */
  totalInApi: number;
  /** 2010년 이후 누적 측정 건수 */
  totalMeasurements: number;
  yearlyTrend: YearlyTrend[];
  seoulCenters: SeoulCenter[];
}

const raw = data as unknown as Record<string, unknown>;

/**
 * unknown 을 화면에 쓸 문자열로. String() 을 그냥 부르면 객체가 왔을 때
 * '[object Object]' 가 조용히 화면에 찍힌다 — 그건 값이 아니라 사고다.
 * 문자열·숫자만 받아들이고 나머지는 빈 문자열로 떨어뜨린다.
 */
function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

const parsed: TestCountData = {
  source: asText(raw.source),
  latestMonth: asText(raw.latestMonth),
  totalInApi: Number(raw.totalInApi ?? 0),
  totalMeasurements: Number(raw.totalMeasurements ?? 0),
  yearlyTrend: (raw.yearlyTrend ?? []) as YearlyTrend[],
  seoulCenters: (raw.seoulCenters ?? []) as SeoulCenter[],
};

export function getTestCountData(): TestCountData {
  return parsed;
}

/** 가장 최근 완결 연도. 데이터가 비면 null — 화면이 통째로 빠진다 */
export function latestYear(): YearlyTrend | null {
  return parsed.yearlyTrend[parsed.yearlyTrend.length - 1] ?? null;
}

export function recentTrend(years = 5): YearlyTrend[] {
  return parsed.yearlyTrend.slice(-years);
}

/** 첫 해 대비 마지막 해 증가율(%) */
export function growthRate(): number {
  const trend = parsed.yearlyTrend;
  if (trend.length < 2) return 0;
  const first = trend[0];
  const last = trend[trend.length - 1];
  if (first.totalTests === 0) return 0;
  return ((last.totalTests - first.totalTests) / first.totalTests) * 100;
}

/** 측정 건수가 가장 많은 서울 센터 순 */
export function topSeoulCenters(n = 5): SeoulCenter[] {
  return [...parsed.seoulCenters]
    .sort((a, b) => b.totalTests - a.totalTests)
    .slice(0, n);
}

export function seoulTotalTests(): number {
  return parsed.seoulCenters.reduce((sum, c) => sum + c.totalTests, 0);
}

export function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}천`;
  return String(n);
}
