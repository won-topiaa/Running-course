// ---------------------------------------------------------------------------
// 실시간 러닝 기록 훅
// Geolocation.watchPosition 으로 위치를 추적해 거리·시간·페이스를 계산한다.
// GPS 가 없거나 거부된 환경(데스크톱/샌드박스)에서는 데모 재생으로 대체.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { densifyPath, destinationPoint, haversineMeters } from './geo';
import { syntheticElevation } from './routing';
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
}

export interface Recorder extends RecorderState {
  start: () => void;
  startDemo: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => void;
}

const MIN_MOVE_M = 4; // GPS 지터 무시 임계

function currentPace(coords: LatLng[], activeTimes: number[]): number | null {
  // 최근 ~150m 구간의 페이스(초/km). 활성 시간 기준이라 일시정지를 걸치면
  // 멈춘 시간이 페이스를 부풀리지 않는다.
  let dist = 0;
  let i = coords.length - 1;
  while (i > 0 && dist < 150) {
    dist += haversineMeters(coords[i - 1], coords[i]);
    i--;
  }
  if (dist < 30) return null;
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
  });

  const coordsRef = useRef<LatLng[]>([]);
  const elevRef = useRef<number[]>([]);
  const timesRef = useRef<number[]>([]);
  const activeTimesRef = useRef<number[]>([]);
  const lastRef = useRef<LatLng | null>(null);
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
  // 렌더마다 createWakeLock() 이 재실행되지 않도록 지연 초기화
  const wakeRef = useRef<ReturnType<typeof createWakeLock> | null>(null);
  if (wakeRef.current === null) wakeRef.current = createWakeLock();

  const sync = useCallback((patch: Partial<RecorderState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  const ingest = useCallback(
    (lat: number, lng: number, alt: number | null) => {
      if (statusRef.current !== 'recording') return;
      const p: LatLng = [lat, lng];
      const last = lastRef.current;
      if (last) {
        const d = haversineMeters(last, p);
        if (d < MIN_MOVE_M) return; // 정지/지터
        distMRef.current += d;
      }
      lastRef.current = p;
      coordsRef.current.push(p);
      const elevation =
        alt != null && !Number.isNaN(alt)
          ? alt
          : elevRef.current.length
            ? elevRef.current[elevRef.current.length - 1]
            : syntheticElevation(lat, lng);
      elevRef.current.push(elevation);
      const now = Date.now();
      lastFixAtRef.current = now;
      timesRef.current.push(now);
      activeTimesRef.current.push(activeMsRef.current + (now - segStartRef.current));
      sync({
        coords: coordsRef.current.slice(),
        elevations: elevRef.current.slice(),
        times: timesRef.current.slice(),
        activeTimes: activeTimesRef.current.slice(),
        distanceKm: distMRef.current / 1000,
        currentPaceSec: currentPace(coordsRef.current, activeTimesRef.current),
      });
    },
    [sync],
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

  const beginSession = useCallback(
    (demo: boolean) => {
      coordsRef.current = [];
      elevRef.current = [];
      timesRef.current = [];
      activeTimesRef.current = [];
      lastRef.current = null;
      distMRef.current = 0;
      activeMsRef.current = 0;
      segStartRef.current = Date.now();
      lastFixAtRef.current = Date.now();
      gapMsRef.current = 0;
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
      });
      startTick();
      void wakeRef.current?.enable(); // 뛰는 동안 화면 유지
    },
    [sync, startTick],
  );

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      sync({ error: 'no-geo' });
      return;
    }
    beginSession(false);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => ingest(pos.coords.latitude, pos.coords.longitude, pos.coords.altitude),
      (err) => {
        // 권한 거부는 회복 불가 — 계속 '기록 중'으로 두면 아무것도 안 쌓이는데
        // 사용자는 뛰고 있다고 믿게 된다. 즉시 멈추고 알린다.
        // 그 외(일시적 신호 없음)는 다음 콜백에서 회복될 수 있으니 유지한다.
        if (err.code === err.PERMISSION_DENIED) {
          sync({ error: 'denied' });
          pauseRef.current?.();
        }
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 },
    );
  }, [beginSession, ingest, sync]);

  const startDemo = useCallback(() => {
    // 시작점 주변 약 2.4km 루프를 미리 만들어 순차 재생
    const ring: LatLng[] = [];
    const R = 380;
    const center = destinationPoint(startLoc, 20, R);
    for (let k = 0; k < 7; k++) {
      ring.push(destinationPoint(center, 180 + (360 / 7) * k, R));
    }
    ring.push(ring[0]);
    demoPathRef.current = densifyPath(ring, 22);
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
      ingest(lat, lng, syntheticElevation(lat, lng));
    }, 500);
  }, [beginSession, ingest, startLoc]);

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
    // 마지막 위치를 버려서 재개 직후 첫 좌표가 '다시 기준점'이 되게 한다.
    // 이걸 안 하면 멈춰 있는 동안 이동한 거리(지하철·차량 이동 등)가
    // 재개하는 순간 한 번에 더해져 기록이 부풀려진다.
    lastRef.current = null;
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
    void wakeRef.current?.disable();
  }, []);

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
    lastRef.current = null;
    distMRef.current = 0;
    activeMsRef.current = 0;
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
    });
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  return { ...state, start, startDemo, pause, resume, stop, reset };
}
