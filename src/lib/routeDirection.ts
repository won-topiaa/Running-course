// ---------------------------------------------------------------------------
// 경로 진행 방향 표시
// 경로만 그려두면 "어느 쪽으로 먼저 가야 하는지" 알 수 없다.
// 일정 간격마다 진행 방향 화살표를 놓고, 출발/도착 지점을 따로 표시하기 위한 계산.
// ---------------------------------------------------------------------------

import { haversineMeters } from './geo';
import type { LatLng } from './types';

export interface DirectionMarker {
  pos: LatLng;
  /** 화면 기준 회전각(도). 0 = 위쪽(북) */
  angleDeg: number;
}

/** a → b 방위각(도, 북 기준 시계방향) */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a[0]);
  const φ2 = toRad(b[0]);
  const Δλ = toRad(b[1] - a[1]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * 경로를 따라 spacingM 간격으로 진행 방향 화살표 위치를 뽑는다.
 * 시작/끝 부근은 출발·도착 마커와 겹치므로 비워 둔다.
 */
export function directionMarkers(
  coords: LatLng[],
  spacingM = 350,
  maxMarkers = 14,
): DirectionMarker[] {
  if (coords.length < 3) return [];
  const out: DirectionMarker[] = [];
  let acc = 0;
  let sinceLast = spacingM * 0.5; // 첫 화살표를 조금 일찍
  const total = coords.reduce(
    (s, c, i) => (i === 0 ? 0 : s + haversineMeters(coords[i - 1], c)),
    0,
  );
  const skipEnds = Math.min(120, total * 0.05); // 양 끝 여유

  for (let i = 1; i < coords.length; i++) {
    const d = haversineMeters(coords[i - 1], coords[i]);
    acc += d;
    sinceLast += d;
    if (
      sinceLast >= spacingM &&
      acc > skipEnds &&
      acc < total - skipEnds &&
      out.length < maxMarkers
    ) {
      out.push({ pos: coords[i], angleDeg: bearingDeg(coords[i - 1], coords[i]) });
      sinceLast = 0;
    }
  }
  return out;
}

/** 진행 방향 화살표 HTML (지도 오버레이 공용) */
export function arrowHtml(angleDeg: number): string {
  return `<div style="transform:rotate(${angleDeg}deg);width:20px;height:20px;display:grid;place-items:center;pointer-events:none">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#2C2725" stroke-width="3.2"
         stroke-linecap="round" stroke-linejoin="round"
         style="filter:drop-shadow(0 0 2px #fff) drop-shadow(0 0 2px #fff)">
      <path d="M12 19V5M5 12l7-7 7 7"/>
    </svg></div>`;
}

/** 출발 / 도착 배지 HTML */
export function endpointHtml(kind: 'start' | 'finish'): string {
  const isStart = kind === 'start';
  const bg = isStart ? '#7A9A8B' : '#2C2725';
  const text = isStart ? '출발' : '도착';
  return `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
    <div style="background:${bg};color:#fff;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 8px rgba(44,39,37,.3)">${text}</div>
    <div style="width:2px;height:7px;background:${bg}"></div>
    <div style="width:10px;height:10px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 3px rgba(44,39,37,.35)"></div>
  </div>`;
}
