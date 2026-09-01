import { Users } from 'lucide-react';
import {
  estimateCongestion,
  estimateCongestionAtPoint,
  LEVEL_COLORS,
  type CongestionEstimate,
} from '../lib/congestion';
import type { LatLng } from '../lib/types';

interface Props {
  path?: LatLng[];
  center?: LatLng;
}

export default function CongestionBadge({ path, center }: Props) {
  const est: CongestionEstimate | null = path
    ? estimateCongestion(path)
    : center
      ? estimateCongestionAtPoint(center)
      : null;

  if (!est) return null;

  const color = LEVEL_COLORS[est.level];

  return (
    <div className="rounded-2xl border border-line bg-paper px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
          style={{ backgroundColor: `${color}22` }}
        >
          <Users size={14} style={{ color }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-espresso">예상 혼잡도</span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-bold"
              style={{ backgroundColor: `${color}22`, color }}
            >
              {est.label}
            </span>
          </div>
          {est.suggestion && (
            <p className="mt-0.5 text-[11.5px] text-espresso-soft">{est.suggestion}</p>
          )}
        </div>
      </div>
    </div>
  );
}
