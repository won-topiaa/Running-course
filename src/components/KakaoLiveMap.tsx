import { useEffect, useRef } from 'react';
import type { LiveMapProps } from './mapTypes';
import type { LatLng } from '../lib/types';

/** 카카오맵 기반 라이브 트랙 (기록 화면) */
export default function KakaoLiveMap({ kakao, coords, center }: LiveMapProps & { kakao: any }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const lineRef = useRef<any>(null);
  const dotRef = useRef<any>(null);

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
      if (coords.length > 1) {
        const path = coords.map((p: LatLng) => new kakao.maps.LatLng(p[0], p[1]));
        if (!lineRef.current) {
          lineRef.current = new kakao.maps.Polyline({
            strokeWeight: 6,
            strokeColor: '#FF7A59',
            strokeOpacity: 1,
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
            content:
              '<div style="width:18px;height:18px;border-radius:50%;background:#FF7A59;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>',
          });
          dotRef.current.setMap(map);
        } else {
          dotRef.current.setPosition(pos);
        }
        map.panTo(pos);
      }
    } catch {
      /* 무시 */
    }
  }, [kakao, coords]);

  return <div ref={boxRef} className="h-full w-full" />;
}
