import { Eye, Navigation, Map as MapIcon } from 'lucide-react';
import {
  kakaoMapUrl,
  kakaoRoadviewUrl,
  kakaoRouteUrl,
  openKakao,
} from '../lib/kakaoLink';
import type { LatLng } from '../lib/types';

/**
 * 카카오맵으로 이어지는 보조 액션 (API 키 불필요).
 * 시작 지점까지 길찾기 · 지도 보기 · 로드뷰 미리보기.
 */
export default function KakaoLinkRow({
  name,
  point,
  className = '',
}: {
  name: string;
  point: LatLng;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1.5 text-[11.5px] font-semibold text-espresso-soft">
        카카오맵으로 열기
      </p>
      <div className="grid grid-cols-3 gap-2">
        <LinkBtn
          icon={<Navigation size={15} />}
          label="길찾기"
          onClick={() => openKakao(kakaoRouteUrl(`${name} 출발점`, point))}
        />
        <LinkBtn
          icon={<MapIcon size={15} />}
          label="지도 보기"
          onClick={() => openKakao(kakaoMapUrl(name, point))}
        />
        <LinkBtn
          icon={<Eye size={15} />}
          label="로드뷰"
          onClick={() => openKakao(kakaoRoadviewUrl(point))}
        />
      </div>
    </div>
  );
}

function LinkBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-2xl border border-line bg-paper py-2.5 text-[11.5px] font-semibold text-espresso-muted transition active:scale-95"
    >
      <span className="text-coral">{icon}</span>
      {label}
    </button>
  );
}
