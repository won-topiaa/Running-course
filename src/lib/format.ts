// ---------------------------------------------------------------------------
// 페이스·시간·거리 포맷 헬퍼 (러너용 계산)
// ---------------------------------------------------------------------------

/**
 * 사람이 달리거나 걸어서 낼 수 있는 페이스의 범위(초/km).
 *
 * 아래(90초=1'30"/km)는 세계기록보다 빠르고, 위(1800초=30'00"/km)는 아주
 * 느린 걷기보다도 느리다. 이 밖의 값은 계산이 틀린 것이지 기록이 아니다 —
 * 거리가 아직 몇 m 뿐인데 시간만 흐른 순간(시작 직후)이 대표적이다.
 */
export const PACE_MIN_SEC = 90;
export const PACE_MAX_SEC = 1800;

/**
 * 화면에 내놔도 되는 페이스인지 거른다. 아니면 null → 화면은 '--' 를 쓴다.
 * 없는 값을 억지로 숫자로 보여주면 사용자는 그걸 자기 기록으로 믿는다.
 */
export function sanePace(secPerKm: number | null | undefined): number | null {
  if (secPerKm == null || !Number.isFinite(secPerKm)) return null;
  if (secPerKm < PACE_MIN_SEC || secPerKm > PACE_MAX_SEC) return null;
  return secPerKm;
}

/**
 * 초 → "m'ss\"" (페이스 표기).
 *
 * 이상한 값이 들어오면 '--' 로 내보낸다. 예전엔 아무 방어가 없어서
 * NaN 이 들어오면 화면에 그대로 "NaN'NaN\"" 이 찍혔고(0으로 나누기·빈
 * 배열 접근에서 실제로 발생), 음수면 "-1'-5\"" 가 나왔다.
 */
export function formatPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '--';
  // 먼저 초 단위로 반올림한 뒤 분/초로 나눈다. 나눈 다음에 반올림하면
  // 179.6초가 2'60" 처럼 나온다 (60초는 표기상 존재할 수 없다).
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
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

/**
 * 흐르는 시계용 포맷 — "07:42" / "1:02:15".
 * `formatDuration` 은 "7분 42초"처럼 읽기 좋지만 매 초 글자 수가 바뀌어
 * 러닝 중 화면에서 숫자가 덜컹거린다. 실시간 타이머에는 이쪽을 쓴다.
 */
export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
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

