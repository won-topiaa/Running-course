import { memo, Suspense } from 'react';
import { lazyWithReload } from '../lib/lazyRetry';
import { useKakao } from '../lib/useKakao';
import type { LiveMapProps } from './mapTypes';
import KakaoLiveMap from './KakaoLiveMap';

// Leaflet 은 카카오맵이 없을 때만 쓰는 폴백이다. 정적으로 묶으면 한국 사용자
// 대부분이 쓰지도 않을 지도 엔진을 첫 로딩에 같이 받게 되므로 분리한다.
const LeafletLiveMap = lazyWithReload(() => import('./LeafletLiveMap'));

/** 카카오맵 또는 Leaflet(폴백) 라이브 트랙 지도 */
function LiveMap(props: LiveMapProps) {
  const { kakao, status } = useKakao(props.kakaoKey ?? null);
  if (status === 'ready' && kakao) return <KakaoLiveMap {...props} kakao={kakao} />;
  // 카카오 SDK 를 기다리는 동안에는 Leaflet 을 받지 않는다. 여기서 미리 마운트하면
  // 카카오가 뜨는 순간 지도를 두 번 초기화해 깜빡이고, 쓰지도 않을 폴백 엔진을
  // 모든 사용자가 내려받게 된다. 실패가 확정된 뒤(unavailable)에만 폴백한다.
  if (status === 'loading') return <div className="h-full w-full animate-pulse bg-ink-soft" />;
  return (
    <Suspense fallback={<div className="h-full w-full bg-ink-soft" />}>
      <LeafletLiveMap {...props} />
    </Suspense>
  );
}

/**
 * 지도는 좌표가 실제로 바뀔 때만 다시 그린다.
 * 러닝 화면은 경과 시간 때문에 1초마다 재렌더되는데, 그때마다 폴리라인 전체를
 * 다시 투영하면 긴 러닝일수록 눈에 띄게 버벅인다.
 */
export default memo(LiveMap);
