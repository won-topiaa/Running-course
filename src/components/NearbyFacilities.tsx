import { useMemo } from 'react';
import { MapPin } from 'lucide-react';
import {
  findNearRoute,
  findNearby,
  amenityIcon,
  amenityLabel,
  formatDistance,
  type NearbyFacility,
  type FacilityAmenity,
} from '../lib/facilities';
import type { LatLng } from '../lib/types';

export default function NearbyFacilities({
  path,
  center,
  className = '',
}: {
  path?: LatLng[];
  center?: LatLng;
  className?: string;
}) {
  const facilities = useMemo<NearbyFacility[]>(() => {
    if (path && path.length >= 2) return findNearRoute(path, 500, 4);
    if (center) return findNearby(center, 1000, 4);
    return [];
  }, [path, center]);

  if (facilities.length === 0) return null;

  return (
    <div className={`rounded-3xl border border-line bg-paper p-4 shadow-soft ${className}`}>
      <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-espresso">
        <MapPin size={14} className="text-sage-600" />
        근처 공공체육시설
      </div>
      <div className="space-y-2">
        {facilities.map((f) => (
          <div
            key={f.id}
            className="flex items-start gap-2 rounded-2xl bg-sand-50 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-semibold text-espresso">
                {f.name}
              </div>
              <div className="mt-0.5 text-[11px] text-espresso-soft">
                {f.district} · {formatDistance(f.distanceM)}
              </div>
              {f.amenities.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {f.amenities.map((a) => (
                    <span
                      key={a}
                      className="inline-flex items-center gap-0.5 rounded-full bg-paper px-1.5 py-0.5 text-[10px] text-espresso-muted"
                    >
                      {amenityIcon(a as FacilityAmenity)}
                      {amenityLabel(a as FacilityAmenity)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
