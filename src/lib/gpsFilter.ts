// ---------------------------------------------------------------------------
// GPS 잡음 필터
//
// 왜 필요한가: 휴대폰 GPS 는 가만히 서 있어도 좌표가 초당 5~15m 씩 떨린다
// (건물 반사·다중경로). watchPosition 이 주는 좌표를 그냥 이어 붙이면 그 떨림이
// 전부 '달린 거리'가 되어, 40초만 서 있어도 370m 가 쌓이고 페이스는 1'55"/km
// 같은 말도 안 되는 숫자가 나온다. 실제로 그렇게 나왔다.
//
// 세 겹으로 막는다.
//  1) 오차 반경이 큰 측위는 버린다 (실내·터널).
//  2) 좌표를 지수이동평균으로 눌러 잡음의 표준편차를 절반 아래로 줄인다.
//     차분으로 거리를 재면 잡음이 항상 거리를 '부풀리는' 쪽으로만 작용하므로
//     (두 점의 오차가 서로 상쇄되지 않는다) 평활이 가장 크게 먹힌다.
//  3) 마지막으로 인정한 지점에서 오차 반경만큼 벗어나야 새 지점으로 인정한다.
//     누적 변위 기준이라 실제로 뛰면 몇 초 안에 넘어서므로 진짜 거리는 잃지 않는다.
//
// 여기에 더해 기기가 도플러 속도(coords.speed)를 주면 '거의 정지'일 때 거리
// 적산을 아예 멈춘다. 도플러 속도는 좌표를 미분한 값과 달리 위성 신호에서
// 직접 잰 것이라 훨씬 믿을 만하다.
//
// 순수 함수로 떼어 둔 이유: 브라우저 없이 합성 GPS 로 검증하기 위해서다.
// (npm 스크립트 없이 node 로 바로 돌린다 — scripts/gps-filter-check.mjs)
// ---------------------------------------------------------------------------

import { haversineMeters } from './geo';
import type { LatLng } from './types';

export interface GpsFix {
  lat: number;
  lng: number;
  /** 오차 반경(m). 기기가 안 주면 null */
  accuracy: number | null;
  /** 도플러 속도(m/s). 없거나 음수면 null 취급 */
  speed: number | null;
  /** epoch ms */
  t: number;
}

export type RejectReason = 'accuracy' | 'gate' | 'still' | 'jump';

export interface GpsVerdict {
  /** 경로에 새 점으로 추가할지 */
  accept: boolean;
  /** 평활된 좌표 (accept 일 때만 의미 있음) */
  point: LatLng;
  /** 이번에 거리에 더할 미터 */
  addM: number;
  reason?: RejectReason;
  /** 오차가 커서 연속으로 버리고 있는 중인지 */
  weak: boolean;
  /** 평활된 속도(m/s) — 없으면 null */
  speed: number | null;
}

/** 이보다 부정확한 측위는 위치로 쓰지 않는다 */
const MAX_ACCURACY_M = 35;
/** 오차 정보가 없을 때 쓰는 최소 이동 임계 */
const MIN_GATE_M = 12;
/** 임계 = 오차 반경 × 이 값 */
const GATE_FACTOR = 1.6;
/** 임계 상한 — 너무 크면 짧은 코스에서 진짜 이동을 놓친다 */
const MAX_GATE_M = 30;
/** 이 속도 미만이면 '서 있다'로 보고 거리를 안 더한다 (2.5km/h, 걷기보다 느림) */
const STILL_MS = 0.7;
/** 사람이 낼 수 없는 속도 — 위성 순간 오류로 본다 (36km/h) */
const MAX_SPEED_MS = 10;
/** 순간이동을 이만큼 연속으로 만나면 진짜 이동으로 받아들인다 */
const MAX_JUMP_SKIPS = 3;
/** 오차 초과를 이만큼 연속으로 만나면 '신호 약함'을 알린다 */
const WEAK_AFTER = 3;

export function createGpsFilter() {
  let smooth: LatLng | null = null; // 평활된 현재 좌표
  let anchor: LatLng | null = null; // 마지막으로 인정한 지점
  let anchorT = 0;
  let spd: number | null = null; // 평활된 도플러 속도
  let rejected = 0;
  let jumps = 0;
  // 이 기기가 '진짜 속도'를 주는지 확인되기 전에는 정지 판정을 쓰지 않는다.
  // 일부 안드로이드 브라우저는 speed 를 항상 0 으로 준다 — 그걸 믿으면
  // 아무리 뛰어도 거리가 0 으로 남는다.
  let sawMotion = false;

  return {
    reset() {
      smooth = null;
      anchor = null;
      anchorT = 0;
      spd = null;
      rejected = 0;
      jumps = 0;
      sawMotion = false;
    },

    /** 일시정지 후 재개 — 멈춰 있던 사이의 이동이 한 번에 더해지지 않게 끊는다 */
    breakSegment() {
      anchor = null;
      smooth = null;
      spd = null;
      jumps = 0;
    },

    get speed() {
      return spd;
    },

    push(fix: GpsFix): GpsVerdict {
      const acc = Number.isFinite(fix.accuracy as number) ? (fix.accuracy as number) : null;

      // 도플러 속도는 위치 필터와 무관하게 항상 갱신한다
      if (fix.speed != null && fix.speed >= 0 && Number.isFinite(fix.speed)) {
        spd = spd == null ? fix.speed : spd * 0.6 + fix.speed * 0.4;
        if (fix.speed > 1.5) sawMotion = true;
      }

      const raw: LatLng = [fix.lat, fix.lng];

      if (acc != null && acc > MAX_ACCURACY_M) {
        rejected += 1;
        return {
          accept: false,
          point: smooth ?? raw,
          addM: 0,
          reason: 'accuracy',
          weak: rejected >= WEAK_AFTER,
          speed: spd,
        };
      }
      rejected = 0;

      // 평활 — 오차가 클수록 더 세게 누른다. α 가 작을수록 잡음이 많이 줄고
      // 대신 반응이 느려진다(진짜로 방향을 틀면 몇 초 늦게 따라온다).
      const alpha = acc == null ? 0.4 : Math.min(0.8, Math.max(0.18, 5 / acc));
      smooth =
        smooth == null
          ? raw
          : [smooth[0] + alpha * (raw[0] - smooth[0]), smooth[1] + alpha * (raw[1] - smooth[1])];

      if (anchor == null) {
        anchor = smooth;
        anchorT = fix.t;
        return { accept: true, point: smooth, addM: 0, weak: false, speed: spd };
      }

      const d = haversineMeters(anchor, smooth);
      const gate = Math.min(MAX_GATE_M, Math.max(MIN_GATE_M, (acc ?? 0) * GATE_FACTOR));
      if (d < gate) {
        return { accept: false, point: smooth, addM: 0, reason: 'gate', weak: false, speed: spd };
      }

      // 도플러가 '거의 안 움직인다'고 하면 그건 잡음이다. 거리를 더하지 않되
      // 기준점은 옮겨서, 다음 판정이 오래된 위치와 비교되지 않게 한다.
      if (sawMotion && spd != null && spd < STILL_MS) {
        anchor = smooth;
        anchorT = fix.t;
        return { accept: false, point: smooth, addM: 0, reason: 'still', weak: false, speed: spd };
      }

      const dtSec = (fix.t - anchorT) / 1000;
      if (dtSec > 0 && dtSec < 10 && d / dtSec > MAX_SPEED_MS && jumps < MAX_JUMP_SKIPS) {
        jumps += 1;
        return { accept: false, point: smooth, addM: 0, reason: 'jump', weak: false, speed: spd };
      }
      jumps = 0;

      anchor = smooth;
      anchorT = fix.t;
      return { accept: true, point: smooth, addM: d, weak: false, speed: spd };
    },
  };
}
