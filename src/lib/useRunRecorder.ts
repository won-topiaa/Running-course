// ---------------------------------------------------------------------------
// 실시간 러닝 기록 훅
// Geolocation.watchPosition 으로 위치를 추적해 거리·시간·페이스를 계산한다.
// GPS 가 없거나 거부된 환경(데스크톱/샌드박스)에서는 데모 재생으로 대체.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { densifyPath, destinationPoint, haversineMeters } from './geo';
import { syntheticElevation } from './routing';
import { createGpsFilter } from './gpsFilter';
import { createPaceWindow } from './paceWindow';
import { sanePace } from './format';
import { createWakeLock } from './wakeLock';
import type { LatLng } from './types';

export type RecStatus = 'idle' | 'recording' | 'paused' | 'finished';

export interface RecorderState {
  status: RecStatus;
  coords: LatLng[];
  elevations: number[];
  /** 좌표별 벽시계 epoch ms — GPX 의 <time> 에 쓴다 */
  times: number[];
  /** 좌표별 누적 '활성' ms — 일시정지 시간이 빠져 있다. 페이스·구간 기록용 */
  activeTimes: number[];
  /** 좌표별 누적 거리(m) — 총거리와 같은 방식(도플러 적분)으로 잰 값. 구간 기록용 */
  cumDist: number[];
  distanceKm: number;
  elapsedSec: number;
  currentPaceSec: number | null;
  avgPaceSec: number | null;
  demo: boolean;
  error: string | null;
  /**
   * 화면을 끄거나 다른 앱으로 갔다가 돌아온 사이, GPS 가 실제로 멈춰 있던
   * 시간(초). 0 이면 정상. 모바일 브라우저는 백그라운드에서 watchPosition 을
   * 중단시키는 경우가 많은데, 그러면 그 구간이 통째로 기록에서 빠진다.
   */
  gapSec: number;
  /** 마지막 측위 오차 반경(m). null 이면 기기가 안 알려준 것 */
  accuracyM: number | null;
  /** 오차가 너무 커서 거리 적산을 멈춘 상태 — 사용자에게 알려야 한다 */
  weakSignal: boolean;
  /**
   * 마지막 측위 이후 흐른 초 (기록 중일 때만 갱신).
   *
   * weakSignal 은 '측위가 왔는데 오차가 크다'는 신호라, 측위가 아예 안 오면
   * false 인 채로 멈춰 있다. 배터리 절약 모드가 GPS 를 끊거나 실내로 들어가면
   * 화면은 켜져 있으니 gapSec(화면 꺼짐 감지)도 안 잡는다 — 시계만 돌고
   * 거리는 안 늘어 평균 페이스가 조용히 부풀려진다. 그걸 말해주기 위한 값.
   */
  noFixSec: number;
  /** 서 있는 게 확인돼 시계를 자동으로 멈춘 상태 (신호 대기 등) */
  autoPaused: boolean;
}

export interface Recorder extends RecorderState {
  start: () => void;
  startDemo: (path?: LatLng[]) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => void;
}

/** 좌표 차분으로 낸 최근 페이스 — 기기가 도플러 속도를 안 줄 때의 대비책 */
function paceFromPath(coords: LatLng[], activeTimes: number[]): number | null {
  // 창을 250m 로 넓게 잡는다. 좁으면 잡음 한 번에 페이스가 널뛴다.
  let dist = 0;
  let i = coords.length - 1;
  while (i > 0 && dist < 250) {
    dist += haversineMeters(coords[i - 1], coords[i]);
    i--;
  }
  if (dist < 80) return null;
  const dt = (activeTimes[coords.length - 1] - activeTimes[i]) / 1000;
  const km = dist / 1000;
  return km > 0 ? dt / km : null;
}

export function useRunRecorder(startLoc: LatLng): Recorder {
  const [state, setState] = useState<RecorderState>({
    status: 'idle',
    coords: [],
    elevations: [],
    times: [],
    activeTimes: [],
    cumDist: [],
    distanceKm: 0,
    elapsedSec: 0,
    currentPaceSec: null,
    avgPaceSec: null,
    demo: false,
    error: null,
    gapSec: 0,
    accuracyM: null,
    weakSignal: false,
    noFixSec: 0,
    autoPaused: false,
  });

  const coordsRef = useRef<LatLng[]>([]);
  const elevRef = useRef<number[]>([]);
  const timesRef = useRef<number[]>([]);
  const activeTimesRef = useRef<number[]>([]);
  const cumDistRef = useRef<number[]>([]);
  const lastFixAtRef = useRef(0); //   마지막 GPS 수신 시각
  const gapMsRef = useRef(0); //       백그라운드에서 놓친 누적 시간
  const distMRef = useRef(0);
  const activeMsRef = useRef(0); // 누적 활성 시간
  const segStartRef = useRef(0); // 현재 구간 시작 시각
  // 자동 일시정지 — 서 있는 동안 흐른 시간. 거리는 그 사이 안 쌓이므로
  // 시간만 흐르면 페이스가 그만큼 부풀려진다(신호 대기 2분이면 그 km 가
  // 5'34" 대신 7'32" 로 찍혔다). 그 시간을 활성 시간에서 뺀다.
  const autoPausedMsRef = useRef(0); //  이번 구간에서 누적된 정지 시간
  const stillSinceRef = useRef<number | null>(null); // 정지 시작 시각(진행 중)
  const statusRef = useRef<RecStatus>('idle');
  const watchRef = useRef<number | null>(null);
  const demoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoPathRef = useRef<LatLng[]>([]);
  const demoIdxRef = useRef(0);
  // GPS 잡음 필터 — 지터가 거리로 둔갑하지 않게 막는다 (gpsFilter.ts)
  const filterRef = useRef<ReturnType<typeof createGpsFilter> | null>(null);
  if (filterRef.current === null) filterRef.current = createGpsFilter();
  // 표시용 '지금 페이스' — 최근 20초의 실제 누적 거리 ÷ 시간 (paceWindow.ts)
  const paceWinRef = useRef<ReturnType<typeof createPaceWindow> | null>(null);
  if (paceWinRef.current === null) paceWinRef.current = createPaceWindow();
  const winPaceRef = useRef<number | null>(null);
  // 렌더마다 createWakeLock() 이 재실행되지 않도록 지연 초기화
  const wakeRef = useRef<ReturnType<typeof createWakeLock> | null>(null);
  if (wakeRef.current === null) wakeRef.current = createWakeLock();

  /** 지금까지의 '활성' 시간(ms) — 수동 일시정지와 자동 일시정지를 뺀 값 */
  const activeNow = useCallback((now: number) => {
    const inStill = stillSinceRef.current == null ? 0 : now - stillSinceRef.current;
    return Math.max(
      0,
      activeMsRef.current + (now - segStartRef.current) - autoPausedMsRef.current - inStill,
    );
  }, []);

  const sync = useCallback((patch: Partial<RecorderState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  /**
   * 지금 페이스.
   *
   * 1순위는 '최근 20초의 실제 누적 거리 ÷ 시간'(창 페이스) — 순간 도플러를
   * 그대로 뒤집으면 잡음 ±0.45m/s 에서 일정하게 달려도 표시가 4'34"~6'57" 를
   * 오갔다(직선에서도). 창 페이스는 총거리와 같은 자로 재므로 안정적이고
   * 화면 상단 숫자와 항상 앞뒤가 맞는다.
   * 창이 아직 안 찼을 때(시작 직후)만 도플러 순간값 → 좌표 차분 순서로 잇고,
   * 정지가 확정되면 창이 남아 있어도 즉시 '--' 로 넘긴다.
   */
  const livePace = useCallback((coords: LatLng[], activeTimes: number[]): number | null => {
    const f = filterRef.current;
    const v = f?.speed ?? null;
    // 확정 정지 — 창에는 아직 직전 20초의 이동이 남아 있어 22'/km 같은
    // 숫자가 한동안 이어진다. 서 있는 걸 아는데 숫자를 보여줄 이유가 없다.
    if (f?.speedTrusted && v != null && v < 0.5) return null;
    const win = sanePace(winPaceRef.current);
    if (win != null) return win;
    if (f?.speedTrusted && v != null) {
      return sanePace(v > 0 ? 1000 / v : null);
    }
    return sanePace(paceFromPath(coords, activeTimes));
  }, []);

  const ingest = useCallback(
    (
      lat: number,
      lng: number,
      alt: number | null,
      accuracy?: number | null,
      speed?: number | null,
    ) => {
      if (statusRef.current !== 'recording') return;
      const now = Date.now();
      lastFixAtRef.current = now;

      const v = filterRef.current!.push({
        lat,
        lng,
        accuracy: accuracy ?? null,
        speed: speed ?? null,
        t: now,
      });

      // 거리는 '경로에 점을 찍었는지'와 별개다. 도플러로 거리를 낼 때는
      // 위치가 버려진 틱에도 실제로는 그만큼 달린 것이므로 먼저 더한다
      // (여기서 안 더하면 오차가 큰 구간의 거리가 통째로 사라진다).
      distMRef.current += v.addM;

      // 자동 일시정지 — 서 있는 게 확인되면 시계를 멈춘다. 거리는 이미 안
      // 쌓이는데 시간만 흐르면 그 비대칭이 그대로 페이스를 부풀린다
      // (신호 대기 2분이 낀 km 가 5'34" 대신 7'32" 로 찍혔다).
      const still = filterRef.current!.still;
      if (still && stillSinceRef.current == null) {
        stillSinceRef.current = now;
      } else if (!still && stillSinceRef.current != null) {
        autoPausedMsRef.current += now - stillSinceRef.current;
        stillSinceRef.current = null;
      }

      const activeMs = activeNow(now);
      // 표시 페이스용 창 표본 — 활성 시간 기준이라 멈춤을 건너뛰어도 이어진다
      winPaceRef.current = paceWinRef.current!.push(activeMs, distMRef.current);

      // 버려진 측위여도 거리·페이스·신호 상태는 갱신한다. 숫자가 멈춰 보이면
      // 사용자는 앱이 죽은 줄 안다.
      if (!v.accept) {
        sync({
          distanceKm: distMRef.current / 1000,
          accuracyM: accuracy ?? null,
          weakSignal: v.weak,
          noFixSec: 0,
          autoPaused: still,
          currentPaceSec: livePace(coordsRef.current, activeTimesRef.current),
        });
        return;
      }

      coordsRef.current.push(v.point);
      const elevation =
        alt != null && !Number.isNaN(alt)
          ? alt
          : elevRef.current.length
            ? elevRef.current[elevRef.current.length - 1]
            : syntheticElevation(lat, lng);
      elevRef.current.push(elevation);
      timesRef.current.push(now);
      activeTimesRef.current.push(activeMs);
      cumDistRef.current.push(distMRef.current);
      sync({
        coords: coordsRef.current.slice(),
        elevations: elevRef.current.slice(),
        times: timesRef.current.slice(),
        activeTimes: activeTimesRef.current.slice(),
        cumDist: cumDistRef.current.slice(),
        distanceKm: distMRef.current / 1000,
        accuracyM: accuracy ?? null,
        weakSignal: false,
        noFixSec: 0,
        autoPaused: still,
        currentPaceSec: livePace(coordsRef.current, activeTimesRef.current),
      });
    },
    [sync, livePace, activeNow],
  );

  const startTick = useCallback(() => {
    if (tickRef.current) return;
    tickRef.current = setInterval(() => {
      if (statusRef.current !== 'recording') return;
      const elapsedSec = activeNow(Date.now()) / 1000;
      const km = distMRef.current / 1000;
      // 예전엔 20m 만 움직여도 평균을 냈다 — 시작 직후 거리는 몇 m 인데 시간만
      // 흘러서 '50'00"/km' 같은 숫자가 대문짝만하게 떴다. 최소 거리를 두고,
      // 그래도 범위를 벗어나면(아주 느린 걷기보다 느리면) 숫자 대신 '--'.
      // 측위가 끊기면 '지금 페이스'는 옛 숫자다. 창 페이스는 새 측위가 올 때만
      // 다시 계산되므로, 터널·백그라운드로 신호가 끊긴 채 5'12" 가 계속 떠
      // 있게 된다 — 사용자는 그걸 지금 자기 페이스로 믿는다. 한동안 측위가
      // 없으면 숫자를 거둔다(거리·시간은 그대로 두고 페이스만).
      const sinceFixMs = Date.now() - lastFixAtRef.current;
      const staleFix = sinceFixMs > 8_000;
      sync({
        elapsedSec,
        avgPaceSec: km >= 0.05 ? sanePace(elapsedSec / km) : null,
        noFixSec: Math.round(sinceFixMs / 1000),
        ...(staleFix ? { currentPaceSec: null } : {}),
      });
    }, 1000);
  }, [sync, activeNow]);

  /**
   * 이전 세션의 watch/타이머를 확실히 끊는다.
   * 안 끊고 새 watchPosition 을 걸면 옛 watch 가 살아남아 같은 좌표를 두 번
   * 넣는다 — 거리가 정확히 두 배가 되는데 원인을 찾기 아주 어렵다.
   */
  const stopSources = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    if (demoRef.current) {
      clearInterval(demoRef.current);
      demoRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const beginSession = useCallback(
    (demo: boolean) => {
      stopSources();
      coordsRef.current = [];
      elevRef.current = [];
      timesRef.current = [];
      activeTimesRef.current = [];
      cumDistRef.current = [];
      distMRef.current = 0;
      activeMsRef.current = 0;
      segStartRef.current = Date.now();
      autoPausedMsRef.current = 0;
      stillSinceRef.current = null;
      lastFixAtRef.current = Date.now();
      gapMsRef.current = 0;
      filterRef.current!.reset();
      paceWinRef.current!.reset();
      winPaceRef.current = null;
      statusRef.current = 'recording';
      sync({
        status: 'recording',
        demo,
        error: null,
        coords: [],
        elevations: [],
        times: [],
        activeTimes: [],
        cumDist: [],
        distanceKm: 0,
        elapsedSec: 0,
        currentPaceSec: null,
        avgPaceSec: null,
        gapSec: 0,
        accuracyM: null,
        weakSignal: false,
        noFixSec: 0,
        autoPaused: false,
      });
      startTick();
      void wakeRef.current?.enable(); // 뛰는 동안 화면 유지
    },
    [sync, startTick, stopSources],
  );

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      sync({ error: 'no-geo' });
      return;
    }
    beginSession(false);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) =>
        ingest(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.altitude,
          pos.coords.accuracy,
          pos.coords.speed,
        ),
      (err) => {
        // 권한 거부는 회복 불가. 예전엔 pause 로 넘겨 '일시정지된 기록' 화면에
        // 세워뒀는데, 그러면 정작 대안인 '데모' 버튼이 있는 시작 화면이
        // 사라져 사용자가 오도 가도 못했다. 시작 상태로 되돌려 거부 안내와
        // 데모 버튼을 다시 보여준다. 그 외(일시적 신호 없음)는 회복될 수
        // 있으니 그대로 둔다.
        if (err.code === err.PERMISSION_DENIED) {
          stopSources();
          void wakeRef.current?.disable();
          // 뛰던 중에 권한이 끊기는 경우가 있다(설정에서 껐거나 OS 가 회수).
          // 그때 시작 화면으로 되돌리면 그때까지 뛴 기록이 화면에서 사라진다
          // — 안전망(runRecovery)에는 남지만 앱을 껐다 켜야 다시 보인다.
          // 남길 게 있으면 요약 화면으로 넘겨 바로 저장할 수 있게 한다.
          if (coordsRef.current.length > 1) {
            if (statusRef.current === 'recording') {
              activeMsRef.current = activeNow(Date.now());
            }
            statusRef.current = 'finished';
            sync({
              status: 'finished',
              error: 'denied',
              elapsedSec: activeMsRef.current / 1000,
              distanceKm: distMRef.current / 1000,
              autoPaused: false,
            });
          } else {
            statusRef.current = 'idle';
            sync({ status: 'idle', error: 'denied' });
          }
        }
      },
      // maximumAge 는 반드시 0. 1000 으로 두면 브라우저가 최대 1초 묵은 좌표를
      // 그대로 돌려줘도 되는데, 실제로는 같은 좌표가 여러 틱 반복되어 그 사이
      // 이동이 통째로 사라진다(그리고 신호가 돌아오는 순간 한 번에 건너뛴다).
      // 실시간 기록에서는 항상 새 측위만 받는다.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
    );
  }, [beginSession, ingest, sync, stopSources, activeNow]);

  const startDemo = useCallback(
    (path?: LatLng[]) => {
      // 따라 뛸 경로가 있으면 그 경로를 재생한다. 예전엔 늘 시작점 주변의
      // 임의 링을 돌아서, 코스를 따라 뛰는 데모인데도 진행률이 0% 에서 멈춰
      // 있었다 — 데모가 보여줘야 할 것을 정작 안 보여줬다.
      let source: LatLng[];
      if (path && path.length > 1) {
        source = path;
      } else {
        // 자유 러닝 데모 — 시작점 주변 약 2.4km 루프
        const ring: LatLng[] = [];
        const R = 380;
        const center = destinationPoint(startLoc, 20, R);
        for (let k = 0; k < 7; k++) {
          ring.push(destinationPoint(center, 180 + (360 / 7) * k, R));
        }
        ring.push(ring[0]);
        source = ring;
      }
      // 재생 속도는 실제 러닝(3.33m/s = 5'00"/km)에 맞춘다. 예전엔 22m/500ms
      // (= 44m/s)로 재생해서, 페이스 범위 검사(sanePace)가 들어온 뒤로는 데모의
      // 현재·평균 페이스가 전부 '--' 였다 — 데모가 정작 페이스 기능을 못 보여줬다.
      demoPathRef.current = densifyPath(source, 1.67);
      demoIdxRef.current = 0;
      beginSession(true);
      demoRef.current = setInterval(() => {
        if (statusRef.current !== 'recording') return;
        const path = demoPathRef.current;
        if (demoIdxRef.current >= path.length) {
          // 경로를 다 돌았으면 타이머를 정리한다 (계속 두면 빈 틱이 무한히 돈다)
          if (demoRef.current) {
            clearInterval(demoRef.current);
            demoRef.current = null;
          }
          return;
        }
        const [lat, lng] = path[demoIdxRef.current++];
        ingest(lat, lng, syntheticElevation(lat, lng), 5, null);
      }, 500);
    },
    [beginSession, ingest, startLoc],
  );

  // start 안에서 pause 를 부르는데 선언 순서상 직접 참조할 수 없어 ref 로 우회
  const pauseRef = useRef<(() => void) | null>(null);

  const pause = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    // 수동 일시정지 시점까지의 활성 시간을 확정한다(자동 정지분을 뺀 값).
    activeMsRef.current = activeNow(Date.now());
    autoPausedMsRef.current = 0;
    stillSinceRef.current = null;
    statusRef.current = 'paused';
    void wakeRef.current?.disable();
    sync({ status: 'paused', autoPaused: false });
  }, [sync, activeNow]);

  pauseRef.current = pause;

  const resume = useCallback(() => {
    if (statusRef.current !== 'paused') return;
    // 기준점을 버려서 재개 직후 첫 좌표가 '다시 기준점'이 되게 한다.
    // 이걸 안 하면 멈춰 있는 동안 이동한 거리(지하철·차량 이동 등)가
    // 재개하는 순간 한 번에 더해져 기록이 부풀려진다.
    filterRef.current?.breakSegment();
    segStartRef.current = Date.now();
    autoPausedMsRef.current = 0;
    stillSinceRef.current = null;
    // 멈춰 있는 동안 들어온 측위는 ingest 가 버리므로 lastFixAt 이 그대로 멈춰
    // 있다. 이걸 안 되돌리면 쉰 시간이 'GPS 공백'으로 집계돼, 5분 쉬고 재개한
    // 사람에게 '화면이 꺼진 사이 5분 동안 위치가 기록되지 않았어요' 라고
    // 엉뚱한 안내가 나간다(그리고 신호 끊김 배너도 즉시 뜬다).
    lastFixAtRef.current = Date.now();
    statusRef.current = 'recording';
    void wakeRef.current?.enable();
    sync({ status: 'recording' });
  }, [sync]);

  // 화면을 껐다 켜거나 앱을 전환하고 돌아왔을 때, 그 사이 GPS 가 멈춰 있었는지
  // 확인한다. 브라우저는 백그라운드 탭의 watchPosition 을 중단시키는 일이 잦은데
  // 그러면 사용자는 계속 뛰었는데 기록만 비어 있게 된다 — 조용히 넘기면 안 된다.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (statusRef.current !== 'recording' || demoRef.current) return;
      const since = Date.now() - lastFixAtRef.current;
      // GPS 는 원래 몇 초씩 끊긴다. 20초 넘게 비어 있었으면 실제 공백으로 본다.
      if (since > 20_000) {
        gapMsRef.current += since;
        // 그 사이 어디로 갔는지 모르므로 구간을 끊는다. 안 끊으면 돌아온
        // 첫 좌표가 '화면 끄기 직전 위치'와 이어져, 그 직선거리가 통째로
        // 기록에 더해진다(지하철로 이동했다면 몇 km 가 얹힌다).
        filterRef.current?.breakSegment();
        sync({ gapSec: Math.round(gapMsRef.current / 1000) });
      }
      lastFixAtRef.current = Date.now();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [sync]);

  const cleanup = useCallback(() => {
    stopSources();
    void wakeRef.current?.disable();
  }, [stopSources]);

  const stop = useCallback(() => {
    if (statusRef.current === 'recording') {
      activeMsRef.current = activeNow(Date.now());
    }
    statusRef.current = 'finished';
    cleanup();
    sync({
      status: 'finished',
      elapsedSec: activeMsRef.current / 1000,
      distanceKm: distMRef.current / 1000,
      autoPaused: false,
    });
  }, [cleanup, sync, activeNow]);

  const reset = useCallback(() => {
    cleanup();
    statusRef.current = 'idle';
    coordsRef.current = [];
    elevRef.current = [];
    timesRef.current = [];
    activeTimesRef.current = [];
    cumDistRef.current = [];
    distMRef.current = 0;
    activeMsRef.current = 0;
    autoPausedMsRef.current = 0;
    stillSinceRef.current = null;
    filterRef.current?.reset();
    setState({
      status: 'idle',
      coords: [],
      elevations: [],
      times: [],
      activeTimes: [],
      cumDist: [],
      distanceKm: 0,
      elapsedSec: 0,
      currentPaceSec: null,
      avgPaceSec: null,
      demo: false,
      error: null,
      gapSec: 0,
      accuracyM: null,
      weakSignal: false,
      noFixSec: 0,
      autoPaused: false,
    });
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  return { ...state, start, startDemo, pause, resume, stop, reset };
}
