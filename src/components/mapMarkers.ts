// 지도 마커 HTML (Leaflet divIcon · 카카오 CustomOverlay 공용)
//
// 색은 ui/theme.ts 한 곳에서 가져온다. 볼트 위에는 흰 글씨가 읽히지 않으므로
// 마커 글자는 잉크색이고, 테두리는 어떤 타일 위에서든 핀을 떼어내는 흰 halo.

import { HALO, INK, VOLT } from '../ui/theme';


/** 번호 핀 — 물방울 모양. deletable 이면 삭제 가능함을 알리는 × 배지를 붙인다. */
export function numberPinHtml(n: number, deletable = false): string {
  const badge = deletable
    ? `<div style="position:absolute;top:-5px;right:-5px;width:15px;height:15px;border-radius:50%;background:${INK};color:#fff;font-size:10px;font-weight:800;display:grid;place-items:center;border:1.5px solid ${HALO}">×</div>`
    : '';
  return `<div style="position:relative;display:flex;justify-content:center;transform:translateY(-2px);cursor:pointer">
    <div style="background:${VOLT};color:${INK};width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,.55);border:2px solid ${HALO}">
      <span style="transform:rotate(45deg);font-size:12px;font-weight:800">${n}</span>
    </div>${badge}</div>`;
}

/** 라벨 핀 — 글자가 들어가는 알약 모양 (예: 출발) */
export function labelPinHtml(text: string, color: string = VOLT): string {
  return `<div style="display:flex;flex-direction:column;align-items:center">
    <div style="background:${color};color:${INK};padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.5);border:2px solid ${HALO}">${text}</div>
    <div style="width:2px;height:8px;background:${color};opacity:.85"></div>
    <div style="width:9px;height:9px;border-radius:50%;background:${color};border:2px solid ${HALO};box-shadow:0 1px 3px rgba(0,0,0,.55)"></div>
  </div>`;
}
