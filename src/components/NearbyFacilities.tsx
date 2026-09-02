import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import {
  loadFacilities,
  loadedFacilities,
  findNearRouteIn,
  findNearbyIn,
  formatDistance,
  type Facility,
  type NearbyFacility,
} from '../lib/facilities';
import type { LatLng } from '../lib/types';

function pick(facilities: Facility[], path?: LatLng[], center?: LatLng): NearbyFacility[] {
  if (path && path.length >= 2) return findNearRouteIn(facilities, path, 500, 4);
  if (center) return findNearbyIn(facilities, center, 1000, 4);
  return [];
}

export default function NearbyFacilities({
  path,
  center,
  className = '',
}: {
  path?: LatLng[];
  center?: LatLng;
  className?: string;
}) {
  // 시설 데이터(420KB)는 이 칸을 그릴 때 받아 온다. 이미 받아 뒀으면
  // 첫 렌더에서 바로 채워 깜빡임을 없앤다.
  const [facilities, setFacilities] = useState<Facility[] | null>(loadedFacilities);

  useEffect(() => {
    if (facilities) return;
    let alive = true;
    void loadFacilities().then((f) => {
      if (alive) setFacilities(f);
    });
    return () => {
      alive = false;
    };
  }, [facilities]);

  if (!facilities) return null;

  const nearby = pick(facilities, path, center);
  if (nearby.length === 0) return null;

  return (
    <div className={`rounded-3xl border border-line bg-paper p-4 shadow-soft ${className}`}>
      <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-espresso">
        <MapPin size={14} className="text-sage-600" />
        근처 공공체육시설
      </div>
      <div className="space-y-2">
        {nearby.map((f) => (
          <div key={f.id} className="flex items-start gap-2 rounded-2xl bg-sand-50 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-semibold text-espresso">{f.name}</div>
              <div className="mt-0.5 text-[11px] text-espresso-soft">
                {[f.district, f.type, formatDistance(f.distanceM)].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
