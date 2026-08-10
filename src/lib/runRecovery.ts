// ---------------------------------------------------------------------------
// 진행 중 러닝 안전망
//
// 웹앱은 화면이 꺼지거나 다른 앱으로 넘어가면 브라우저가 탭을 얼리고, 메모리가
// 부족하면 아예 종료해 버린다(네이티브 앱처럼 백그라운드에서 GPS 를 계속 받을
// 권한이 웹에는 없다). 그때 아무 대비가 없으면 그때까지 뛴 기록이 통째로 사라진다.
//
// 그래서 뛰는 동안 진행 상황을 주기적으로, 그리고 '화면이 가려지는 순간'에
// 반드시 저장해 둔다 — 탭이 죽기 직전에 남길 수 있는 마지막 기회가 그 순간이다.
// 다음에 앱을 열면 그 기록을 되살려 저장할 수 있게 한다.
//
// 저장 용량을 아끼려고 좌표는 소수 5자리(약 1.1m)로 줄인다. GPS 정확도가
// ±5m 라 이 반올림으로 잃는 것은 없다.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';

const KEY = 'run-app-inprogress-v1';
/** 이보다 오래된 기록은 되살리지 않는다 — 어제 뛴 걸 오늘 물어보면 곤란하다 */
const MAX_AGE_MS = 12 * 60 * 60_000;

export interface InProgressRun {
  /** 마지막으로 저장한 시각 (epoch ms) */
  at: number;
  name: string;
  coords: LatLng[];
  elevations: number[];
  times: number[];
  activeTimes: number[];
  cumDist: number[];
  distanceKm: number;
  elapsedSec: number;
}

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

export function saveInProgress(run: Omit<InProgressRun, 'at'>): void {
  try {
    if (run.coords.length < 2) return; // 되살릴 가치가 없다
    const packed: InProgressRun = {
      ...run,
      at: Date.now(),
      coords: run.coords.map(([la, ln]) => [r5(la), r5(ln)] as LatLng),
      elevations: run.elevations.map((e) => Math.round(e * 10) / 10),
      cumDist: run.cumDist.map((d) => Math.round(d)),
    };
    localStorage.setItem(KEY, JSON.stringify(packed));
  } catch {
    // 용량 초과 등 — 안전망이 실패해도 진행 중인 기록 자체를 방해하면 안 된다
  }
}

export function clearInProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 무시 */
  }
}

/** 되살릴 만한 기록이 있으면 반환. 손상·오래된 값은 조용히 버린다. */
export function loadInProgress(): InProgressRun | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as InProgressRun;
    const ok =
      v &&
      typeof v.at === 'number' &&
      Date.now() - v.at < MAX_AGE_MS &&
      Array.isArray(v.coords) &&
      v.coords.length >= 2 &&
      v.coords.every(
        (c) => Array.isArray(c) && c.length === 2 && c.every((n) => Number.isFinite(n)),
      ) &&
      typeof v.distanceKm === 'number' &&
      Number.isFinite(v.distanceKm);
    if (!ok) {
      clearInProgress();
      return null;
    }
    return v;
  } catch {
    clearInProgress();
    return null;
  }
}
