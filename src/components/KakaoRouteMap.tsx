import { MUTED } from '../ui/theme';
import { useEffect, useRef } from 'react';
import { labelPinHtml, numberPinHtml } from './mapMarkers';
import { arrowHtml, directionMarkers, endpointHtml } from '../lib/routeDirection';
import type { RouteMapProps } from './mapTypes';
import { coloredSegments, displayCoords } from '../lib/routeColor';
import type { LatLng } from '../lib/types';

// 기본값을 렌더마다 새로 만들면(= [] 리터럴) 아래 재그리기 effect 의 의존성이
// 매번 달라져, 시트가 다시 그려질 때마다 오버레이가 전부 지워졌다 다시 만들어지고
// setBounds 가 사용자의 확대/이동을 되돌린다. 고정 상수를 쓴다.
const NO_ALTS: LatLng[][] = [];

/** 카카오맵 기반 빌더 지도 (경사 색상 경로 · 핀 · 클릭) */
export default function KakaoRouteMap({
  kakao,
  mode,
  center,
  waypoints,
  start,
  route,
  onMapClick,
  alternatives = NO_ALTS,
  onPinClick,
  plannedPath,
  fitInsets,
}: RouteMapProps & { kakao: any }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const pinClickRef = useRef(onPinClick);
  pinClickRef.current = onPinClick;

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

      // 아직 안 뛴 계획 경로 — 눈금(점선)
      if (plannedPath && plannedPath.length > 1) {
        add(
          new kakao.maps.Polyline({
            path: toPath(plannedPath),
            strokeWeight: 5,
            strokeColor: MUTED,
            strokeOpacity: 0.5,
            strokeStyle: 'dot',
          }),
        );
      }

      // 선택 안 된 후보 — 흐린 점선
      for (const alt of alternatives) {
        add(
          new kakao.maps.Polyline({
            path: toPath(alt),
            strokeWeight: 3,
            strokeColor: MUTED,
            strokeOpacity: 0.55,
            strokeStyle: 'shortdash',
          }),
        );
      }

      if (route) {
        add(
          new kakao.maps.Polyline({
            path: toPath(displayCoords(route)),
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

      // 진행 방향 화살표 + 출발/도착 — 어느 쪽으로 먼저 가는지 알려준다
      if (route && route.coords.length > 1) {
        for (const m of directionMarkers(route.coords)) {
          add(
            new kakao.maps.CustomOverlay({
              position: new kakao.maps.LatLng(m.pos[0], m.pos[1]),
              content: arrowHtml(m.angleDeg),
              clickable: false,
            }),
          );
        }
        const last = route.coords[route.coords.length - 1];
        add(
          new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(route.coords[0][0], route.coords[0][1]),
            content: endpointHtml('start'),
            yAnchor: 1,
            clickable: false,
          }),
        );
        add(
          new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(last[0], last[1]),
            content: endpointHtml('finish'),
            yAnchor: 1,
            clickable: false,
          }),
        );
      }

      if (mode === 'pins') {
        waypoints.forEach((w, i) => {
          const el = document.createElement('div');
          el.innerHTML = numberPinHtml(i + 1, !!pinClickRef.current);
          if (pinClickRef.current) {
            el.addEventListener('click', (ev) => {
              ev.stopPropagation();
              pinClickRef.current?.(i);
            });
          }
          add(
            new kakao.maps.CustomOverlay({
              position: new kakao.maps.LatLng(w[0], w[1]),
              content: el,
              yAnchor: 1,
            }),
          );
        });
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
        // setBounds(bounds, top, right, bottom, left) — 오버레이에 가리는 만큼
        // 위아래 여백을 다르게 줘서 경로가 '보이는 창' 안에 들어오게 한다.
        const top = fitInsets?.top ?? 0;
        const bottom = fitInsets?.bottom ?? 0;
        const usable = (boxRef.current?.clientHeight ?? 0) - top - bottom;
        if (top + bottom > 0 && usable >= 140) map.setBounds(bounds, top, 24, bottom, 24);
        else map.setBounds(bounds);
      }
    } catch {
      /* 무시 */
    }
  }, [kakao, route, waypoints, start, mode, alternatives, plannedPath, fitInsets]);

  return <div ref={boxRef} className="kakao-soft h-full w-full" />;
}
