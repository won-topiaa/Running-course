// ---------------------------------------------------------------------------
// 카카오맵 웹 링크 (URL 링크 방식)
//
// JavaScript SDK 와 달리 **API 키가 전혀 필요 없다.** 링크만 열면 카카오맵 웹/앱이
// 뜨므로, 지도 SDK 도메인 등록과 무관하게 항상 동작하는 보조 경로로 쓴다.
//   - 코스 시작점까지 길찾기 (도보 경로 안내는 카카오맵에 맡김)
//   - 지도에서 위치 보기
//   - 로드뷰로 실제 길 미리보기
// 모바일에서는 카카오맵 앱이 있으면 앱으로, 없으면 웹으로 열린다.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';

const BASE = 'https://map.kakao.com/link';

/** 링크에 들어갈 장소 이름 정리 (쉼표는 구분자라 제거) */
function safeName(name: string): string {
  return encodeURIComponent(name.replace(/,/g, ' ').trim() || '러닝 코스');
}

/** 지도에서 위치 보기 */
export function kakaoMapUrl(name: string, [lat, lng]: LatLng): string {
  return `${BASE}/map/${safeName(name)},${lat},${lng}`;
}

/** 해당 지점까지 길찾기 (출발지는 카카오맵이 현재 위치로 잡아준다) */
export function kakaoRouteUrl(name: string, [lat, lng]: LatLng): string {
  return `${BASE}/to/${safeName(name)},${lat},${lng}`;
}

/** 로드뷰 — 실제 노면·주변이 어떤지 미리 확인 */
export function kakaoRoadviewUrl([lat, lng]: LatLng): string {
  return `${BASE}/roadview/${lat},${lng}`;
}

export function openKakao(url: string): void {
  window.open(url, '_blank', 'noopener');
}
