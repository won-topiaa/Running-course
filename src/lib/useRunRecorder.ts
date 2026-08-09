// ---------------------------------------------------------------------------
// 실시간 러닝 기록 훅
// Geolocation.watchPosition 으로 위치를 추적해 거리·시간·페이스를 계산한다.
// GPS 가 없거나 거부된 환경(데스크톱/샌드박스)에서는 데모 재생으로 대체.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { densifyPath, destinationPoint, haversineMeters } from './geo';
import { syntheticElevation } from './routing';
import { createGpsFilter } from './gpsFilter';
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
    distanceKm: 0,
    elapsedSec: 0,
    currentPaceSec: null,
    avgPaceSec: null,
    demo: false,
    error: null,
    gapSec: 0,
    accuracyM: null,
    weakSignal: false,
  });

  const coordsRef = useRef<LatLng[]>([]);
  const elevRef = useRef<number[]>([]);
  const timesRef = useRef<number[]>([]);
  const activeTimesRef = useRef<number[]>([]);
  const lastFixAtRef = useRef(0); //   마지막 GPS 수신 시각
  const gapMsRef = useRef(0); //       백그라운드에서 놓친 누적 시간
  const distMRef = useRef(0);
  const activeMsRef = useRef(0); // 누적 활성 시간
  const segStartRef = useRef(0); // 현재 구간 시작 시각
  const statusRef = useRef<RecStatus>('idle');
  const watchRef = useRef<number | null>(null);
  const demoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoPathRef = useRef<LatLng[]>([]);
  const demoIdxRef = useRef(0);
  // GPS 잡음 필터 — 지터가 거리로 둔갑하지 않게 막는다 (gpsFilter.ts)
  const filterRef = useRef<ReturnType<typeof createGpsFilter> | null>(null);
  if (filterRef.current === null) filterRef.current = createGpsFilter();
  // 렌더마다 createWakeLock() 이 재실행되지 않도록 지연 초기화
  const wakeRef = useRef<ReturnType<typeof createWakeLock> | null>(null);
  if (wakeRef.current === null) wakeRef.current = createWakeLock();

  const sync = useCallback((patch: Partial<RecorderState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  /** 지금 페이스 — 믿을 만한 도플러 속도 우선, 아니면 좌표 차분 */
  const livePace = useCallback((coords: LatLng[], activeTimes: number[]): number | null => {
    const f = filterRef.current;
    const v = f?.speed ?? null;
    // speedTrusted: 진짜 움직임이 관측된 기기만. speed 를 항상 0 으로 주는
    // 기기에서 그 0 을 믿으면 페이스가 영영 '--' 가 된다 — 그땐 좌표 차분으로.
    if (f?.speedTrusted && v != null) {
      // 0.5 m/s 미만은 사실상 멈춘 것 — 33'/km 같은 숫자보다 '--' 가 낫다
      return v >= 0.5 ? 1000 / v : null;
    }
    return paceFromPath(coords, activeTimes);
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

      // 버려진 측위여도 페이스·신호 상태는 갱신한다. 숫자가 멈춰 보이면
      // 사용자는 앱이 죽은 줄 안다.
      if (!v.accept) {
        sync({
          accuracyM: accuracy ?? null,
          weakSignal: v.weak,
          currentPaceSec: livePace(coordsRef.current, activeTimesRef.current),
        });
        return;
      }

      distMRef.current += v.addM;
      coordsRef.current.push(v.point);
      const elevation =
        alt != null && !Number.isNaN(alt)
          ? alt
          : elevRef.current.length
            ? elevRef.current[elevRef.current.length - 1]
            : syntheticElevation(lat, lng);
      elevRef.current.push(elevation);
      timesRef.current.push(now);
      activeTimesRef.current.push(activeMsRef.current + (now - segStartRef.current));
      sync({
        coords: coordsRef.current.slice(),
        elevations: elevRef.current.slice(),
        times: timesRef.current.slice(),
        activeTimes: activeTimesRef.current.slice(),
        distanceKm: distMRef.current / 1000,
        accuracyM: accuracy ?? null,
        weakSignal: false,
        currentPaceSec: livePace(coordsRef.current, activeTimesRef.current),
      });
    },
    [sync, livePace],
  );

  const startTick = useCallback(() => {
    if (tickRef.current) return;
    tickRef.current = setInterval(() => {
      if (statusRef.current !== 'recording') return;
      const elapsedMs = activeMsRef.current + (Date.now() - segStartRef.current);
      const elapsedSec = elapsedMs / 1000;
      const km = distMRef.current / 1000;
      sync({ elapsedSec, avgPaceSec: km > 0.02 ? elapsedSec / km : null });
    }, 1000);
  }, [sync]);

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
      distMRef.current = 0;
      activeMsRef.current = 0;
      segStartRef.current = Date.now();
      lastFixAtRef.current = Date.now();
      gapMsRef.current = 0;
      filterRef.current!.reset();
      statusRef.current = 'recording';
      sync({
        status: 'recording',
        demo,
        error: null,
        coords: [],
        elevations: [],
        times: [],
        activeTimes: [],
        distanceKm: 0,
        elapsedSec: 0,
        currentPaceSec: null,
        avgPaceSec: null,
        gapSec: 0,
        accuracyM: null,
        weakSignal: false,
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
          statusRef.current = 'idle';
          void wakeRef.current?.disable();
          sync({ status: 'idle', error: 'denied' });
        }
      },
      // maximumAge 는 반드시 0. 1000 으로 두면 브라우저가 최대 1초 묵은 좌표를
      // 그대로 돌려줘도 되는데, 실제로는 같은 좌표가 여러 틱 반복되어 그 사이
      // 이동이 통째로 사라진다(그리고 신호가 돌아오는 순간 한 번에 건너뛴다).
      // 실시간 기록에서는 항상 새 측위만 받는다.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
    );
  }, [beginSession, ingest, sync, stopSources]);

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
      demoPathRef.current = densifyPath(source, 22);
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
    activeMsRef.current += Date.now() - segStartRef.current;
    statusRef.current = 'paused';
    void wakeRef.current?.disable();
    sync({ status: 'paused' });
  }, [sync]);

  pauseRef.current = pause;

  const resume = useCallback(() => {
    if (statusRef.current !== 'paused') return;
    // 기준점을 버려서 재개 직후 첫 좌표가 '다시 기준점'이 되게 한다.
    // 이걸 안 하면 멈춰 있는 동안 이동한 거리(지하철·차량 이동 등)가
    // 재개하는 순간 한 번에 더해져 기록이 부풀려진다.
    filterRef.current?.breakSegment();
    segStartRef.current = Date.now();
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
      activeMsRef.current += Date.now() - segStartRef.current;
    }
    statusRef.current = 'finished';
    cleanup();
    sync({
      status: 'finished',
      elapsedSec: activeMsRef.current / 1000,
      distanceKm: distMRef.current / 1000,
    });
  }, [cleanup, sync]);

  const reset = useCallback(() => {
    cleanup();
    statusRef.current = 'idle';
    coordsRef.current = [];
    elevRef.current = [];
    timesRef.current = [];
    activeTimesRef.current = [];
    distMRef.current = 0;
    activeMsRef.current = 0;
    filterRef.current?.reset();
    setState({
      status: 'idle',
      coords: [],
      elevations: [],
      times: [],
      activeTimes: [],
      distanceKm: 0,
      elapsedSec: 0,
      currentPaceSec: null,
      avgPaceSec: null,
      demo: false,
      error: null,
      gapSec: 0,
      accuracyM: null,
      weakSignal: false,
    });
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  return { ...state, start, startDemo, pause, resume, stop, reset };
}
