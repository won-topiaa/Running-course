// ---------------------------------------------------------------------------
// 실시간 러닝 기록 훅
// Geolocation.watchPosition 으로 위치를 추적해 거리·시간·페이스를 계산한다.
// GPS 가 없거나 거부된 환경(데스크톱/샌드박스)에서는 데모 재생으로 대체.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { densifyPath, destinationPoint, haversineMeters } from './geo';
import { syntheticElevation } from './routing';
import type { LatLng } from './types';

export type RecStatus = 'idle' | 'recording' | 'paused' | 'finished';

export interface RecorderState {
  status: RecStatus;
  coords: LatLng[];
  elevations: number[];
  times: number[];
  distanceKm: number;
  elapsedSec: number;
  currentPaceSec: number | null;
  avgPaceSec: number | null;
  demo: boolean;
  error: string | null;
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

function currentPace(coords: LatLng[], times: number[]): number | null {
  // 최근 ~150m 구간의 페이스(초/km)
  let dist = 0;
  let i = coords.length - 1;
  while (i > 0 && dist < 150) {
    dist += haversineMeters(coords[i - 1], coords[i]);
    i--;
  }
  if (dist < 30) return null;
  const dt = (times[coords.length - 1] - times[i]) / 1000;
  const km = dist / 1000;
  return km > 0 ? dt / km : null;
}

export function useRunRecorder(startLoc: LatLng): Recorder {
  const [state, setState] = useState<RecorderState>({
    status: 'idle',
    coords: [],
    elevations: [],
    times: [],
    distanceKm: 0,
    elapsedSec: 0,
    currentPaceSec: null,
    avgPaceSec: null,
    demo: false,
    error: null,
  });

  const coordsRef = useRef<LatLng[]>([]);
  const elevRef = useRef<number[]>([]);
  const timesRef = useRef<number[]>([]);
  const lastRef = useRef<LatLng | null>(null);
  const distMRef = useRef(0);
  const activeMsRef = useRef(0); // 누적 활성 시간
  const segStartRef = useRef(0); // 현재 구간 시작 시각
  const statusRef = useRef<RecStatus>('idle');
  const watchRef = useRef<number | null>(null);
  const demoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoPathRef = useRef<LatLng[]>([]);
  const demoIdxRef = useRef(0);

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
      timesRef.current.push(Date.now());
      sync({
        coords: coordsRef.current.slice(),
        elevations: elevRef.current.slice(),
        times: timesRef.current.slice(),
        distanceKm: distMRef.current / 1000,
        currentPaceSec: currentPace(coordsRef.current, timesRef.current),
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
      lastRef.current = null;
      distMRef.current = 0;
      activeMsRef.current = 0;
      segStartRef.current = Date.now();
      statusRef.current = 'recording';
      sync({
        status: 'recording',
        demo,
        error: null,
        coords: [],
        elevations: [],
        times: [],
        distanceKm: 0,
        elapsedSec: 0,
        currentPaceSec: null,
        avgPaceSec: null,
      });
      startTick();
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
      () => sync({ error: 'denied' }),
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
      if (demoIdxRef.current >= path.length) return;
      const [lat, lng] = path[demoIdxRef.current++];
      ingest(lat, lng, syntheticElevation(lat, lng));
    }, 500);
  }, [beginSession, ingest, startLoc]);

  const pause = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    activeMsRef.current += Date.now() - segStartRef.current;
    statusRef.current = 'paused';
    sync({ status: 'paused' });
  }, [sync]);

  const resume = useCallback(() => {
    if (statusRef.current !== 'paused') return;
    segStartRef.current = Date.now();
    statusRef.current = 'recording';
    sync({ status: 'recording' });
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
    lastRef.current = null;
    distMRef.current = 0;
    activeMsRef.current = 0;
    setState({
      status: 'idle',
      coords: [],
      elevations: [],
      times: [],
      distanceKm: 0,
      elapsedSec: 0,
      currentPaceSec: null,
      avgPaceSec: null,
      demo: false,
      error: null,
    });
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  return { ...state, start, startDemo, pause, resume, stop, reset };
}
