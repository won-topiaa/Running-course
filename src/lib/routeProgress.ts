// ---------------------------------------------------------------------------
// 계획 경로 따라 뛰기 — 어디까지 왔는지 추적
//
// 러너의 현재 위치가 계획 경로의 어느 지점까지 왔는지를 '되돌아가지 않는' 인덱스로
// 관리한다. 지나온 구간은 경사 색상으로, 남은 구간은 눈금(점선)으로 그리기 위한 값.
// ---------------------------------------------------------------------------

import { haversineMeters } from './geo';
import type { LatLng } from './types';

/** 이 거리 안으로 들어오면 그 지점을 '지났다'고 본다 (GPS 오차 감안) */
const REACH_M = 35;
/** 한 번에 앞으로 볼 최대 지점 수 — 경로가 교차해도 엉뚱하게 건너뛰지 않게 */
const LOOKAHEAD = 60;

/**
 * 현재 위치로 진행 인덱스를 갱신한다.
 * 항상 앞으로만 이동하므로 경로가 자기 자신과 겹쳐도 뒤로 튀지 않는다.
 */
export function advanceProgress(
  planned: LatLng[],
  current: LatLng,
  prevIdx: number,
): number {
  let idx = prevIdx;
  const limit = Math.min(planned.length - 1, prevIdx + LOOKAHEAD);
  for (let i = prevIdx; i <= limit; i++) {
    if (haversineMeters(planned[i], current) <= REACH_M) idx = i;
  }
  return idx;
}

/** 계획 경로에서 남은 거리(m) */
export function remainingMeters(planned: LatLng[], idx: number): number {
  let m = 0;
  for (let i = Math.max(idx, 0) + 1; i < planned.length; i++) {
    m += haversineMeters(planned[i - 1], planned[i]);
  }
  return m;
}

/**
 * 진행률 0~1 — 점 개수가 아니라 실제 거리 기준.
 *
 * 경로 좌표는 균등 간격이 아니다(굽은 길은 촘촘, 직선은 성김). 인덱스 비율을
 * 쓰면 같은 화면의 '남은 N km'(거리 기준)와 어긋난다 — 실측: 한강 횡단 경로에서
 * 최대 11%p 차이.
 */
export function progressRatio(planned: LatLng[], idx: number): number {
  if (planned.length < 2) return 0;
  const i = Math.max(0, Math.min(idx, planned.length - 1));
  let done = 0;
  let total = 0;
  for (let k = 1; k < planned.length; k++) {
    const seg = haversineMeters(planned[k - 1], planned[k]);
    total += seg;
    if (k <= i) done += seg;
  }
  return total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
}
