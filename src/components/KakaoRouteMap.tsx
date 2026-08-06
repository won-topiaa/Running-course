import { useEffect, useRef } from 'react';
import { labelPinHtml, numberPinHtml } from './mapMarkers';
import type { RouteMapProps } from './mapTypes';
import { coloredSegments } from '../lib/routeColor';
import type { LatLng } from '../lib/types';

/** 카카오맵 기반 빌더 지도 (경사 색상 경로 · 핀 · 클릭) */
export default function KakaoRouteMap({
  kakao,
  mode,
  center,
  waypoints,
  start,
  route,
  onMapClick,
  alternatives = [],
}: RouteMapProps & { kakao: any }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  // 지도 생성
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !kakao?.maps) return;
    try {
      const map = new kakao.maps.Map(box, {
        center: new kakao.maps.LatLng(center[0], center[1]),
        level: 5,
      });
      mapRef.current = map;
      kakao.maps.event.addListener(map, 'click', (e: any) => {
        clickRef.current([e.latLng.getLat(), e.latLng.getLng()]);
      });
      setTimeout(() => map.relayout(), 0);
    } catch {
      /* 무시 — 폴백은 상위 스위처가 처리 */
    }
    return () => {
      mapRef.current = null;
      if (box) box.innerHTML = '';
    };
    // center 는 최초 1회만 사용
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kakao]);

  // 경로 · 마커 재그리기
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !kakao?.maps) return;
    try {
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current = [];
      const add = (o: any) => {
        o.setMap(map);
        overlaysRef.current.push(o);
      };
      const toPath = (pts: LatLng[]) => pts.map((p) => new kakao.maps.LatLng(p[0], p[1]));

      // 선택 안 된 후보 — 흐린 점선
      for (const alt of alternatives) {
        add(
          new kakao.maps.Polyline({
            path: toPath(alt),
            strokeWeight: 3,
            strokeColor: '#9B9088',
            strokeOpacity: 0.55,
            strokeStyle: 'shortdash',
          }),
        );
      }

      if (route) {
        add(
          new kakao.maps.Polyline({
            path: toPath(route.coords),
            strokeWeight: 8,
            strokeColor: '#ffffff',
            strokeOpacity: 0.9,
          }),
        );
        for (const g of coloredSegments(route)) {
          add(
            new kakao.maps.Polyline({
              path: toPath(g.positions),
              strokeWeight: 5,
              strokeColor: g.color,
              strokeOpacity: 1,
            }),
          );
        }
      }

      if (mode === 'pins') {
        waypoints.forEach((w, i) =>
          add(
            new kakao.maps.CustomOverlay({
              position: new kakao.maps.LatLng(w[0], w[1]),
              content: numberPinHtml(i + 1),
              yAnchor: 1,
            }),
          ),
        );
      } else if (start) {
        add(
          new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(start[0], start[1]),
            content: labelPinHtml('출발'),
            yAnchor: 1,
          }),
        );
      }

      // 화면 맞추기
      const pts: LatLng[] = route ? route.coords : [...waypoints, ...(start ? [start] : [])];
      if (pts.length === 1) {
        map.setCenter(new kakao.maps.LatLng(pts[0][0], pts[0][1]));
        map.setLevel(4);
      } else if (pts.length > 1) {
        const bounds = new kakao.maps.LatLngBounds();
        pts.forEach((p) => bounds.extend(new kakao.maps.LatLng(p[0], p[1])));
        map.setBounds(bounds);
      }
    } catch {
      /* 무시 */
    }
  }, [kakao, route, waypoints, start, mode]);

  return <div ref={boxRef} className="kakao-soft h-full w-full" />;
}
