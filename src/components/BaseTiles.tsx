import { TileLayer } from 'react-leaflet';

/**
 * 베이스 지도 타일.
 *
 * 기본은 CartoDB Positron — 건물·도로가 연회색이라 그 위에 얹는 경사 색상 경로가
 * 또렷하게 보인다(러닝 경로가 주인공, 지도는 배경). 키가 필요 없다.
 * Mapbox 토큰이 있으면 같은 톤의 light 스타일을 쓴다.
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
      attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap'
      url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      subdomains="abcd"
      maxZoom={20}
    />
  );
}
