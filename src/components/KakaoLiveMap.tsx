import { MUTED, VOLT } from '../ui/theme';
import { useEffect, useRef } from 'react';
import type { LiveMapProps } from './mapTypes';
import type { LatLng } from '../lib/types';

/** 카카오맵 기반 라이브 트랙 (기록 화면) */
export default function KakaoLiveMap({
  kakao,
  coords,
  center,
  plannedPath,
  traveled,
}: LiveMapProps & { kakao: any }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const lineRef = useRef<any>(null);
  const dotRef = useRef<any>(null);
  const planRef = useRef<any[]>([]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !kakao?.maps) return;
    try {
      const map = new kakao.maps.Map(box, {
        center: new kakao.maps.LatLng(center[0], center[1]),
        level: 3,
      });
      mapRef.current = map;
      setTimeout(() => map.relayout(), 0);
    } catch {
      /* 무시 */
    }
    return () => {
      mapRef.current = null;
      lineRef.current = null;
      dotRef.current = null;
      if (box) box.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kakao]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !kakao?.maps) return;
    try {
      const cur = coords.length ? coords[coords.length - 1] : null;

      // 계획 경로: 아직 안 지난 구간은 '따라갈 눈금'(대시), 지나온 구간은 경사
      // 색상 밑칠. 그 위에 내가 실제로 뛴 트랙을 실선으로 얹는다.
      if (plannedPath || traveled) {
        planRef.current.forEach((o) => o.setMap(null));
        planRef.current = [];
        const toPath = (pts: LatLng[]) => pts.map((p) => new kakao.maps.LatLng(p[0], p[1]));
        if (plannedPath && plannedPath.length > 1) {
          const pl = new kakao.maps.Polyline({
            path: toPath(plannedPath),
            strokeWeight: 7,
            strokeColor: MUTED,
            strokeOpacity: 0.75,
            strokeStyle: 'shortdash',
            zIndex: 1,
          });
          pl.setMap(map);
          planRef.current.push(pl);
        }
        for (const g of traveled ?? []) {
          const pl = new kakao.maps.Polyline({
            path: toPath(g.positions),
            strokeWeight: 7,
            strokeColor: g.color,
            strokeOpacity: 0.5,
            zIndex: 2,
          });
          pl.setMap(map);
          planRef.current.push(pl);
        }
      }

      // 내가 실제로 지나온 길. 예전엔 계획 경로가 있으면 이 줄을 통째로 건너뛰어,
      // 코스를 따라 뛰는 내내 '내가 실제로 어디로 갔는지'가 화면에 없었다.
      if (coords.length > 1) {
        const path = coords.map((p: LatLng) => new kakao.maps.LatLng(p[0], p[1]));
        if (!lineRef.current) {
          lineRef.current = new kakao.maps.Polyline({
            strokeWeight: 5,
            strokeColor: VOLT,
            strokeOpacity: 1,
            zIndex: 3,
          });
          lineRef.current.setMap(map);
        }
        lineRef.current.setPath(path);
      }
      if (cur) {
        const pos = new kakao.maps.LatLng(cur[0], cur[1]);
        if (!dotRef.current) {
          dotRef.current = new kakao.maps.CustomOverlay({
            position: pos,
            content: `<div style="width:18px;height:18px;border-radius:50%;background:${VOLT};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>`,
          });
          dotRef.current.setMap(map);
        } else {
          dotRef.current.setPosition(pos);
        }
        // Leaflet 쪽과 같은 이유로 (1) 애니메이션 없이 (2) 가운데 근처면
        // 아예 안 옮긴다. panTo 는 매 좌표마다 애니메이션을 새로 시작해
        // 서로 겹치고, 지도가 쉴 새 없이 흔들린다.
        if (!nearCenter(map, cur)) map.setCenter(pos);
      }
    } catch {
      /* 무시 */
    }
  }, [kakao, coords, plannedPath, traveled]);

  return <div ref={boxRef} className="kakao-soft h-full w-full" />;
}

/** 현재 위치가 화면 가운데 50% 안에 있는지 (밖이면 지도를 옮긴다) */
function nearCenter(map: any, at: LatLng): boolean {
  try {
    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    const padLat = (ne.getLat() - sw.getLat()) * 0.25;
    const padLng = (ne.getLng() - sw.getLng()) * 0.25;
    return (
      at[0] > sw.getLat() + padLat &&
      at[0] < ne.getLat() - padLat &&
      at[1] > sw.getLng() + padLng &&
      at[1] < ne.getLng() - padLng
    );
  } catch {
    return false; // 판단 못 하면 따라간다
  }
}
