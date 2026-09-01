import data from '../data/testCounts.json';

export interface YearlyTrend {
  year: number;
  totalTests: number;
  centers: number;
}

export interface AgeDistribution {
  ageGroup: string;
  percentage: number;
}

export interface SeoulCenter {
  name: string;
  district: string;
  lat: number;
  lng: number;
  yearlyTests: number;
}

export interface TestCountData {
  source: string;
  seed: boolean;
  yearlyTrend: YearlyTrend[];
  ageDistribution: AgeDistribution[];
  seoulCenters: SeoulCenter[];
}

const parsed: TestCountData = {
  source: data.source,
  seed: (data as Record<string, unknown>).seed === true,
  yearlyTrend: data.yearlyTrend as YearlyTrend[],
  ageDistribution: data.ageDistribution as AgeDistribution[],
  seoulCenters: data.seoulCenters as SeoulCenter[],
};

export function getTestCountData(): TestCountData {
  return parsed;
}

export function isSeedData(): boolean {
  return parsed.seed;
}

export function latestYear(): YearlyTrend {
  return parsed.yearlyTrend[parsed.yearlyTrend.length - 1];
}

export function recentTrend(years = 5): YearlyTrend[] {
  return parsed.yearlyTrend.slice(-years);
}

export function growthRate(): number {
  const trend = parsed.yearlyTrend;
  if (trend.length < 2) return 0;
  const first = trend[0];
  const last = trend[trend.length - 1];
  return ((last.totalTests - first.totalTests) / first.totalTests) * 100;
}

export function peakAgeGroup(): AgeDistribution {
  return parsed.ageDistribution.reduce((a, b) =>
    b.percentage > a.percentage ? b : a,
  );
}

export function seoulTotalTests(): number {
  return parsed.seoulCenters.reduce((sum, c) => sum + c.yearlyTests, 0);
}

export function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}천`;
  return String(n);
}
