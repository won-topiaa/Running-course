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

export type RejectReason = 'accuracy' | 'gate' | 'still' | 'jump' | 'stale';

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

/**
 * 이보다 부정확한 측위는 위치로 쓰지 않는다.
 *
 * 예전엔 35m 였는데, 아파트 단지·고층 사이에서는 아이폰이 40~60m 를 몇 분씩
 * 이어서 보고한다. 그동안 모든 측위가 버려져서 기록이 통째로 비고, 신호가
 * 잠깐 좋아진 순간에만 점이 하나 찍혀 '직선 몇 개'짜리 경로가 남았다 —
 * 실측: 4분 러닝이 점 몇 개짜리 직선 0.39km 로 기록되고 페이스가 9'59"/km.
 * 문턱을 올리는 대신 아래 임계(gate)를 오차에 비례시켜 안전을 지킨다.
 */
const MAX_ACCURACY_M = 50;
/** 오차 정보가 없을 때 쓰는 최소 이동 임계 */
const MIN_GATE_M = 12;
/** 임계 = 오차 반경 × 이 값 */
const GATE_FACTOR = 1.6;
/**
 * 임계 상한.
 *
 * 이 값이 낮으면(예전 30m) 오차가 큰 구간에서 '지터가 임계를 넘어' 가짜 거리가
 * 쌓인다 — 서 있는데 거리가 늘던 원래 버그가 그것이다. 그래서 임계는 항상
 * 오차에 비례해야 하고, 상한은 허용 오차(50m)×비례계수(1.6)를 담을 만큼
 * 넉넉해야 한다. 그래야 오차 문턱을 올려도 정지 중 가짜 거리가 안 생긴다.
 */
const MAX_GATE_M = 80;
/** 이 속도 미만이면 '서 있다' 후보로 본다 (2.5km/h, 걷기보다 느림) */
const STILL_MS = 0.7;
/**
 * '서 있다'로 확정하기까지 필요한 연속 저속 틱 수.
 * 도시 협곡에서는 뛰는 중에도 도플러가 1~3틱씩 0 으로 끊긴다. 한 틱만 보고
 * 정지로 판정해 기준점을 옮기면 그 사이의 실제 이동이 통째로 버려진다 —
 * 실측(30분 러닝, 15초마다 3틱 끊김)에서 거리가 -11.8% 깎여 페이스가
 * 5'33" → 6'18" 로 왜곡됐다. 신호등 정지는 수십 초라 4틱이면 충분히 잡는다.
 */
const STILL_TICKS = 4;
/** 사람이 낼 수 없는 속도 — 위성 순간 오류로 본다 (36km/h) */
const MAX_SPEED_MS = 10;
/** 순간이동을 이만큼 연속으로 만나면 진짜 이동으로 받아들인다 */
const MAX_JUMP_SKIPS = 3;
/**
 * 도플러 속도를 시간으로 적분해도 되는 최대 간격(초).
 * 이보다 벌어졌으면 그 사이에 무슨 일이 있었는지 모르므로 더하지 않는다.
 */
const MAX_INTEGRATE_SEC = 10;
/**
 * 공백을 '길다'고 볼 간격(초).
 *
 * 이보다 오래 끊겼다가 사람이 낼 수 없는 속도로 돌아오면, 그 사이 경로를
 * 알 수 없다고 보고 거리를 안 더한다. 시간만으로 판단하면 안 된다 —
 * 신호가 약할 때는 임계가 커져서 정상 측위도 30초씩 벌어지는데, 그것까지
 * 공백으로 치면 진짜 뛴 거리가 깎인다(실측 -3.3% → -15.9%).
 */
const LONG_GAP_SEC = 10;
/** 오차 초과를 이만큼 연속으로 만나면 '신호 약함'을 알린다 */
const WEAK_AFTER = 3;

export function createGpsFilter() {
  let smooth: LatLng | null = null; // 평활된 현재 좌표
  let anchor: LatLng | null = null; // 마지막으로 인정한 지점
  let anchorT = 0;
  let spd: number | null = null; // 평활된 도플러 속도
  let rejected = 0;
  let jumps = 0;
  let stillTicks = 0; // 연속 저속(원시값) 틱 수
  let lastT: number | null = null; // 직전 측위 시각 (속도 적분용)
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
      stillTicks = 0;
      sawMotion = false;
      lastT = null;
    },

    /** 일시정지 후 재개 — 멈춰 있던 사이의 이동이 한 번에 더해지지 않게 끊는다 */
    breakSegment() {
      anchor = null;
      smooth = null;
      spd = null;
      jumps = 0;
      stillTicks = 0;
      lastT = null;
    },

    get speed() {
      return spd;
    },

    /**
     * 도플러 속도를 페이스 표시에 써도 되는지.
     * 일부 기기는 speed 를 항상 0 으로 준다 — 그 0 을 믿으면 페이스가 영영
     * '--' 다. 진짜 움직임이 한 번이라도 관측된 뒤에만 믿는다.
     */
    get speedTrusted() {
      return sawMotion;
    },

    /**
     * 지금 '확정 정지' 상태인지 (저속이 STILL_TICKS 만큼 이어짐).
     * 거리는 이 동안 안 쌓이므로, 시계도 같이 멈춰야 페이스가 안 부풀려진다.
     */
    get still() {
      return sawMotion && stillTicks >= STILL_TICKS;
    },

    push(fix: GpsFix): GpsVerdict {
      const acc = Number.isFinite(fix.accuracy as number) ? (fix.accuracy as number) : null;

      // 도플러 속도는 위치 필터와 무관하게 항상 갱신한다
      if (fix.speed != null && fix.speed >= 0 && Number.isFinite(fix.speed)) {
        // 평활값이 아니라 원시값으로 센다 — EMA 는 끊김이 몇 틱 지나야
        // 임계 아래로 내려와서, '몇 틱째 낮은가'를 정확히 셀 수 없다.
        stillTicks = fix.speed < STILL_MS ? stillTicks + 1 : 0;
        // 순간 끊김(0 이 1~3틱)은 EMA 에 넣지 않고 직전 속도를 유지한다.
        // 넣으면 화면의 '지금 페이스'가 3.0 → 1.8 → 1.08 m/s 로 무너지며
        // 9' → 15' → 25'/km 로 널뛴다. 정지가 확정되면 그때부터 반영해
        // 페이스가 자연스럽게 '--' 로 넘어간다.
        const transientDrop = sawMotion && fix.speed < STILL_MS && stillTicks < STILL_TICKS;
        if (!transientDrop) {
          spd = spd == null ? fix.speed : spd * 0.6 + fix.speed * 0.4;
        }
        if (fix.speed > 1.5) sawMotion = true;
      }

      // ── 거리: 도플러가 믿을 만하면 '속도 × 시간'으로 적분한다 ──────────
      //
      // 위치를 이어 붙여 재면 두 점 사이를 직선(현, chord)으로 가로질러
      // 재게 되어, 코너를 돌 때마다 그만큼이 사라진다. 임계(gate)가 오차에
      // 비례해 커지는 약한 신호에서는 이게 치명적이다 — 합성 검증에서
      // 60m 마다 꺾는 도심 러닝의 거리가 오차 15m 에서 -12.5%, 25m 에서
      // -27.4%, 45m 에서 -95.9% 까지 깎였다. 페이스는 시간÷거리라
      // 그대로 '5'33" 인데 7'39" 로 표시' 되는 결과가 된다.
      //
      // 위성 도플러로 잰 속도는 위치를 미분한 값과 달리 위치 오차의 영향을
      // 거의 받지 않는다(러닝 워치가 거리를 이렇게 내는 이유다). 곡선을
      // 가로지르지도 않는다 — 실제로 움직인 만큼이 매 초 그대로 쌓인다.
      const byDoppler = sawMotion && spd != null;
      let moved = 0;
      if (byDoppler) {
        const dt = lastT == null ? 0 : (fix.t - lastT) / 1000;
        if (dt > 0 && dt <= MAX_INTEGRATE_SEC) {
          // 정지는 저속이 STILL_TICKS 만큼 이어졌을 때만 확정한다 — 위쪽
          // 평활값과 같은 기준이다. 도시 협곡에서는 뛰는 중에도 도플러가
          // 1~3틱씩 0 으로 끊기는데, 그 틱을 정지로 보면 그 구간 거리가
          // 통째로 빠진다(합성 검증에서 -19.7%). 끊김 동안에는 직전 속도를
          // 유지한 평활값으로 적분한다.
          const confirmedStill = stillTicks >= STILL_TICKS;
          // 확정 정지일 때만 0. 'v < STILL_MS 면 0' 조건까지 걸면 잡음으로
          // 순간 낮게 읽힌 틱이 통째로 깎여 — 위쪽만 자르는 비대칭이라 —
          // 거리가 늘 부족한 쪽으로 치우친다. 평활 속도는 정지가 확정되기
          // 전에는 어차피 달리던 값 근처에 있다.
          moved = confirmedStill ? 0 : Math.min(spd as number, MAX_SPEED_MS) * dt;
        }
      }
      lastT = fix.t;

      const raw: LatLng = [fix.lat, fix.lng];

      if (acc != null && acc > MAX_ACCURACY_M) {
        rejected += 1;
        return {
          accept: false,
          point: smooth ?? raw,
          addM: moved,
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
        return { accept: true, point: smooth, addM: moved, weak: false, speed: spd };
      }

      const d = haversineMeters(anchor, smooth);
      const gate = Math.min(MAX_GATE_M, Math.max(MIN_GATE_M, (acc ?? 0) * GATE_FACTOR));
      if (d < gate) {
        return { accept: false, point: smooth, addM: moved, reason: 'gate', weak: false, speed: spd };
      }

      // 저속이 STILL_TICKS 만큼 이어졌을 때만 정지로 확정한다. 정지면 거리를
      // 더하지 않고 기준점을 옮겨 잡음 누적을 막는다. 1~3틱짜리 순간 끊김은
      // 여기 안 걸리고 아래 일반 경로로 내려가 실제 이동이 보존된다.
      if (sawMotion && stillTicks >= STILL_TICKS) {
        anchor = smooth;
        anchorT = fix.t;
        return { accept: false, point: smooth, addM: moved, reason: 'still', weak: false, speed: spd };
      }

      const dtSec = (fix.t - anchorT) / 1000;
      const impliedMs = dtSec > 0 ? d / dtSec : 0;
      if (impliedMs > MAX_SPEED_MS) {
        if (dtSec >= LONG_GAP_SEC) {
          // 오래 끊겼다가 사람이 낼 수 없는 속도로 돌아왔다 — 화면을 껐거나
          // 지하로 들어간 사이 이동한 것(지하철·차량)이다. 그 사이 경로를
          // 모르므로 거리에 더하지 않고 여기서 새로 시작한다.
          // 평활값도 같이 끊어야 한다. 안 끊으면 다음 몇 틱 동안 평활값이
          // 새 위치를 향해 뒤따라오면서 그 거리가 통째로 쌓인다
          // (실측: 90m 를 뛴 30초가 838m 로 기록됐다).
          smooth = raw;
          anchor = raw;
          anchorT = fix.t;
          jumps = 0;
          return { accept: true, point: raw, addM: moved, reason: 'stale', weak: false, speed: spd };
        }
        if (jumps < MAX_JUMP_SKIPS) {
          jumps += 1;
          return { accept: false, point: smooth, addM: moved, reason: 'jump', weak: false, speed: spd };
        }
      }
      jumps = 0;

      anchor = smooth;
      anchorT = fix.t;
      return { accept: true, point: smooth, addM: byDoppler ? moved : d, weak: false, speed: spd };
    },
  };
}
