import { useEffect } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Polyline, useMap } from 'react-leaflet';
import BaseTiles from './BaseTiles';
import type { LatLng } from '../lib/types';

function Fit({ path }: { path: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (path.length > 1) {
      map.fitBounds(L.latLngBounds(path as [number, number][]), { padding: [30, 30] });
    }
  }, [path, map]);
  return null;
}

/** 단일 경로를 보여주는 간단한 지도 (상세 시트용) */
export default function PathMap({
  path,
  mapboxToken,
}: {
  path: LatLng[];
  mapboxToken?: string | null;
}) {
  return (
    <MapContainer
      center={path[0] as [number, number]}
      zoom={14}
      zoomControl={false}
      className="h-full w-full"
      scrollWheelZoom={false}
    >
      <BaseTiles token={mapboxToken} />
      <Polyline positions={path as [number, number][]} pathOptions={{ color: '#fff', weight: 7, opacity: 0.9 }} />
      <Polyline positions={path as [number, number][]} pathOptions={{ color: '#FF7A59', weight: 4, opacity: 1 }} />
      <CircleMarker
        center={path[0] as [number, number]}
        radius={7}
        pathOptions={{ color: '#fff', weight: 2, fillColor: '#7A9A8B', fillOpacity: 1 }}
      />
      <Fit path={path} />
    </MapContainer>
  );
}
