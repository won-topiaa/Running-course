// ---------------------------------------------------------------------------
// 마이 페이지 통계 — 실제 기록(SavedRoute, kind='recorded')에서 전부 계산한다.
// 샘플 숫자 없음: 기록이 없으면 0 / 빈 상태를 그대로 보여준다.
// ---------------------------------------------------------------------------

import type { SavedRoute } from './savedRoutes';

export interface WeekdayKm {
  label: string; // 월~일
  km: number;
}

export interface RunStats {
  runCount: number;
  totalKm: number;
  weekKm: number; //          이번 주(월~일) 합계
  weekly: WeekdayKm[]; //     이번 주 요일별
  streakDays: number; //      오늘(또는 어제)까지 연속 러닝 일수
  longestKm: number; //       한 번에 가장 멀리
  firstRunAt: number | null;
  monthsTogether: number; //  첫 기록 이후 개월 수(최소 1)
  runsPerWeekRecent: number; // 최근 4주 주당 평균 횟수
}

const DAY = 24 * 60 * 60 * 1000;
const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/**
 * 날짜를 n일 옮긴 자정. `t - n*DAY` 로 계산하면 서머타임이 있는 지역에서
 * 하루가 23/25시간이라 같은 날을 두 번 세거나 하루를 건너뛴다.
 * 달력 기준으로 옮기면 그 문제가 없다 (한국은 무관하지만 해외 러너도 쓴다).
 */
function midnightShift(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

/** 이번 주 월요일 00:00 (로컬) */
function mondayStart(now: Date): number {
  const dow = (now.getDay() + 6) % 7; // 월=0
  return midnightShift(now, -dow).getTime();
}

export function computeRunStats(routes: SavedRoute[], now = new Date()): RunStats {
  const runs = routes
    .filter((r) => r.kind === 'recorded')
    .sort((a, b) => a.createdAt - b.createdAt);

  const totalKm = runs.reduce((s, r) => s + r.distanceKm, 0);
  const longestKm = runs.reduce((m, r) => Math.max(m, r.distanceKm), 0);
  const firstRunAt = runs[0]?.createdAt ?? null;

  // 이번 주 요일별
  const weekStart = mondayStart(now);
  const weekly: WeekdayKm[] = ['월', '화', '수', '목', '금', '토', '일'].map((label) => ({
    label,
    km: 0,
  }));
  let weekKm = 0;
  const weekEnd = midnightShift(now, 7 - ((now.getDay() + 6) % 7)).getTime();
  for (const r of runs) {
    if (r.createdAt >= weekStart && r.createdAt < weekEnd) {
      const idx = (new Date(r.createdAt).getDay() + 6) % 7; // 월=0
      weekly[idx].km += r.distanceKm;
      weekKm += r.distanceKm;
    }
  }

  // 연속 일수: 오늘부터 거꾸로. 오늘 안 뛰었으면 어제부터 세어준다(아직 안 끊긴 것으로).
  const runDays = new Set(runs.map((r) => dayKey(r.createdAt)));
  let streakDays = 0;
  let offset = runDays.has(dayKey(midnightShift(now, 0).getTime())) ? 0 : -1;
  while (runDays.has(dayKey(midnightShift(now, offset).getTime()))) {
    streakDays++;
    offset--;
  }

  const monthsTogether = firstRunAt
    ? Math.max(1, Math.round((now.getTime() - firstRunAt) / (30 * DAY)))
    : 0;
  // 시작한 지 2주밖에 안 된 사람을 4로 나누면 실제 빈도의 절반으로 보인다.
  // 실제로 관찰된 기간(최대 4주)으로 나눈다.
  const recent = runs.filter((r) => r.createdAt >= now.getTime() - 28 * DAY).length;
  const observedWeeks = firstRunAt
    ? Math.min(4, Math.max(1, (now.getTime() - firstRunAt) / (7 * DAY)))
    : 4;

  return {
    runCount: runs.length,
    totalKm,
    weekKm,
    weekly,
    streakDays,
    longestKm,
    firstRunAt,
    monthsTogether,
    runsPerWeekRecent: recent / observedWeeks,
  };
}

export interface Badge {
  emoji: string;
  label: string;
}

/** 실제 기록에서 획득한 배지만 돌려준다 */
export function earnedBadges(routes: SavedRoute[], stats: RunStats): Badge[] {
  const runs = routes.filter((r) => r.kind === 'recorded');
  const out: Badge[] = [];
  if (stats.runCount >= 1) out.push({ emoji: '🏁', label: '첫 러닝' });
  if (runs.some((r) => new Date(r.createdAt).getHours() < 7))
    out.push({ emoji: '🌅', label: '새벽 러너' });
  if (stats.streakDays >= 3) out.push({ emoji: '🔥', label: `${stats.streakDays}일 연속` });
  if (stats.longestKm >= 10) out.push({ emoji: '🔟', label: '10km 한 번에' });
  else if (stats.longestKm >= 5) out.push({ emoji: '5️⃣', label: '5km 한 번에' });
  if (stats.totalKm >= 100) out.push({ emoji: '💯', label: '누적 100km' });
  else if (stats.totalKm >= 50) out.push({ emoji: '🎽', label: '누적 50km' });
  if (routes.some((r) => r.kind === 'built')) out.push({ emoji: '🗺️', label: '코스 메이커' });
  return out;
}

/** 프로필 한 줄: 최근 활동 빈도 기반 */
export function levelLabel(stats: RunStats): string {
  if (stats.runCount === 0) return '첫 러닝을 기다리는 중';
  const w = stats.runsPerWeekRecent;
  if (w >= 5) return '매일 뛰는 러너';
  if (w >= 1) return `주 ${Math.round(w)}회 러너`;
  if (w > 0) return '천천히 쌓는 중';
  return '다시 시동 거는 중';
}
