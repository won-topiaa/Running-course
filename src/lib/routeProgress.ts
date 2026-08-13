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
 *
 * 창 안에서 '마지막으로 닿은 점'이 아니라 '첫 번째로 연속으로 닿는 구간에서
 * 가장 가까운 점'을 고른다. 왕복 코스는 가는 길과 오는 길 좌표가 같은 자리에
 * 겹치는데, 마지막 점을 고르면 반환점 앞 수백 m 에서 돌아오는 쪽 쌍둥이 점이
 * 창에 들어오는 순간 그리로 건너뛴다 — 실측: 3km 왕복에서 한 틱에 1200m 전진,
 * 남은 거리가 순간 붕괴하고 km 음성 안내가 몰아서 터졌다. 첫 구간에서 멈추면
 * 가는 쪽 점(닿는 점들 사이에 틈이 있어 쌍둥이와 이어지지 않는다)에 붙고,
 * 반환점 근처에서는 두 쪽이 실제로 한 구간으로 이어지므로 자연스럽게 넘어간다.
 */
export function advanceProgress(
  planned: LatLng[],
  current: LatLng,
  prevIdx: number,
): number {
  const limit = Math.min(planned.length - 1, prevIdx + LOOKAHEAD);
  for (let i = prevIdx; i <= limit; i++) {
    if (haversineMeters(planned[i], current) > REACH_M) continue;
    // 첫 번째로 닿는 점을 찾았다 — 연속으로 닿는 동안만 더 나아가며 가장
    // 가까운 점을 고른다 (한 점 뒤에서 멈추는 지연 방지)
    let best = i;
    let bestD = haversineMeters(planned[i], current);
    for (let j = i + 1; j <= limit; j++) {
      const d = haversineMeters(planned[j], current);
      if (d > REACH_M) break;
      if (d < bestD) {
        best = j;
        bestD = d;
      }
    }
    return best;
  }
  return prevIdx;
}

/**
 * 경로의 누적 거리 배열 (cum[i] = 시작점부터 i번째 점까지 m).
 *
 * 진행률과 남은 거리를 매 측위마다 전체 경로를 다시 훑어 계산하고 있었다.
 * 15km 코스는 좌표가 1500~3000개라, 1Hz 로 들어오는 측위마다 삼각함수가
 * 수천 번 돌았다 — 한 시간 뛰면 천만 번대다. 경로는 뛰는 동안 안 바뀌므로
 * 한 번만 만들어 두고 아래 두 함수로 O(1) 에 뽑는다.
 */
export function cumulativeMeters(planned: LatLng[]): number[] {
  const cum = new Array<number>(planned.length);
  cum[0] = 0;
  for (let i = 1; i < planned.length; i++) {
    cum[i] = cum[i - 1] + haversineMeters(planned[i - 1], planned[i]);
  }
  return cum;
}

/** 남은 거리(m) — cumulativeMeters 결과로 O(1) */
export function remainingFromCum(cum: number[], idx: number): number {
  if (cum.length < 2) return 0;
  const i = Math.max(0, Math.min(idx, cum.length - 1));
  return Math.max(0, cum[cum.length - 1] - cum[i]);
}

/** 진행률 0~1 — cumulativeMeters 결과로 O(1) */
export function ratioFromCum(cum: number[], idx: number): number {
  if (cum.length < 2) return 0;
  const total = cum[cum.length - 1];
  if (!(total > 0)) return 0;
  const i = Math.max(0, Math.min(idx, cum.length - 1));
  return Math.max(0, Math.min(1, cum[i] / total));
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
