// ---------------------------------------------------------------------------
// Leaflet 런타임 패치 (leaflet#7002)
//
// 줌 CSS 전환이 끝나기 전에 지도가 제거되면(화면 전환 등) transitionend 가
// 이미 사라진 _mapPane 을 만져 "reading '_leaflet_pos'" 로 터진다.
// 줌 애니메이션을 꺼서 피할 수도 있지만 그러면 휠·핀치가 한 레벨씩 뚝뚝
// 튀어 조작감이 나빠지므로, 핸들러에 가드를 대는 쪽을 택했다.
// Leaflet 컴포넌트에서 side-effect import 로 한 번만 적용된다.
// ---------------------------------------------------------------------------

import L from 'leaflet';

const proto = L.Map.prototype as any;
if (!proto.__zoomEndGuarded) {
  proto.__zoomEndGuarded = true;
  const original = proto._onZoomTransitionEnd;
  proto._onZoomTransitionEnd = function (...args: unknown[]) {
    if (!this._mapPane) return; // 이미 제거된 지도 — 조용히 무시
    return original.apply(this, args);
  };
}
