import { useId } from 'react';
import type { Course } from '../lib/types';

interface Props {
  course: Course;
  height?: number;
}

/** 고도 프로파일을 부드러운 영역 차트로 그린다 (SVG, 의존성 없음). */
export default function ElevationChart({ course, height = 96 }: Props) {
  const gradId = useId();
  const { profile } = course.elevation;
  const width = 320;
  const padY = 8;

  const min = Math.min(...profile);
  const max = Math.max(...profile);
  // 실제 고저차가 작은 평지 코스가 언덕처럼 과장돼 보이지 않도록
  // 세로 표시 범위에 최소값(30m)을 둔다. 실제 수치는 아래 메타에 표기.
  const visualRange = Math.max(max - min, 30);

  const n = profile.length;
  const stepX = width / (n - 1);
  const y = (h: number) =>
    padY + (1 - (h - min) / visualRange) * (height - padY * 2);

  const pts = profile.map((h, i) => [i * stepX, y(h)] as const);
  const linePath = pts
    .map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <div className="elev-chart" aria-label="고도 프로파일">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        role="img"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path
          d={linePath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="elev-meta">
        <span>거리 {course.distanceKm}km</span>
        <span>고도 {Math.round(min)}~{Math.round(max)}m</span>
        <span>누적 상승 {course.elevation.gainM}m</span>
      </div>
    </div>
  );
}
