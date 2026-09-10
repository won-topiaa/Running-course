import { useMemo } from 'react';
import { TrainFront } from 'lucide-react';
import { escapeStations, formatStationDistance } from '../lib/subway';
import type { LatLng } from '../lib/types';

/**
 * 중간에 그만둘 수 있는 역.
 *
 * 이게 '역에서 역으로 뛰기' 를 지도에 두 점 찍는 것과 갈라놓는 지점이다.
 * 힘들거나 비가 오면 다음 역에서 타고 집에 갈 수 있다는 걸 미리 보여 주면,
 * 낯선 길로도 나설 수 있다. 편도 코스의 '돌아올 방법이 없다' 는 걸림돌도
 * 여기서 풀린다.
 */
export default function EscapeStations({
  path,
  className = '',
}: {
  path?: LatLng[];
  className?: string;
}) {
  const stations = useMemo(() => (path ? escapeStations(path, 700, 6) : []), [path]);

  if (stations.length === 0) return null;

  return (
    <div className={`rounded-3xl border border-line bg-paper p-4 shadow-soft ${className}`}>
      <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-bold text-espresso">
        <TrainFront size={14} className="text-sage-600" />
        중간에 그만둘 수 있는 역
      </div>
      <p className="mb-2.5 text-[10.5px] leading-relaxed text-espresso-soft">
        경로에서 700m 안에 있는 역이에요. 힘들면 여기서 타고 돌아가면 돼요.
      </p>
      <div className="space-y-1.5">
        {stations.map((s) => (
          <div key={`${s.line}-${s.name}`} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-espresso">
              {s.name}
              <span className="ml-1 font-normal text-espresso-soft">{s.lineName}</span>
            </span>
            <span className="shrink-0 text-[11px] text-espresso-soft">
              {(s.alongM / 1000).toFixed(1)}km 지점 · {formatStationDistance(s.distanceM)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
