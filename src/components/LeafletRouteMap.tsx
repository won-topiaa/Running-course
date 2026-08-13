import 'leaflet/dist/leaflet.css';
import '../lib/leafletPatch';
import { MUTED } from '../ui/theme';
import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
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
  return L.divIcon({
    className: '',
    html: arrowHtml(angleDeg),
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

/** 출발/도착 배지 */
function endpointIcon(kind: 'start' | 'finish') {
  return L.divIcon({
    className: '',
    html: endpointHtml(kind),
    iconSize: [52, 40],
    iconAnchor: [26, 40],
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

// 기본값을 렌더마다 새로 만들면(= [] 리터럴) FitBounds 의 의존성이 매번
// 달라져 화면 맞추기가 다시 돌고, 사용자가 확대·이동해 둔 지도가 되돌아간다.
const NO_ALTS: LatLng[][] = [];

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
  fitInsets,
}: {
  route: RouteResult | null;
  waypoints: LatLng[];
  start: LatLng | null;
  fitInsets?: { top: number; bottom: number };
}) {
  const map = useMap();
  const top = fitInsets?.top ?? 0;
  const bottom = fitInsets?.bottom ?? 0;
  useEffect(() => {
    const pts: LatLng[] = route ? route.coords : [...waypoints, ...(start ? [start] : [])];
    if (pts.length === 1) {
      map.setView(pts[0] as [number, number], 15);
    } else if (pts.length > 1) {
      const b = L.latLngBounds(pts as [number, number][]);
      // 남는 창이 너무 얇으면(입력 상태처럼 위아래가 다 차 있으면) 비대칭 여백이
      // 오히려 과하게 축소시킨다 — 그때는 예전처럼 균등 여백으로 맞춘다.
      const usable = map.getSize().y - top - bottom;
      // animate:false 가 핵심이다. 이 effect 는 결과가 바뀔 때 연달아 두 번
      // 도는데(여백 측정 전/후), 첫 호출의 줌 애니메이션이 도는 동안 들어온
      // 두 번째 setView 는 Leaflet 이 조용히 버린다(_tryAnimatedZoom 의
      // _animatingZoom 가드). 그래서 줌만 반영되고 비대칭 여백으로 옮긴
      // 중심은 사라져 경로가 화면 정중앙 = 시트 뒤로 갔다.
      if (top + bottom > 0 && usable >= 140) {
        map.fitBounds(b, {
          paddingTopLeft: [24, top],
          paddingBottomRight: [24, bottom],
          animate: false,
        });
      } else {
        map.fitBounds(b, { padding: [50, 50], animate: false });
      }
    }
  }, [route, waypoints, start, map, top, bottom]);
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
  alternatives = NO_ALTS,
  onPinClick,
  plannedPath,
  fitInsets,
}: RouteMapProps) {
  // 둘 다 경로 전체를 훑는 계산이다(방향 화살표는 haversine 을 2회 순회).
  // 렌더 본문에서 그냥 부르면 부모가 다시 그릴 때마다 — 카드 선택, 시트
  // 열림, 숲길 값 도착 등 — 15km 경로 기준 삼각함수가 수천 번씩 다시 돈다.
  // 경로가 바뀔 때만 계산한다.
  const colored = useMemo(() => coloredSegments(route), [route]);
  const arrows = useMemo(() => (route ? directionMarkers(route.coords) : []), [route]);

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
          pathOptions={{
            color: MUTED,
            weight: 5,
            opacity: 0.5,
            dashArray: '2 12',
            lineCap: 'round',
          }}
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
        arrows.map((m, i) => (
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

      <FitBounds route={route} waypoints={waypoints} start={start} fitInsets={fitInsets} />
    </MapContainer>
  );
}
