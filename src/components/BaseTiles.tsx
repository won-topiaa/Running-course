import { TileLayer } from 'react-leaflet';

/**
 * 베이스 지도 타일.
 *
 * 기본은 OpenStreetMap 표준 타일 — 키 없이 쓸 수 있다.
 * Mapbox 토큰이 있으면 light 스타일을 쓴다.
 *
 * 원래는 CartoDB Positron 을 썼다. 연회색이라 그 위에 얹는 경사 색상 경로가
 * 더 또렷했는데, CARTO 가 무인증 요청에 'API KEY REQUIRED' 워터마크를 찍기
 * 시작해(2026-09 확인) 지도마다 그 글자가 박혔다. 응답은 200 에 정상 PNG 라
 * 코드 쪽에서는 실패로 잡히지도 않는다.
 *
 * 표준 타일은 Positron 보다 색이 진하지만, index.css 의 .leaflet-tile-pane
 * 필터(saturate 0.55 · brightness 0.78)가 눌러 주므로 톤은 그대로 유지된다.
 */
export default function BaseTiles({ token }: { token?: string | null }) {
  if (token) {
    return (
      <TileLayer
        attribution='&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; OpenStreetMap'
        url={`https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/512/{z}/{x}/{y}@2x?access_token=${token}`}
        tileSize={512}
        zoomOffset={-1}
        maxZoom={20}
      />
    );
  }
  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      maxZoom={19}
    />
  );
}
