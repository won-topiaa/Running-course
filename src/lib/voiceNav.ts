// ---------------------------------------------------------------------------
// 음성 턴바이턴 내비게이션
//
// 계획 경로를 따라 뛸 때, 방향 전환 지점·km 이정표·완주를 음성과 진동으로
// 안내한다. Web Speech API(speechSynthesis)를 쓰므로 비용 0, 이어폰만 있으면
// 화면을 안 봐도 경로를 따라 뛸 수 있다.
// ---------------------------------------------------------------------------

import { haversineMeters } from './geo';
import { bearingDeg } from './routeDirection';
import type { LatLng } from './types';

// ── 턴 감지 ─────────────────────────────────────────────────────────────────

export interface TurnPoint {
  idx: number;
  pos: LatLng;
  /** 누적 거리(m) — 시작점부터 이 턴까지 */
  cumM: number;
  /** 방향 변화(도, -180~180, 양수 = 우회전) */
  deltaDeg: number;
  kind: 'left' | 'right' | 'sharp-left' | 'sharp-right' | 'u-turn';
}

function normalizeAngle(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function classifyTurn(delta: number): TurnPoint['kind'] {
  const abs = Math.abs(delta);
  if (abs >= 150) return 'u-turn';
  if (delta > 0) return abs >= 70 ? 'sharp-right' : 'right';
  return abs >= 70 ? 'sharp-left' : 'left';
}

const TURN_THRESHOLD_DEG = 30;
const MIN_SEG_M = 15;

/**
 * 경로에서 의미 있는 방향 전환 지점을 뽑는다.
 * 경로 좌표는 수 m 간격으로 촘촘하므로, 짧은 구간의 노이즈를 걸러내기 위해
 * 일정 거리(smoothM) 앞뒤 구간의 베어링을 비교한다.
 */
export function detectTurns(
  coords: LatLng[],
  cum: number[],
  smoothM = 40,
): TurnPoint[] {
  if (coords.length < 5) return [];
  const turns: TurnPoint[] = [];
  let lastTurnCumM = 0;

  for (let i = 2; i < coords.length - 2; i++) {
    let back = i - 1;
    while (back > 0 && cum[i] - cum[back] < smoothM) back--;
    let fwd = i + 1;
    while (fwd < coords.length - 1 && cum[fwd] - cum[i] < smoothM) fwd++;

    if (cum[i] - cum[back] < MIN_SEG_M || cum[fwd] - cum[i] < MIN_SEG_M) continue;

    const bIn = bearingDeg(coords[back], coords[i]);
    const bOut = bearingDeg(coords[i], coords[fwd]);
    const delta = normalizeAngle(bOut - bIn);

    if (Math.abs(delta) < TURN_THRESHOLD_DEG) continue;
    if (cum[i] - lastTurnCumM < 40) continue;

    turns.push({
      idx: i,
      pos: coords[i],
      cumM: cum[i],
      deltaDeg: delta,
      kind: classifyTurn(delta),
    });
    lastTurnCumM = cum[i];
  }
  return turns;
}

// ── 안내 문구 ───────────────────────────────────────────────────────────────

function turnLabel(kind: TurnPoint['kind']): string {
  switch (kind) {
    case 'left': return '좌회전';
    case 'right': return '우회전';
    case 'sharp-left': return '크게 좌회전';
    case 'sharp-right': return '크게 우회전';
    case 'u-turn': return '유턴';
  }
}

function distLabel(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace(/\.0$/, '')}킬로미터`;
  if (m >= 100) return `${Math.round(m / 10) * 10}미터`;
  return `${Math.round(m)}미터`;
}

// ── 이탈 감지 ───────────────────────────────────────────────────────────────

/**
 * 이탈 판정 기준(m).
 *
 * 휴대폰 GPS 오차: 하늘 열린 곳 5~10m, 도심 건물 사이 15~30m,
 * 앱의 MAX_ACCURACY_M = 50m (그 이상은 측위 자체를 버림).
 * 50m 로 잡으면 GPS 오차만으로 이탈이 뜰 확률은 거의 없고,
 * 진짜 길을 잘못 들었을 때(교차로 하나 = 보통 50~80m) 잡아낸다.
 */
const OFF_ROUTE_M = 50;
/** 연속 이탈 확인 횟수 — 순간 튀는 GPS 1회에 울리지 않게 */
const OFF_ROUTE_TICKS = 3;
/** 이탈 경고 재발화 최소 간격(ms) — 10초에 한 번만 */
const OFF_ROUTE_COOLDOWN_MS = 10_000;

/**
 * 현재 위치에서 계획 경로까지 최소 거리를 구한다.
 * 전체 경로를 훑지 않고 progressIdx 주변 ±SCAN 범위만 본다.
 */
const SCAN_RANGE = 80;

export function distToRoute(
  current: LatLng,
  planned: LatLng[],
  progressIdx: number,
): number {
  const lo = Math.max(0, progressIdx - 10);
  const hi = Math.min(planned.length - 1, progressIdx + SCAN_RANGE);
  let minD = Infinity;
  for (let i = lo; i <= hi; i++) {
    const d = haversineMeters(current, planned[i]);
    if (d < minD) minD = d;
  }
  return minD;
}

// ── 직진 안내 ───────────────────────────────────────────────────────────────

/** 직진 안내를 하는 최소 구간 거리(m) — 이보다 짧으면 굳이 말 안 한다 */
const STRAIGHT_MIN_M = 300;

// ── 음성 엔진 ───────────────────────────────────────────────────────────────

const WARN_AHEAD_M = 150;
const AT_TURN_M = 30;

export interface VoiceNavState {
  enabled: boolean;
  supported: boolean;
  turns: TurnPoint[];
  lastWarnedTurn: number;
  lastAtTurn: number;
  lastKmAnnounced: number;
  startAnnounced: boolean;
  /** 마지막으로 직진 안내한 턴 인덱스 (턴 통과 후 직진 안내) */
  lastStraightAfterTurn: number;
  /** 이탈 연속 틱 카운터 */
  offRouteTicks: number;
  /** 마지막 이탈 경고 시각(epoch ms) */
  lastOffRouteAt: number;
  /** 이탈 복귀 안내 발화 여부 (이탈→복귀 시 한 번만) */
  wasOffRoute: boolean;
}

export function initVoiceNav(
  coords: LatLng[],
  cum: number[],
): VoiceNavState {
  return {
    enabled: true,
    supported: typeof speechSynthesis !== 'undefined',
    turns: detectTurns(coords, cum),
    lastWarnedTurn: -1,
    lastAtTurn: -1,
    lastKmAnnounced: 0,
    startAnnounced: false,
    lastStraightAfterTurn: -1,
    offRouteTicks: 0,
    lastOffRouteAt: 0,
    wasOffRoute: false,
  };
}

function speak(text: string, vibrate = true) {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = 1.15;
  u.pitch = 1.0;
  const voices = speechSynthesis.getVoices();
  const ko = voices.find((v) => v.lang.startsWith('ko'));
  if (ko) u.voice = ko;
  speechSynthesis.speak(u);

  if (vibrate && navigator.vibrate) {
    navigator.vibrate(vibrate === true ? [200, 100, 200] : [200, 100, 200]);
  }
}

function speakUrgent(text: string) {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = 1.0;
  u.pitch = 1.1;
  const voices = speechSynthesis.getVoices();
  const ko = voices.find((v) => v.lang.startsWith('ko'));
  if (ko) u.voice = ko;
  speechSynthesis.speak(u);

  if (navigator.vibrate) {
    navigator.vibrate([300, 150, 300, 150, 300]);
  }
}

/**
 * GPS 측위가 들어올 때마다 호출한다. 안내가 필요하면 음성을 재생하고
 * state 를 갱신한 새 객체를 돌려준다 (불변).
 */
export function tickVoiceNav(
  state: VoiceNavState,
  progressIdx: number,
  cum: number[],
  distanceKm: number,
  totalDistM: number,
  current?: LatLng | null,
  planned?: LatLng[],
): VoiceNavState {
  if (!state.enabled || !state.supported) return state;

  const currentM = cum[Math.min(progressIdx, cum.length - 1)] ?? 0;
  let next = { ...state };

  // ── 이탈 감지 ──────────────────────────────────────────────────
  if (current && planned && planned.length > 1) {
    const dist = distToRoute(current, planned, progressIdx);
    if (dist > OFF_ROUTE_M) {
      next.offRouteTicks = state.offRouteTicks + 1;
      if (
        next.offRouteTicks >= OFF_ROUTE_TICKS &&
        Date.now() - state.lastOffRouteAt > OFF_ROUTE_COOLDOWN_MS
      ) {
        speakUrgent(
          `경로에서 ${distLabel(Math.round(dist))} 벗어났어요. 화면에서 경로를 확인해 주세요.`,
        );
        next.lastOffRouteAt = Date.now();
        next.wasOffRoute = true;
      }
      return next;
    } else {
      next.offRouteTicks = 0;
      if (state.wasOffRoute) {
        speak('경로로 돌아왔어요. 계속 진행하세요.', false);
        next.wasOffRoute = false;
      }
    }
  }

  // ── 출발 안내 ──────────────────────────────────────────────────
  if (!state.startAnnounced && progressIdx > 0) {
    const firstTurn = state.turns[0];
    if (firstTurn) {
      const toFirst = firstTurn.cumM - currentM;
      if (toFirst > STRAIGHT_MIN_M) {
        speak(`코스를 시작합니다. ${distLabel(Math.round(toFirst))} 직진 후 ${turnLabel(firstTurn.kind)}.`);
      } else {
        speak(`코스를 시작합니다. ${distLabel(Math.round(toFirst))} 앞에서 ${turnLabel(firstTurn.kind)}.`);
      }
    } else {
      speak(`코스를 시작합니다. 다음 안내가 나올 때까지 쭉 직진하세요.`);
    }
    next.startAnnounced = true;
  }

  // ── 턴 안내 ────────────────────────────────────────────────────
  for (let ti = 0; ti < state.turns.length; ti++) {
    const turn = state.turns[ti];
    const ahead = turn.cumM - currentM;

    if (ahead < -AT_TURN_M) continue;

    // 예고 안내 (150m 전)
    if (
      ahead > AT_TURN_M &&
      ahead <= WARN_AHEAD_M &&
      ti > next.lastWarnedTurn
    ) {
      const nextTurn = state.turns[ti + 1];
      let msg = `${distLabel(Math.round(ahead))} 앞에서 ${turnLabel(turn.kind)}`;
      if (nextTurn) {
        const gap = nextTurn.cumM - turn.cumM;
        if (gap < 200) {
          msg += `, 이어서 ${turnLabel(nextTurn.kind)}`;
        }
      }
      speak(msg);
      next.lastWarnedTurn = ti;
      break;
    }

    // 턴 도착 안내 (30m 이내)
    if (
      Math.abs(ahead) <= AT_TURN_M &&
      ti > next.lastAtTurn
    ) {
      speak(`지금 ${turnLabel(turn.kind)}`);
      next.lastAtTurn = ti;

      // ── 직진 안내: 턴 통과 직후, 다음 턴까지 먼 경우 ──────────
      const nextTurn = state.turns[ti + 1];
      if (nextTurn && ti > next.lastStraightAfterTurn) {
        const gap = nextTurn.cumM - turn.cumM;
        if (gap >= STRAIGHT_MIN_M) {
          setTimeout(() => {
            speak(
              `다음 안내가 나올 때까지 ${distLabel(Math.round(gap))} 직진하세요.`,
              false,
            );
          }, 2500);
          next.lastStraightAfterTurn = ti;
        }
      } else if (!nextTurn && ti > next.lastStraightAfterTurn) {
        const remain = totalDistM - turn.cumM;
        if (remain >= STRAIGHT_MIN_M) {
          setTimeout(() => {
            speak(`마지막 턴이에요. ${distLabel(Math.round(remain))} 직진하면 도착합니다.`, false);
          }, 2500);
          next.lastStraightAfterTurn = ti;
        }
      }
      break;
    }
  }

  // ── km 이정표 ──────────────────────────────────────────────────
  const km = Math.floor(distanceKm);
  if (km > 0 && km > state.lastKmAnnounced) {
    const remainM = totalDistM - currentM;
    if (remainM > 200) {
      speak(`${km}킬로미터 완료. 남은 거리 ${distLabel(Math.round(remainM))}`, false);
    }
    next.lastKmAnnounced = km;
  }

  // ── 완주 안내 ──────────────────────────────────────────────────
  const remainM = totalDistM - currentM;
  if (remainM <= 30 && totalDistM > 100 && currentM > totalDistM * 0.8) {
    if (state.lastKmAnnounced !== -999) {
      speak('코스 완주! 수고했어요.');
      next.lastKmAnnounced = -999;
    }
  }

  return next;
}

/** 음성 토글 — 끌 때 대기 중인 발화를 취소한다 */
export function toggleVoice(state: VoiceNavState): VoiceNavState {
  const enabled = !state.enabled;
  if (!enabled && typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel();
  }
  if (enabled) {
    speak('음성 안내를 시작합니다', false);
  }
  return { ...state, enabled };
}

/** 정리 — 컴포넌트 언마운트 시 */
export function stopVoiceNav() {
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel();
  }
}
