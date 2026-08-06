import { useKakao } from '../lib/useKakao';
import KakaoLiveMap from './KakaoLiveMap';
import LeafletLiveMap from './LeafletLiveMap';
import type { LiveMapProps } from './mapTypes';

/** 카카오맵 또는 Leaflet(폴백) 라이브 트랙 지도 */
export default function LiveMap(props: LiveMapProps) {
  const { kakao, status } = useKakao(props.kakaoKey ?? null);
  if (status === 'ready' && kakao) return <KakaoLiveMap {...props} kakao={kakao} />;
  return <LeafletLiveMap {...props} />;
}
