import { useEffect } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  Polyline,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import BaseTiles from './BaseTiles';
import { labelPinHtml, numberPinHtml } from './mapMarkers';
import type { RouteMapProps } from './mapTypes';
import { coloredSegments } from '../lib/routeColor';
import type { RouteResult } from '../lib/routing';
import type { LatLng } from '../lib/types';

/** 번호 핀 */
function numberIcon(n: number) {
  return L.divIcon({
    className: '',
    html: numberPinHtml(n),
    iconSize: [26, 30],
    iconAnchor: [13, 30],
  });
}

/** 라벨 핀 (출발 등) */
function labelIcon(text: string) {
  return L.divIcon({
    className: '',
    html: labelPinHtml(text),
    iconSize: [60, 40],
    iconAnchor: [30, 40],
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
  alternatives = [],
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

      {/* 선택 안 된 후보 — 흐린 점선 */}
      {alternatives.map((alt, i) => (
        <Polyline
          key={`alt${i}`}
          positions={alt as [number, number][]}
          pathOptions={{
            color: '#9B9088',
            weight: 3,
            opacity: 0.55,
            dashArray: '7 8',
          }}
        />
      ))}

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
        <Marker position={start as [number, number]} icon={labelIcon('출발')} />
      )}

      <FitBounds route={route} waypoints={waypoints} start={start} />
    </MapContainer>
  );
}
