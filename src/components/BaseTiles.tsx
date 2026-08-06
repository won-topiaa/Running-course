import { TileLayer } from 'react-leaflet';

/**
 * 베이스 지도 타일. Mapbox 토큰이 있으면 러닝에 적합한 Outdoors 스타일을,
 * 없으면 키가 필요 없는 OpenStreetMap 을 사용한다.
 */
export default function BaseTiles({ token }: { token?: string | null }) {
  if (token) {
    return (
      <TileLayer
        attribution='&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; OpenStreetMap'
        url={`https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${token}`}
        tileSize={512}
        zoomOffset={-1}
        maxZoom={20}
      />
    );
  }
  return (
    <TileLayer
      attribution="&copy; OpenStreetMap"
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      maxZoom={19}
    />
  );
}
