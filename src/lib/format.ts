// ---------------------------------------------------------------------------
// 페이스·시간·거리 포맷 헬퍼 (러너용 계산)
// ---------------------------------------------------------------------------

/** 초 → "m'ss\"" (페이스 표기) */
export function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${s.toString().padStart(2, '0')}"`;
}

/** 초 → "1시간 12분" / "34분" / "5분 20초" */
export function formatDuration(totalSec: number): string {
  const sec = Math.round(totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return s > 0 && m < 10 ? `${m}분 ${s}초` : `${m}분`;
  return `${s}초`;
}

/** 거리(km) × 페이스(초/km) → 예상 소요 시간(초) */
export function estimateSeconds(distanceKm: number, paceSecPerKm: number): number {
  return distanceKm * paceSecPerKm;
}

/** 거리 + 페이스 → "34분" */
export function estimateTimeLabel(distanceKm: number, paceSecPerKm: number): string {
  return formatDuration(estimateSeconds(distanceKm, paceSecPerKm));
}

/** 거리(km) → "3.5km" / "820m" */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(km < 10 ? 2 : 1).replace(/\.0$/, '')}km`;
}

/** 대략적인 소모 칼로리 (체중 62kg 가정, kcal ≈ 0.9 × kg × km) */
export function estimateCalories(distanceKm: number, weightKg = 62): number {
  return Math.round(0.9 * weightKg * distanceKm);
}
