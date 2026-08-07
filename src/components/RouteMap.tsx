import { lazy, memo, Suspense } from 'react';
import { useKakao } from '../lib/useKakao';
import type { RouteMapProps } from './mapTypes';
import KakaoRouteMap from './KakaoRouteMap';

// Leaflet 은 카카오맵이 없을 때만 쓰는 폴백이다. 정적으로 묶으면 한국 사용자
// 대부분이 쓰지도 않을 지도 엔진을 첫 로딩에 같이 받게 되므로 분리한다.
const LeafletRouteMap = lazy(() => import('./LeafletRouteMap').then((m) => ({ default: m.default })));

/** 카카오맵(키+SDK 가능 시) 또는 Leaflet(폴백) 빌더 지도 */
function RouteMap(props: RouteMapProps) {
  const { kakao, status } = useKakao(props.kakaoKey ?? null);
  if (status === 'ready' && kakao) return <KakaoRouteMap {...props} kakao={kakao} />;
  return (
    <Suspense fallback={<div className="h-full w-full bg-ink-soft" />}>
      <LeafletRouteMap {...props} />
    </Suspense>
  );
}

/**
 * 지도는 좌표가 실제로 바뀔 때만 다시 그린다.
 * 러닝 화면은 경과 시간 때문에 1초마다 재렌더되는데, 그때마다 폴리라인 전체를
 * 다시 투영하면 긴 러닝일수록 눈에 띄게 버벅인다.
 */
export default memo(RouteMap);
