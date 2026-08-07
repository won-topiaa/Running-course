import { gradeBand, GRADE_COLORS } from '../lib/routeStyle';

interface Props {
  elevations: number[];
  /** 각 구간 길이(m). 없으면 등간격으로 간주 */
  lengthsM?: number[];
  distanceKm: number;
  ascentM?: number;
  height?: number;
  className?: string;
}

/** 고도 프로파일을 구간 경사 색상으로 칠한 영역 차트 (의존성 없는 SVG) */
export default function GradeElevationChart({
  elevations,
  lengthsM,
  distanceKm,
  ascentM,
  height = 110,
  className = '',
}: Props) {
  const W = 340;
  const padTop = 10;
  const n = elevations.length;
  if (n < 2) return null;

  // x 좌표 (누적 거리 비율)
  const totalLen =
    lengthsM && lengthsM.length === n - 1
      ? lengthsM.reduce((a, b) => a + b, 0)
      : n - 1;
  const xs: number[] = [0];
  for (let i = 1; i < n; i++) {
    const seg = lengthsM && lengthsM.length === n - 1 ? lengthsM[i - 1] : 1;
    xs.push(xs[i - 1] + seg);
  }
  const X = (i: number) => (xs[i] / (totalLen || 1)) * W;

  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const visualRange = Math.max(max - min, 20); // 평지 과장 방지
  const Y = (h: number) =>
    padTop + (1 - (h - min) / visualRange) * (height - padTop - 4);

  // 구간별 경사 색상 폴리곤
  const segs = [];
  for (let i = 0; i < n - 1; i++) {
    const segLen = lengthsM && lengthsM.length === n - 1 ? lengthsM[i] : 1;
    const dz = elevations[i + 1] - elevations[i];
    const grade = segLen > 0.5 ? (dz / segLen) * 100 : 0;
    const color = GRADE_COLORS[gradeBand(grade)];
    const x0 = X(i);
    const x1 = X(i + 1);
    const y0 = Y(elevations[i]);
    const y1 = Y(elevations[i + 1]);
    segs.push(
      <polygon
        key={i}
        points={`${x0},${y0} ${x1},${y1} ${x1},${height} ${x0},${height}`}
        fill={color}
        fillOpacity={0.55}
      />,
    );
  }

  const line = elevations
    .map((h, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(h).toFixed(1)}`)
    .join(' ');

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        role="img"
        aria-label="구간별 경사 고도 프로파일"
      >
        {segs}
        <path d={line} fill="none" stroke="#FFFFFF" strokeOpacity={0.45} strokeWidth={1.5} />
      </svg>
      <div className="mt-1 flex justify-between text-[10.5px] text-espresso-soft">
        <span>거리 {distanceKm.toFixed(distanceKm < 10 ? 1 : 0)}km</span>
        <span>
          고도 {Math.round(min)}~{Math.round(max)}m
        </span>
        {ascentM != null && <span>총 오르막 {ascentM}m</span>}
      </div>
    </div>
  );
}
