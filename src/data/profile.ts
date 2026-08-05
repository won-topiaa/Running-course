// ---------------------------------------------------------------------------
// 마이 페이지 샘플 데이터 — 러너 프로필/기록/러닝화 마일리지
// ---------------------------------------------------------------------------

export interface Shoe {
  name: string;
  mileageKm: number;
  limitKm: number; // 교체 권장 마일리지
  emoji: string;
}

export interface WeeklyStat {
  label: string; // 요일
  km: number;
}

export interface RunnerProfile {
  name: string;
  emoji: string;
  level: string;
  joinedMonths: number;
  weekKm: number;
  weekGoalKm: number;
  totalKm: number;
  streakDays: number;
  courseVariety: number; // 다녀온 서로 다른 코스 수
  weekly: WeeklyStat[];
  shoes: Shoe[];
  badges: { emoji: string; label: string }[];
}

export const PROFILE: RunnerProfile = {
  name: '러너',
  emoji: '🏃',
  level: '주 3회 러너',
  joinedMonths: 8,
  weekKm: 22.4,
  weekGoalKm: 30,
  totalKm: 812,
  streakDays: 5,
  courseVariety: 11,
  weekly: [
    { label: '월', km: 0 },
    { label: '화', km: 5.2 },
    { label: '수', km: 0 },
    { label: '목', km: 6.0 },
    { label: '금', km: 3.4 },
    { label: '토', km: 7.8 },
    { label: '일', km: 0 },
  ],
  shoes: [
    { name: '페가수스 41', mileageKm: 486, limitKm: 700, emoji: '👟' },
    { name: '엔돌핀 스피드', mileageKm: 132, limitKm: 600, emoji: '⚡' },
  ],
  badges: [
    { emoji: '🌅', label: '새벽 러너' },
    { emoji: '🔥', label: '5일 연속' },
    { emoji: '🗺️', label: '코스 탐험가' },
    { emoji: '⛰️', label: '언덕 정복' },
  ],
};
