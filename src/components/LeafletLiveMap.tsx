import 'leaflet/dist/leaflet.css';
import '../lib/leafletPatch';
import { MUTED, VOLT } from '../ui/theme';
import { useEffect } from 'react';
import { CircleMarker, MapContainer, Polyline, useMap } from 'react-leaflet';
import BaseTiles from './BaseTiles';
import type { LiveMapProps } from './mapTypes';
import type { LatLng } from '../lib/types';

function Follow({ pos }: { pos: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (!pos) return;
    // 애니메이션 없이 따라간다. GPS 틱(±1초)마다 0.5초짜리 pan 애니메이션을
    // 새로 시작하면 서로 겹치고, 화면을 닫는 순간 진행 중이던 애니메이션이
    // 제거된 DOM 을 만져 Leaflet 내부(_leaflet_pos)가 터진다.
    //
    // 그리고 가운데 근처에 있으면 아예 안 옮긴다. 좌표가 들어올 때마다
    // 중앙으로 끌어당기면 지도가 계속 미세하게 흔들려서, 뛰면서 앞쪽 길을
    // 보려고 살짝 밀어 놓는 것도 안 된다. 화면 가장자리로 밀려날 때만 옮긴다.
    try {
      if (
        map
          .getBounds()
          .pad(-0.25)
          .contains(pos as [number, number])
      )
        return;
    } catch {
      /* 아직 크기가 안 잡힌 지도 — 그냥 옮긴다 */
    }
    map.panTo(pos as [number, number], { animate: false });
  }, [pos, map]);
  useEffect(() => {
    // 언마운트 시 남은 pan/zoom 애니메이션 정리
    return () => {
      try {
        map.stop();
      } catch {
        /* 이미 제거된 지도 */
      }
    };
  }, [map]);
  return null;
}

/** 기록 중 라이브 트랙 지도 — 현재 위치를 따라가며 지나온 경로를 그린다 */
export default function LeafletLiveMap({
  coords,
  center,
  mapboxToken,
  plannedPath,
  traveled,
}: LiveMapProps) {
  const cur = coords.length ? coords[coords.length - 1] : null;
  return (
    <MapContainer
      center={(cur ?? center) as [number, number]}
      zoom={16}
      zoomControl={false}
      zoomSnap={0.5}
      zoomDelta={0.5}
      wheelPxPerZoomLevel={120}
      className="h-full w-full"
      scrollWheelZoom
    >
      <BaseTiles token={mapboxToken} />

      {/* 아직 안 뛴 계획 구간 — 따라갈 눈금(대시) */}
      {plannedPath && plannedPath.length > 1 && (
        <Polyline
          positions={plannedPath as [number, number][]}
          pathOptions={{
            color: MUTED,
            weight: 7,
            opacity: 0.75,
            dashArray: '12 10',
            lineCap: 'butt',
          }}
        />
      )}
      {/* 지나온 계획 구간 — 경사 색상으로 채워진다 */}
      {traveled?.map((g, i) => (
        <Polyline
          key={`tvc${i}`}
          positions={g.positions as [number, number][]}
          pathOptions={{ color: g.color, weight: 7, opacity: 0.5 }}
        />
      ))}

      {/* 내가 실제로 지나온 길 — 계획 경로가 있어도 반드시 그린다.
          예전엔 `!plannedPath` 조건이 걸려 있어, 코스를 따라 뛰는 내내
          '내가 실제로 어디로 갔는지'가 화면에 아예 없었다. */}
      {coords.length > 1 && (
        <>
          <Polyline
            positions={coords as [number, number][]}
            pathOptions={{ color: '#fff', weight: 8, opacity: 0.9 }}
          />
          <Polyline
            positions={coords as [number, number][]}
            pathOptions={{ color: VOLT, weight: 5, opacity: 1 }}
          />
        </>
      )}
      {cur && (
        <CircleMarker
          center={cur as [number, number]}
          radius={9}
          pathOptions={{ color: '#fff', weight: 3, fillColor: VOLT, fillOpacity: 1 }}
        />
      )}
      <Follow pos={cur} />
    </MapContainer>
  );
}
