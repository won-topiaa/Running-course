import { useEffect, useRef } from 'react';
import type { PathMapProps } from './mapTypes';
import type { LatLng } from '../lib/types';

/** 카카오맵 기반 단일 경로 표시 (상세 시트용) */
export default function KakaoPathMap({ kakao, path }: PathMapProps & { kakao: any }) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !kakao?.maps || path.length === 0) return;
    try {
      const map = new kakao.maps.Map(box, {
        center: new kakao.maps.LatLng(path[0][0], path[0][1]),
        level: 5,
        draggable: true,
      });
      const toPath = (pts: LatLng[]) => pts.map((p) => new kakao.maps.LatLng(p[0], p[1]));
      new kakao.maps.Polyline({
        path: toPath(path),
        strokeWeight: 7,
        strokeColor: '#ffffff',
        strokeOpacity: 0.9,
      }).setMap(map);
      new kakao.maps.Polyline({
        path: toPath(path),
        strokeWeight: 4,
        strokeColor: '#FF7A59',
        strokeOpacity: 1,
      }).setMap(map);
      new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(path[0][0], path[0][1]),
        content:
          '<div style="width:14px;height:14px;border-radius:50%;background:#7A9A8B;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>',
      }).setMap(map);

      if (path.length > 1) {
        const bounds = new kakao.maps.LatLngBounds();
        path.forEach((p) => bounds.extend(new kakao.maps.LatLng(p[0], p[1])));
        map.setBounds(bounds);
      }
      setTimeout(() => map.relayout(), 0);
    } catch {
      /* 무시 */
    }
    return () => {
      if (box) box.innerHTML = '';
    };
  }, [kakao, path]);

  return <div ref={boxRef} className="h-full w-full" />;
}
