import { lazy, memo, Suspense } from 'react';
import { useKakao } from '../lib/useKakao';
import type { PathMapProps } from './mapTypes';
import KakaoPathMap from './KakaoPathMap';

// Leaflet 은 카카오맵이 없을 때만 쓰는 폴백이다. 정적으로 묶으면 한국 사용자
// 대부분이 쓰지도 않을 지도 엔진을 첫 로딩에 같이 받게 되므로 분리한다.
const LeafletPathMap = lazy(() => import('./LeafletPathMap').then((m) => ({ default: m.default })));

/** 카카오맵 또는 Leaflet(폴백) 단일 경로 지도 */
function PathMap(props: PathMapProps) {
  const { kakao, status } = useKakao(props.kakaoKey ?? null);
  if (status === 'ready' && kakao && props.path.length > 0) {
    return <KakaoPathMap {...props} kakao={kakao} />;
  }
  // 카카오 SDK 를 기다리는 동안에는 Leaflet 을 받지 않는다 (LiveMap 주석 참고)
  if (status === 'loading') return <div className="h-full w-full animate-pulse bg-ink-soft" />;
  return (
    <Suspense fallback={<div className="h-full w-full bg-ink-soft" />}>
      <LeafletPathMap {...props} />
    </Suspense>
  );
}

/**
 * 지도는 좌표가 실제로 바뀔 때만 다시 그린다.
 * 러닝 화면은 경과 시간 때문에 1초마다 재렌더되는데, 그때마다 폴리라인 전체를
 * 다시 투영하면 긴 러닝일수록 눈에 띄게 버벅인다.
 */
export default memo(PathMap);
