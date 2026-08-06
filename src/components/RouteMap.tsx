import { useKakao } from '../lib/useKakao';
import KakaoRouteMap from './KakaoRouteMap';
import LeafletRouteMap from './LeafletRouteMap';
import type { RouteMapProps } from './mapTypes';

/** 카카오맵(키+SDK 가능 시) 또는 Leaflet(폴백) 빌더 지도 */
export default function RouteMap(props: RouteMapProps) {
  const { kakao, status } = useKakao(props.kakaoKey ?? null);
  if (status === 'ready' && kakao) return <KakaoRouteMap {...props} kakao={kakao} />;
  return <LeafletRouteMap {...props} />;
}
