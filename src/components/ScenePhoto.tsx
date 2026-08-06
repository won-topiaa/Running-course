import { useId, type ReactNode } from 'react';
import type { Scene } from '../lib/scene';

interface Props {
  scene: Scene;
  className?: string;
  children?: ReactNode;
}

// 씬별 그라디언트/실루엣 정의 — 외부 이미지 없이 따뜻한 '사진' 느낌을 낸다.
const SKY: Record<Scene, [string, string, string]> = {
  sunset: ['#FFD9A8', '#FF9E6B', '#F2603E'],
  river: ['#CDE8F0', '#9FD0DE', '#7AB8C9'],
  forest: ['#D6E7CE', '#9CC08A', '#6E9E6C'],
  city: ['#F6C79E', '#C98FA6', '#6E5E8C'],
  dawn: ['#FDE2E8', '#F7C0CE', '#E79BC4'],
  autumn: ['#F6E1A8', '#E8B472', '#C98A4B'],
};

function Silhouette({ scene, color }: { scene: Scene; color: string }) {
  switch (scene) {
    case 'city':
    case 'sunset':
      return (
        <g fill={color} opacity={0.85}>
          <rect x="20" y="150" width="34" height="90" />
          <rect x="60" y="120" width="26" height="120" />
          <rect x="92" y="165" width="30" height="75" />
          <rect x="128" y="135" width="22" height="105" />
          <rect x="300" y="140" width="28" height="100" />
          <rect x="334" y="120" width="24" height="120" />
          <rect x="364" y="158" width="30" height="82" />
        </g>
      );
    case 'forest':
      return (
        <g fill={color} opacity={0.9}>
          {[30, 78, 130, 300, 348, 392].map((x, i) => (
            <polygon key={i} points={`${x},240 ${x - 26},240 ${x - 13},${150 + (i % 2) * 18}`} />
          ))}
        </g>
      );
    case 'autumn':
      return (
        <g fill={color} opacity={0.8}>
          <ellipse cx="70" cy="210" rx="70" ry="34" />
          <ellipse cx="330" cy="215" rx="80" ry="36" />
        </g>
      );
    default:
      return (
        <g fill={color} opacity={0.75}>
          <ellipse cx="200" cy="250" rx="260" ry="40" />
        </g>
      );
  }
}

/** 씬 기반 그라디언트 '사진' 배경 */
export default function ScenePhoto({ scene, className = '', children }: Props) {
  const id = useId().replace(/:/g, '');
  const [c0, c1, c2] = SKY[scene];
  const hasSun = scene === 'sunset' || scene === 'dawn' || scene === 'river';

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <svg
        viewBox="0 0 400 240"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id={`sky${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c0} />
            <stop offset="55%" stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </linearGradient>
        </defs>
        <rect width="400" height="240" fill={`url(#sky${id})`} />
        {hasSun && (
          <circle
            cx="300"
            cy="86"
            r="34"
            fill="#FFF3DC"
            opacity={scene === 'river' ? 0.7 : 0.9}
          />
        )}
        {scene === 'river' && (
          <rect x="0" y="150" width="400" height="90" fill="#8FC3D4" opacity="0.55" />
        )}
        <Silhouette scene={scene} color={c2} />
      </svg>
      {children && <div className="relative h-full w-full">{children}</div>}
    </div>
  );
}
