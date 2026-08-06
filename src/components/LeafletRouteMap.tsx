import { useEffect } from 'react';
import L from 'leaflet';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import BaseTiles from './BaseTiles';
import type { RouteMapProps } from './mapTypes';
import { coloredSegments } from '../lib/routeColor';
import type { RouteResult } from '../lib/routing';
import type { LatLng } from '../lib/types';

/** 번호가 매겨진 핀 아이콘 */
function numberIcon(n: number, label?: string) {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-4px)">
      <div style="background:#FF7A59;color:#fff;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:grid;place-items:center;box-shadow:0 2px 6px rgba(44,39,37,.3);border:2px solid #fff">
        <span style="transform:rotate(45deg);font-size:12px;font-weight:800">${label ?? n}</span>
      </div></div>`,
    iconSize: [26, 30],
    iconAnchor: [13, 30],
  });
}

function ClickHandler({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onClick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

function FitBounds({
  route,
  waypoints,
  start,
}: {
  route: RouteResult | null;
  waypoints: LatLng[];
  start: LatLng | null;
}) {
  const map = useMap();
  useEffect(() => {
    const pts: LatLng[] = route ? route.coords : [...waypoints, ...(start ? [start] : [])];
    if (pts.length === 1) {
      map.setView(pts[0] as [number, number], 15);
    } else if (pts.length > 1) {
      map.fitBounds(L.latLngBounds(pts as [number, number][]), { padding: [50, 50] });
    }
  }, [route, waypoints, start, map]);
  return null;
}

export default function LeafletRouteMap({
  mode,
  center,
  waypoints,
  start,
  route,
  onMapClick,
  mapboxToken,
}: RouteMapProps) {
  const colored = coloredSegments(route);

  return (
    <MapContainer
      center={center}
      zoom={14}
      zoomControl={false}
      className="h-full w-full"
      scrollWheelZoom
    >
      <BaseTiles token={mapboxToken} />
      <ClickHandler onClick={onMapClick} />

      {route && (
        <>
          <Polyline
            positions={route.coords as [number, number][]}
            pathOptions={{ color: '#fff', weight: 8, opacity: 0.9 }}
          />
          {colored.map((g, i) => (
            <Polyline
              key={i}
              positions={g.positions as [number, number][]}
              pathOptions={{ color: g.color, weight: 5, opacity: 1 }}
            />
          ))}
        </>
      )}

      {mode === 'pins' &&
        waypoints.map((w, i) => (
          <Marker key={i} position={w as [number, number]} icon={numberIcon(i + 1)} />
        ))}
      {mode === 'distance' && start && (
        <>
          <Marker position={start as [number, number]} icon={numberIcon(0, '출발')} />
          <CircleMarker
            center={start as [number, number]}
            radius={7}
            pathOptions={{ color: '#fff', weight: 2, fillColor: '#FF7A59', fillOpacity: 1 }}
          />
        </>
      )}

      <FitBounds route={route} waypoints={waypoints} start={start} />
    </MapContainer>
  );
}
