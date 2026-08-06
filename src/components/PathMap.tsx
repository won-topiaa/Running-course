import { useKakao } from '../lib/useKakao';
import KakaoPathMap from './KakaoPathMap';
import LeafletPathMap from './LeafletPathMap';
import type { PathMapProps } from './mapTypes';

/** 카카오맵 또는 Leaflet(폴백) 단일 경로 지도 */
export default function PathMap(props: PathMapProps) {
  const { kakao, status } = useKakao(props.kakaoKey ?? null);
  if (status === 'ready' && kakao && props.path.length > 0) {
    return <KakaoPathMap {...props} kakao={kakao} />;
  }
  return <LeafletPathMap {...props} />;
}
