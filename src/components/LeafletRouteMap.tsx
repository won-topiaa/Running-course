import 'leaflet/dist/leaflet.css';
import '../lib/leafletPatch';
import { MUTED } from '../ui/theme';
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
import { arrowHtml, directionMarkers, endpointHtml } from '../lib/routeDirection';
import type { RouteMapProps } from './mapTypes';
import { coloredSegments } from '../lib/routeColor';
import type { RouteResult } from '../lib/routing';
import type { LatLng } from '../lib/types';

/** 번호 핀 */
function numberIcon(n: number, deletable: boolean) {
  return L.divIcon({
    className: '',
    html: numberPinHtml(n, deletable),
    iconSize: [26, 30],
    iconAnchor: [13, 30],
  });
}

/** 진행 방향 화살표 */
function arrowIcon(angleDeg: number) {
  return L.divIcon({ className: '', html: arrowHtml(angleDeg), iconSize: [20, 20], iconAnchor: [10, 10] });
}

/** 출발/도착 배지 */
function endpointIcon(kind: 'start' | 'finish') {
  return L.divIcon({ className: '', html: endpointHtml(kind), iconSize: [52, 40], iconAnchor: [26, 40] });
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
  onPinClick,
  plannedPath,
}: RouteMapProps) {
  const colored = coloredSegments(route);

  return (
    <MapContainer
      center={center}
      zoom={14}
      zoomControl={false}
      // 줌 감도를 절반으로 — 기본값은 휠 한 칸에 한 레벨씩 튀어
      // 확대/축소가 널뛰기처럼 느껴진다 (전환 중 제거 크래시는 leafletPatch 가 막는다)
      zoomSnap={0.5}
      zoomDelta={0.5}
      wheelPxPerZoomLevel={120}
      className="h-full w-full"
      scrollWheelZoom
    >
      <BaseTiles token={mapboxToken} />
      <ClickHandler onClick={onMapClick} />

      {/* 아직 안 뛴 계획 경로 — 눈금(점선) */}
      {plannedPath && plannedPath.length > 1 && (
        <Polyline
          positions={plannedPath as [number, number][]}
          pathOptions={{ color: MUTED, weight: 5, opacity: 0.5, dashArray: '2 12', lineCap: 'round' }}
        />
      )}

      {/* 선택 안 된 후보 — 흐린 점선 */}
      {alternatives.map((alt, i) => (
        <Polyline
          key={`alt${i}`}
          positions={alt as [number, number][]}
          pathOptions={{
            color: MUTED,
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

      {/* 진행 방향 — 어느 쪽으로 먼저 가는지 */}
      {route &&
        directionMarkers(route.coords).map((m, i) => (
          <Marker
            key={`dir${i}`}
            position={m.pos as [number, number]}
            icon={arrowIcon(m.angleDeg)}
            interactive={false}
          />
        ))}
      {route && route.coords.length > 1 && (
        <>
          <Marker
            position={route.coords[0] as [number, number]}
            icon={endpointIcon('start')}
            interactive={false}
          />
          <Marker
            position={route.coords[route.coords.length - 1] as [number, number]}
            icon={endpointIcon('finish')}
            interactive={false}
          />
        </>
      )}

      {mode === 'pins' &&
        waypoints.map((w, i) => (
          <Marker
            key={i}
            position={w as [number, number]}
            icon={numberIcon(i + 1, !!onPinClick)}
            eventHandlers={onPinClick ? { click: () => onPinClick(i) } : undefined}
          />
        ))}
      {mode === 'distance' && start && (
        <Marker position={start as [number, number]} icon={labelIcon('출발')} />
      )}

      <FitBounds route={route} waypoints={waypoints} start={start} />
    </MapContainer>
  );
}
