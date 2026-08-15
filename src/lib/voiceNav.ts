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
  /**
   * 왕복 코스의 반환점인가. 유턴 중 코스 중간(총거리의 절반 ±15%)에 있는
   * 것 하나만 표시한다. '유턴'은 도로 내비 말투라 코스 반환점에는 어색하다 —
   * "반환점. 왔던 길로 돌아갑니다" 쪽이 러너가 기대하는 말이다.
   */
  turnaround?: boolean;
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

function labelFor(turn: TurnPoint): string {
  return turn.turnaround ? '반환점' : turnLabel(turn.kind);
}

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
  const lo = Math.max(0, progressIdx - SCAN_RANGE);
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
/** 긴 직진 구간에서 반복 안내 간격(m) */
const STRAIGHT_REMIND_M = 500;

// ── 음성 엔진 ───────────────────────────────────────────────────────────────

const WARN_AHEAD_M = 150;
const CONFIRM_AHEAD_M = 50;
const AT_TURN_M = 30;

/** 복귀 판정 기준(m) — 이탈(50m)보다 안쪽이어야 경계 진동에 안 흔들린다 */
const OFF_ROUTE_RETURN_M = 35;

export interface VoiceNavState {
  enabled: boolean;
  supported: boolean;
  turns: TurnPoint[];
  lastWarnedTurn: number;
  lastAtTurn: number;
  lastKmAnnounced: number;
  /** 출발 카운트다운 발화 시각(epoch ms). 0이면 아직 안 함 */
  startCountdownAt: number;
  startAnnounced: boolean;
  completionAnnounced: boolean;
  /** 마지막으로 직진 안내한 턴 인덱스 (턴 통과 후 직진 안내) */
  lastStraightAfterTurn: number;
  /** 50m 직전 확인 안내한 마지막 턴 인덱스 */
  lastConfirmTurn: number;
  /** 마지막 직진 반복 안내 시점(누적 m) */
  lastStraightRemindM: number;
  /** 이탈 연속 틱 카운터 */
  offRouteTicks: number;
  /** 마지막 이탈 경고 시각(epoch ms) */
  lastOffRouteAt: number;
  /** 이탈 복귀 안내 발화 여부 (이탈→복귀 시 한 번만) */
  wasOffRoute: boolean;
  /** '절반 지났어요' 발화 여부 */
  halfAnnounced: boolean;
  /** '마지막 500미터' 발화 여부 */
  finalAnnounced: boolean;
  /** 마지막 km 이정표 시점의 활성 시간(초) — 구간 페이스 계산용 */
  lastKmAtSec: number;
}

let voiceActive = false;
/** 토글 상태의 사본 — 지연 발화(setTimeout)가 끈 뒤에 울리는 걸 막는다 */
let voiceEnabled = true;
const pendingTimers: ReturnType<typeof setTimeout>[] = [];

/** 끝나면 스스로 목록에서 빠지는 타이머 — 긴 러닝에서 배열이 계속 자라지 않게 */
function later(ms: number, fn: () => void) {
  const id = setTimeout(() => {
    const i = pendingTimers.indexOf(id);
    if (i >= 0) pendingTimers.splice(i, 1);
    fn();
  }, ms);
  pendingTimers.push(id);
}

// 한국어 음성은 브라우저가 비동기로 싣는다. 첫 호출에 getVoices() 가 빈 배열을
// 주는 경우가 흔한데, 그때 못 찾고 넘어가면 영어 엔진이 한글을 읽어 알아들을 수
// 없는 소리가 난다. 한 번 찾아 캐시하고, 목록이 갱신되면 다시 고른다.
let koVoice: SpeechSynthesisVoice | null = null;
let voicesBound = false;

function pickKoVoice() {
  if (typeof speechSynthesis === 'undefined') return;
  try {
    const found = speechSynthesis
      .getVoices()
      .find((v) => v.lang.replace('_', '-').toLowerCase().startsWith('ko'));
    // 못 찾았다고 쥐고 있던 목소리를 버리지 않는다. voiceschanged 는 목록이 빈
    // 채로도 오는데, 거기서 null 을 덮어쓰면 영어 엔진이 한글을 읽기 시작한다.
    if (found) koVoice = found;
  } catch {
    // getVoices 가 던지는 WebView — 기본 목소리로 말한다
  }
}

function ensureVoices() {
  if (voicesBound || typeof speechSynthesis === 'undefined') return;
  voicesBound = true;
  pickKoVoice();
  try {
    speechSynthesis.addEventListener?.('voiceschanged', pickKoVoice);
  } catch {
    /* 이벤트 등록 실패 — 첫 발화 때 다시 고른다 */
  }
  // 주머니에 넣어 화면이 꺼지면(화면 유지 락이 실패할 수 있다) 브라우저가
  // 음성 엔진을 재워버리는 경우가 있다. 돌아왔을 때 깨워 둔다.
  document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'visible' && voiceActive) {
      try {
        speechSynthesis.resume();
      } catch {
        /* resume 실패는 다음 발화가 대신한다 */
      }
    }
  });
}

export function initVoiceNav(
  coords: LatLng[],
  cum: number[],
): VoiceNavState {
  voiceActive = true;
  voiceEnabled = true;
  ensureVoices();
  const turns = detectTurns(coords, cum);
  // 왕복 반환점: 코스 중간 근처의 유턴 중 절반에 가장 가까운 하나.
  // 막다른 길 핀을 다녀오는 유턴까지 전부 반환점이라 부르면 거짓말이 된다.
  const totalM = cum[cum.length - 1] ?? 0;
  if (totalM >= 1000) {
    let best = -1;
    let bestGap = totalM * 0.15;
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].kind !== 'u-turn') continue;
      const gap = Math.abs(turns[i].cumM - totalM / 2);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    if (best >= 0) turns[best] = { ...turns[best], turnaround: true };
  }
  return {
    enabled: true,
    supported:
      typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined',
    turns,
    lastWarnedTurn: -1,
    lastAtTurn: -1,
    lastKmAnnounced: 0,
    startCountdownAt: 0,
    startAnnounced: false,
    completionAnnounced: false,
    lastStraightAfterTurn: -1,
    lastConfirmTurn: -1,
    lastStraightRemindM: 0,
    offRouteTicks: 0,
    lastOffRouteAt: 0,
    wasOffRoute: false,
    halfAnnounced: false,
    finalAnnounced: false,
    lastKmAtSec: 0,
  };
}

/**
 * 안내 우선순위.
 *
 * 예전엔 speak() 가 매번 cancel() 을 불러, 같은 틱에 턴 안내와 km 이정표가
 * 겹치면 앞의 것이 말하다 잘리고 마지막 것만 들렸다. 지금은 급한 것만
 * 끼어들고, 나머지는 브라우저 큐에 순서대로 쌓는다.
 *
 * - alert : 경로 이탈. 하던 말을 끊고 바로 알린다.
 * - now   : "지금 좌회전". 놓치면 길을 잘못 든다 — 역시 끊고 알린다.
 * - normal: 예고·이정표·직진. 하던 말이 끝난 뒤 이어서 말한다.
 */
type SpeakLevel = 'alert' | 'now' | 'normal';

/** 밀린 안내 상한 — 이보다 쌓이면 흘려보낸다. 지난 안내를 뒤늦게 들으면 헷갈린다 */
const MAX_QUEUED = 2;
/**
 * 발화가 끝났다고 보는 최대 시간(ms).
 *
 * 화면이 꺼져 브라우저가 음성 엔진을 재우면 onend/onerror 가 영영 안 온다.
 * 그것만 믿으면 카운터가 상한에 박혀 남은 러닝 내내 안내가 사라진다 —
 * 하필 주머니에 넣고 뛰는, 음성이 가장 필요한 상황에서.
 */
const SPEAK_TTL_MS = 12_000;
/** 재생 중인 발화의 시작 시각들 */
let inflight: number[] = [];

const VIBRATE_TURN = [200, 100, 200];
const VIBRATE_ALERT = [300, 150, 300, 150, 300];

/** 실제로 발화했으면 true. 밀려서 흘려보냈으면 false — 호출부가 재시도한다. */
function speak(
  text: string,
  { level = 'normal', vibrate = true }: { level?: SpeakLevel; vibrate?: boolean } = {},
): boolean {
  if (
    !voiceActive ||
    !voiceEnabled ||
    typeof speechSynthesis === 'undefined' ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return false;
  }

  // 전부 try 로 감싼다. 일부 안드로이드 WebView 는 speechSynthesis 는 있는데
  // 발화 생성/재생에서 던지는데, 이 함수는 러닝 화면의 측위 effect 안에서
  // 불린다 — 여기서 새어 나가면 안내가 안 나오는 게 아니라 뛰는 도중 화면
  // 전체가 오류 화면으로 떨어진다. 음성은 부가 기능이라 조용히 포기가 맞다.
  try {
    const now = Date.now();
    inflight = inflight.filter((t) => now - t < SPEAK_TTL_MS);

    if (level !== 'normal') {
      speechSynthesis.cancel();
      inflight = [];
    } else if (inflight.length >= MAX_QUEUED) {
      return false; // 이미 밀려 있다 — 지금 말해봐야 한참 뒤에 나온다
    }

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = level === 'alert' ? 1.0 : 1.05;
    u.pitch = level === 'alert' ? 1.1 : 1.0;
    // 첫 발화 때 목록이 비어 못 골랐을 수 있다 — 있을 때 다시 집는다
    if (!koVoice) pickKoVoice();
    if (koVoice) u.voice = koVoice;

    inflight.push(now);
    const done = () => {
      const i = inflight.indexOf(now);
      if (i >= 0) inflight.splice(i, 1);
    };
    u.onend = done;
    u.onerror = done;
    // 화면이 꺼졌다 켜지면 브라우저가 음성 엔진을 paused 로 남겨 두기도 한다.
    // 그 상태에서 speak 만 하면 소리 없이 큐에만 쌓인다 — 말하기 전에 깨운다.
    speechSynthesis.resume?.();
    speechSynthesis.speak(u);

    if (vibrate && navigator.vibrate) {
      navigator.vibrate(level === 'alert' ? VIBRATE_ALERT : VIBRATE_TURN);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 화면이 직접 안내를 내보내야 할 때 (12분 심폐 검사의 시작·남은 시간·종료).
 *
 * 검사는 최대 노력으로 뛰는 12분이라 화면을 볼 여유가 없다 — 남은 시간을
 * 눈으로 확인하려고 속도를 늦추면 그게 곧 결과를 깎는다. 그래서 이 구간만은
 * 소리가 본선이고 화면이 보조다.
 *
 * 음성 토글(voiceEnabled)은 그대로 존중한다. 끈 사람에게 검사라고 해서
 * 말을 걸지 않는다 — 그때는 화면의 카운트다운과 진동이 대신한다.
 */
export function announce(text: string, opts: { urgent?: boolean } = {}): boolean {
  return speak(text, { level: opts.urgent ? 'now' : 'normal' });
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
  /** 활성 시간(초, 일시정지 제외) — 주면 km 이정표에 지난 1km 페이스를 붙인다 */
  activeSec?: number,
): VoiceNavState {
  if (!state.enabled || !state.supported) return state;

  const currentM = cum[Math.min(progressIdx, cum.length - 1)] ?? 0;
  const next = { ...state };
  // 한 번의 측위에 하나만 말한다. 예전엔 턴 안내 → 직진 → km 이정표가 줄줄이
  // 발화되며 서로를 끊었다. 급한 것부터 자리를 잡고, 나머지는 다음 틱으로 미룬다.
  let spoke = false;

  // ── 이탈 감지 ──────────────────────────────────────────────────
  let offRoute = false;
  if (current && planned && planned.length > 1) {
    const dist = distToRoute(current, planned, progressIdx);
    if (dist > OFF_ROUTE_M) {
      offRoute = true;
      next.offRouteTicks = state.offRouteTicks + 1;
      if (
        next.offRouteTicks >= OFF_ROUTE_TICKS &&
        Date.now() - state.lastOffRouteAt > OFF_ROUTE_COOLDOWN_MS
      ) {
        speak(
          `경로에서 ${distLabel(Math.round(dist))} 벗어났어요. 화면에서 경로를 확인해 주세요.`,
          { level: 'alert' },
        );
        next.lastOffRouteAt = Date.now();
        next.wasOffRoute = true;
        spoke = true;
      }
    } else if (dist <= OFF_ROUTE_RETURN_M) {
      next.offRouteTicks = 0;
      if (state.wasOffRoute) {
        speak('경로로 돌아왔어요. 계속 진행하세요.', { vibrate: false });
        next.wasOffRoute = false;
        spoke = true;
        // 헤매는 동안 다음 턴의 예고 구간을 지나쳤을 수 있다. 되감아서
        // 복귀 직후 다시 안내받게 한다 — 안 그러면 코앞의 턴을 말없이 지나친다.
        const upcoming = state.turns.findIndex((t) => t.cumM - currentM > AT_TURN_M);
        if (upcoming >= 0) {
          const prev = upcoming - 1;
          next.lastWarnedTurn = Math.min(next.lastWarnedTurn, prev);
          next.lastConfirmTurn = Math.min(next.lastConfirmTurn, prev);
          next.lastAtTurn = Math.min(next.lastAtTurn, prev);
        }
      }
    } else {
      next.offRouteTicks = 0;
    }
  }

  // ── 출발 안내 (카운트다운 → 5초 뒤 출발 안내) ─────────────────
  if (!spoke && !offRoute && !state.startAnnounced && progressIdx > 0) {
    if (state.startCountdownAt === 0) {
      if (speak('5초 뒤 코스 출발합니다', { vibrate: false })) {
        next.startCountdownAt = Date.now();
        spoke = true;
      }
    } else if (Date.now() - state.startCountdownAt >= 5000) {
      const firstTurn = state.turns[0];
      let said: boolean;
      if (firstTurn) {
        // 카운트다운 5초 사이에 첫 턴을 이미 지났을 수 있다(첫 턴은 40m 앞에도
        // 있다). 그대로 빼면 "마이너스 80미터 앞 좌회전" 이 나온다.
        const toFirst = firstTurn.cumM - currentM;
        said =
          toFirst > AT_TURN_M
            ? speak(`출발. ${distLabel(Math.round(toFirst))} 앞 ${labelFor(firstTurn)}`)
            : speak(`출발. 잠시 후 ${labelFor(firstTurn)}`);
      } else {
        said = speak(`출발. 쭉 직진`);
      }
      if (said) {
        next.startAnnounced = true;
        spoke = true;
      }
    }
  }

  // ── 턴 안내 ────────────────────────────────────────────────────
  if (!spoke && !offRoute) {
    for (let ti = 0; ti < state.turns.length; ti++) {
      const turn = state.turns[ti];
      const ahead = turn.cumM - currentM;

      if (ahead < -AT_TURN_M) continue;

      // 예고 안내 (150m 전)
      if (
        ahead > CONFIRM_AHEAD_M &&
        ahead <= WARN_AHEAD_M &&
        ti > next.lastWarnedTurn
      ) {
        // 밀려서 못 했으면 표시하지 않는다 — 다음 측위에서 다시 시도한다.
        // 안 그러면 안내를 못 들은 채로 "안내함" 이 되어 영영 예고가 없다.
        if (!speak(`${distLabel(Math.round(ahead))} 앞 ${labelFor(turn)}`)) break;
        next.lastWarnedTurn = ti;
        spoke = true;

        // 연속 턴은 별도 발화로 분리 (2초 뒤)
        const nextTurn = state.turns[ti + 1];
        if (nextTurn) {
          const gap = nextTurn.cumM - turn.cumM;
          if (gap < 200) {
            const nk = labelFor(nextTurn);
            later(2000, () => speak(`이후 ${nk}`, { vibrate: false }));
          }
        }
        break;
      }

      // 확인 안내 (50m 전)
      if (
        ahead > AT_TURN_M &&
        ahead <= CONFIRM_AHEAD_M &&
        ti > next.lastConfirmTurn
      ) {
        if (!speak(`잠시 후 ${labelFor(turn)}`)) break;
        next.lastConfirmTurn = ti;
        spoke = true;
        break;
      }

      // 턴 도착 안내 (30m 이내)
      if (
        Math.abs(ahead) <= AT_TURN_M &&
        ti > next.lastAtTurn
      ) {
        speak(
          turn.turnaround ? '반환점. 왔던 길로 돌아갑니다' : `지금 ${turnLabel(turn.kind)}`,
          { level: 'now' },
        );
        next.lastAtTurn = ti;
        spoke = true;

        // ── 직진 안내: 턴 통과 직후, 다음 턴까지 먼 경우 ──────────
        const nextTurn = state.turns[ti + 1];
        if (nextTurn && ti > next.lastStraightAfterTurn) {
          const gap = nextTurn.cumM - turn.cumM;
          if (gap >= STRAIGHT_MIN_M) {
            later(2500, () => speak('쭉 직진하세요', { vibrate: false }));
            next.lastStraightAfterTurn = ti;
            next.lastStraightRemindM = currentM;
          }
        } else if (!nextTurn && ti > next.lastStraightAfterTurn) {
          const remain = totalDistM - turn.cumM;
          if (remain >= STRAIGHT_MIN_M) {
            later(2500, () => speak('직진하면 도착', { vibrate: false }));
            next.lastStraightAfterTurn = ti;
            next.lastStraightRemindM = currentM;
          }
        }
        break;
      }
    }

    // ── 직진 반복 안내: 다음 턴까지 먼 구간에서 500m마다 ────────
    if (!spoke && state.startAnnounced) {
      const nextTurnM = state.turns.find((t) => t.cumM - currentM > WARN_AHEAD_M)?.cumM;
      const aheadToTurn = nextTurnM != null ? nextTurnM - currentM : totalDistM - currentM;
      if (
        aheadToTurn > STRAIGHT_MIN_M &&
        currentM - next.lastStraightRemindM >= STRAIGHT_REMIND_M
      ) {
        if (speak('쭉 직진하세요', { vibrate: false })) {
          next.lastStraightRemindM = currentM;
          spoke = true;
        }
      }
    }
  }

  // ── 완주 안내 ──────────────────────────────────────────────────
  // km 이정표보다 먼저 본다 — 마지막 순간에 "5킬로미터 완료" 대신
  // "코스 완주" 를 들려주는 쪽이 맞다.
  const remainM = totalDistM - currentM;
  if (!spoke && !state.completionAnnounced && remainM <= 30 && totalDistM > 100) {
    speak('코스 완주! 수고했어요.', { level: 'now' });
    next.completionAnnounced = true;
    next.lastKmAnnounced = Math.floor(distanceKm); // 완주 뒤 이정표가 뒤따르지 않게
    return next;
  }

  // ── 마지막 스퍼트 (따라 뛰기 전용) ─────────────────────────────
  // 완주 직전(60m 이내)이면 굳이 말하지 않는다 — 완주 안내가 곧 나온다.
  if (
    !spoke &&
    !state.finalAnnounced &&
    totalDistM >= 1500 &&
    remainM <= 500 &&
    remainM > 60
  ) {
    if (speak('마지막 500미터입니다.', { vibrate: false })) {
      next.finalAnnounced = true;
      spoke = true;
    }
  }

  // ── 절반 안내 (따라 뛰기 전용) ─────────────────────────────────
  // 왕복 코스는 반환점 안내가 절반 그 자체라 겹쳐 말하지 않는다.
  if (
    !spoke &&
    !state.halfAnnounced &&
    totalDistM >= 2000 &&
    currentM >= totalDistM / 2 &&
    !state.turns.some((t) => t.turnaround)
  ) {
    if (speak('절반 지났어요.', { vibrate: false })) {
      next.halfAnnounced = true;
      spoke = true;
    }
  }

  // ── km 이정표 ──────────────────────────────────────────────────
  const km = Math.floor(distanceKm);
  if (km > 0 && km > state.lastKmAnnounced) {
    if (remainM <= 200 && totalDistM > 0) {
      // 결승이 코앞이다 — 이정표는 건너뛰고 완주 안내에 자리를 내준다
      next.lastKmAnnounced = km;
      if (activeSec != null) next.lastKmAtSec = activeSec;
    } else if (!spoke) {
      // 지난 1km 에 걸린 시간. 한 틱에 km 가 2 이상 뛰었거나(GPS 공백) 값이
      // 상식 밖이면(2분 미만·20분 초과) 붙이지 않는다 — 지어낸 숫자를 읽어
      // 주느니 거리만 말하는 편이 낫다.
      let pace = '';
      if (activeSec != null && km === state.lastKmAnnounced + 1) {
        const split = Math.round(activeSec - state.lastKmAtSec);
        if (split >= 120 && split <= 1200) {
          const mm = Math.floor(split / 60);
          const ss = split % 60;
          pace = ` 지난 1킬로미터 ${mm}분${ss > 0 ? ` ${ss}초` : ''}.`;
        }
      }
      // 따라 뛰기는 남은 거리까지, 자유 러닝(totalDistM 0)은 거리·페이스만
      const tail = totalDistM > 0 ? ` 남은 거리 ${distLabel(Math.round(remainM))}` : '';
      // 실제로 말했을 때만 넘긴 것으로 친다. 턴 안내에 밀렸다면 그대로 두고
      // 다음 측위에서 다시 시도한다 — 놓치면 그 이정표는 영영 안 나온다.
      const said = speak(`${km}킬로미터 완료.${pace}${tail}`, { vibrate: false });
      if (said) {
        next.lastKmAnnounced = km;
        if (activeSec != null) next.lastKmAtSec = activeSec;
      }
    }
  }

  return settled(state, next);
}

/**
 * 바뀐 게 없으면 원래 객체를 그대로 돌려준다.
 * 호출부는 `next !== state` 로 리렌더를 거르는데, 매번 새 객체를 주면
 * 그 검사가 늘 통과해 측위마다(초당 한 번) 화면이 다시 그려진다.
 */
function settled(prev: VoiceNavState, next: VoiceNavState): VoiceNavState {
  for (const k of Object.keys(next) as (keyof VoiceNavState)[]) {
    if (next[k] !== prev[k]) return next;
  }
  return prev;
}

/** 음성 토글 — 끌 때 대기 중인 발화를 취소한다 */
export function toggleVoice(state: VoiceNavState): VoiceNavState {
  const enabled = !state.enabled;
  voiceEnabled = enabled;
  if (!enabled) {
    // 예약된 뒷말("이후 좌회전", "쭉 직진하세요")까지 걷어낸다. 이걸 안 하면
    // 음성을 끈 뒤 2~3초 있다가 한 마디가 튀어나온다.
    pendingTimers.forEach(clearTimeout);
    pendingTimers.length = 0;
    inflight = [];
    if (typeof speechSynthesis !== 'undefined') {
      try {
        speechSynthesis.cancel();
      } catch {
        /* 무시 — 끝내는 길이다 */
      }
    }
  } else {
    speak('음성 안내를 시작합니다', { vibrate: false });
  }
  return { ...state, enabled };
}

/** 정리 — 컴포넌트 언마운트 시 */
export function stopVoiceNav() {
  voiceActive = false;
  pendingTimers.forEach(clearTimeout);
  pendingTimers.length = 0;
  inflight = [];
  if (typeof speechSynthesis !== 'undefined') {
    try {
      speechSynthesis.cancel();
    } catch {
      /* 무시 — 정리 경로다 */
    }
  }
}
