import { useId, type ReactNode } from 'react';
import type { Scene } from '../lib/scene';

interface Props {
  scene: Scene;
  className?: string;
  children?: ReactNode;
}

// 씬별 그라디언트/실루엣 — 외부 이미지 없이 '사진' 느낌을 낸다.
// 어두운 앱에 맞춰 해질녘~야간 톤으로 낮췄다. 밝은 주간 그라디언트는
// 검정 화면에서 카드만 형광등처럼 튀어서 목록을 훑기 어려웠다.
const SKY: Record<Scene, [string, string, string]> = {
  sunset: ['#7A3B2E', '#4A2233', '#1A1020'],
  river: ['#1E3A44', '#162A38', '#0D1620'],
  forest: ['#1E3527', '#16281E', '#0C1611'],
  city: ['#3A2740', '#241A33', '#100E1C'],
  dawn: ['#4A2B3C', '#2E1C2E', '#140E18'],
  autumn: ['#5A3A20', '#38241A', '#160F0C'],
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
            fill="#F2E4B8"
            opacity={scene === 'river' ? 0.28 : 0.42}
          />
        )}
        {scene === 'river' && (
          <rect x="0" y="150" width="400" height="90" fill="#2C5A6B" opacity="0.5" />
        )}
        <Silhouette scene={scene} color="#08080A" />
      </svg>
      {children && <div className="relative h-full w-full">{children}</div>}
    </div>
  );
}
