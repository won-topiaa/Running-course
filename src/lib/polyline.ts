// ---------------------------------------------------------------------------
// 폴리라인 인코딩 (Google Encoded Polyline Algorithm) + 코스 공유 코덱
// 좌표열을 짧은 문자열로 압축해 URL 해시에 담아 코스를 링크로 공유한다.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';

function encodeSigned(num: number): string {
  let sgn = num << 1;
  if (num < 0) sgn = ~sgn;
  let out = '';
  while (sgn >= 0x20) {
    out += String.fromCharCode((0x20 | (sgn & 0x1f)) + 63);
    sgn >>= 5;
  }
  out += String.fromCharCode(sgn + 63);
  return out;
}

export function encodePolyline(coords: LatLng[]): string {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const [lat, lng] of coords) {
    const iLat = Math.round(lat * 1e5);
    const iLng = Math.round(lng * 1e5);
    out += encodeSigned(iLat - prevLat);
    out += encodeSigned(iLng - prevLng);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out;
}

export function decodePolyline(str: string): LatLng[] {
  const coords: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < str.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

/** 좌표열을 최대 maxPoints 개로 균등 다운샘플 (끝점 보존) */
export function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr.slice();
  const step = (arr.length - 1) / (maxPoints - 1);
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

// --- 공유 코덱 --------------------------------------------------------------

export interface SharePayload {
  n: string; //   이름
  s?: string; //  스타일
  d: number; //   거리 km
  a: number; //   누적 상승 m
  g: number; //   최대 경사 %
  src: string; // 데이터 소스
  p: string; //   polyline
  e: number[]; // 다운샘플 고도
}

function b64urlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const b = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return decodeURIComponent(escape(atob(b)));
}

export function encodeShare(payload: SharePayload): string {
  return b64urlEncode(JSON.stringify(payload));
}

export function decodeShare(token: string): SharePayload | null {
  try {
    const obj = JSON.parse(b64urlDecode(token));
    if (typeof obj?.p === 'string' && typeof obj?.d === 'number') return obj as SharePayload;
  } catch {
    /* 무시 */
  }
  return null;
}
