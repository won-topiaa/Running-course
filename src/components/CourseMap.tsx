import { Fragment, useEffect, useMemo } from 'react';
import L from 'leaflet';
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import type { Recommendation } from '../lib/types';
import { SEOUL_CENTER } from '../data/courses';

interface Props {
  recommendations: Recommendation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** 선택/초기 상태에 따라 지도 뷰포트를 조정하는 내부 컨트롤러 */
function ViewController({
  recommendations,
  selectedId,
}: {
  recommendations: Recommendation[];
  selectedId: string | null;
}) {
  const map = useMap();

  // 선택된 코스가 있으면 그 경로에 맞춰 이동, 없으면 전체 코스에 맞춤
  useEffect(() => {
    if (selectedId) {
      const rec = recommendations.find((r) => r.course.id === selectedId);
      if (rec) {
        const bounds = L.latLngBounds(rec.course.path as [number, number][]);
        map.flyToBounds(bounds, { padding: [60, 60], duration: 0.6 });
      }
      return;
    }
    const all = recommendations.flatMap((r) => r.course.path);
    if (all.length > 0) {
      map.fitBounds(L.latLngBounds(all as [number, number][]), {
        padding: [40, 40],
      });
    }
  }, [selectedId, recommendations, map]);

  return null;
}

export default function CourseMap({
  recommendations,
  selectedId,
  onSelect,
}: Props) {
  // 코스별 순위 매핑
  const rankById = useMemo(() => {
    const m = new Map<string, number>();
    recommendations.forEach((r, i) => m.set(r.course.id, i));
    return m;
  }, [recommendations]);

  return (
    <MapContainer
      center={SEOUL_CENTER}
      zoom={12}
      className="map"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      {recommendations.map((rec) => {
        const { course, matchScore } = rec;
        const rank = rankById.get(course.id) ?? 99;
        const isSelected = course.id === selectedId;
        const isTop = rank < 3;

        const color = isSelected || isTop ? 'var(--accent)' : '#94a3b8';
        const weight = isSelected ? 6 : isTop ? 4 : 3;
        const opacity = isSelected ? 1 : isTop ? 0.85 : selectedId ? 0.25 : 0.5;

        const start = course.path[0] as [number, number];

        return (
          <Fragment key={course.id}>
            <Polyline
              positions={course.path as [number, number][]}
              pathOptions={{ color, weight, opacity }}
              eventHandlers={{ click: () => onSelect(course.id) }}
            />
            <CircleMarker
              center={start}
              radius={isSelected ? 9 : 6}
              pathOptions={{
                color: '#fff',
                weight: 2,
                fillColor: color,
                fillOpacity: opacity,
              }}
              eventHandlers={{ click: () => onSelect(course.id) }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <strong>{course.name}</strong>
                <br />
                매칭 {matchScore}% · {course.distanceKm}km
              </Tooltip>
            </CircleMarker>
          </Fragment>
        );
      })}

      <ViewController
        recommendations={recommendations}
        selectedId={selectedId}
      />
    </MapContainer>
  );
}
