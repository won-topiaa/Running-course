// ---------------------------------------------------------------------------
// km 구간 기록(스플릿)
//
// 기록 중 쌓인 좌표·시각에서 1km 를 지날 때마다의 소요 시간을 뽑는다.
// 좌표는 1km 정확히에서 찍히지 않으므로, km 경계를 넘은 구간 안에서 시각을
// 선형 보간해 경계 통과 시각을 추정한다. (구간 하나는 몇 초 남짓이라 오차는 작다)
// ---------------------------------------------------------------------------

import { haversineMeters } from './geo';
import type { LatLng } from './types';

export interface Split {
  /** 1부터 시작하는 구간 번호 — 1이면 0~1km */
  km: number;
  /** 이 1km 를 뛴 시간(초) = 곧 페이스(초/km) */
  sec: number;
  /** 아직 1km 를 못 채운 마지막 진행 중 구간 */
  partial?: boolean;
  /** partial 인 경우 지금까지 뛴 거리(km) */
  partialKm?: number;
}

/**
 * @param coords 기록된 좌표
 * @param times  좌표별 epoch ms (coords 와 같은 길이)
 * @param includePartial 마지막 미완 구간도 포함할지 (러닝 중 화면용)
 * @param cumDistM 좌표별 누적 거리(m). 기록기가 도플러 적분으로 잰 값 —
 *   이게 있으면 좌표를 다시 합산하지 않는다. 좌표 합산은 코너를 직선으로
 *   가로질러 거리가 깎이므로(도심 곡선에서 -12~-27%), km 경계가 실제보다
 *   늦게 지나가 구간 페이스가 전부 느리게 나온다 — 화면 상단의 총거리·평균
 *   페이스(적분값)와 서로 모순인 숫자가 된다.
 */
export function kmSplits(
  coords: LatLng[],
  times: number[],
  includePartial = false,
  cumDistM?: number[],
): Split[] {
  const useCum = !!cumDistM && cumDistM.length >= coords.length;
  const n = Math.min(coords.length, times.length);
  if (n < 2) return [];

  const out: Split[] = [];
  let cum = 0; //          출발점부터 누적 거리(m)
  let nextMark = 1000; //  다음 km 경계(m)
  let lastMarkTime = times[0];

  for (let i = 1; i < n; i++) {
    const seg = useCum
      ? (cumDistM as number[])[i] - (cumDistM as number[])[i - 1]
      : haversineMeters(coords[i - 1], coords[i]);
    if (seg <= 0) continue;
    const segStart = cum;
    cum += seg;

    // 한 구간이 여러 km 경계를 넘을 수도 있다(GPS 끊김 등)
    while (cum >= nextMark) {
      const ratio = (nextMark - segStart) / seg; // 경계가 이 구간의 몇 %인지
      const markTime = times[i - 1] + (times[i] - times[i - 1]) * ratio;
      out.push({ km: nextMark / 1000, sec: (markTime - lastMarkTime) / 1000 });
      lastMarkTime = markTime;
      nextMark += 1000;
    }
  }

  if (includePartial) {
    const restM = cum - (nextMark - 1000);
    if (restM > 30) {
      out.push({
        km: nextMark / 1000,
        sec: (times[n - 1] - lastMarkTime) / 1000,
        partial: true,
        partialKm: restM / 1000,
      });
    }
  }
  return out;
}
