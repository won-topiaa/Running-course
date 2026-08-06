import { useEffect } from 'react';
import { CircleMarker, MapContainer, Polyline, useMap } from 'react-leaflet';
import BaseTiles from './BaseTiles';
import type { LiveMapProps } from './mapTypes';
import type { LatLng } from '../lib/types';

function Follow({ pos }: { pos: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (pos) map.panTo(pos as [number, number], { animate: true, duration: 0.5 });
  }, [pos, map]);
  return null;
}

/** 기록 중 라이브 트랙 지도 — 현재 위치를 따라가며 지나온 경로를 그린다 */
export default function LeafletLiveMap({ coords, center, mapboxToken }: LiveMapProps) {
  const cur = coords.length ? coords[coords.length - 1] : null;
  return (
    <MapContainer
      center={(cur ?? center) as [number, number]}
      zoom={16}
      zoomControl={false}
      className="h-full w-full"
      scrollWheelZoom
    >
      <BaseTiles token={mapboxToken} />
      {coords.length > 1 && (
        <>
          <Polyline positions={coords as [number, number][]} pathOptions={{ color: '#fff', weight: 8, opacity: 0.9 }} />
          <Polyline positions={coords as [number, number][]} pathOptions={{ color: '#FF7A59', weight: 5, opacity: 1 }} />
        </>
      )}
      {cur && (
        <CircleMarker
          center={cur as [number, number]}
          radius={9}
          pathOptions={{ color: '#fff', weight: 3, fillColor: '#FF7A59', fillOpacity: 1 }}
        />
      )}
      <Follow pos={cur} />
    </MapContainer>
  );
}
