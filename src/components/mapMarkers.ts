// 지도 마커 HTML (Leaflet divIcon · 카카오 CustomOverlay 공용)

/** 번호 핀 — 물방울 모양 */
export function numberPinHtml(n: number): string {
  return `<div style="display:flex;justify-content:center;transform:translateY(-2px)">
    <div style="background:#FF7A59;color:#fff;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:grid;place-items:center;box-shadow:0 2px 6px rgba(44,39,37,.3);border:2px solid #fff">
      <span style="transform:rotate(45deg);font-size:12px;font-weight:800">${n}</span>
    </div></div>`;
}

/** 라벨 핀 — 글자가 들어가는 알약 모양 (예: 출발) */
export function labelPinHtml(text: string, color = '#FF7A59'): string {
  return `<div style="display:flex;flex-direction:column;align-items:center">
    <div style="background:${color};color:#fff;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;box-shadow:0 2px 8px rgba(44,39,37,.28);border:2px solid #fff">${text}</div>
    <div style="width:2px;height:8px;background:${color};opacity:.85"></div>
    <div style="width:9px;height:9px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(44,39,37,.3)"></div>
  </div>`;
}
