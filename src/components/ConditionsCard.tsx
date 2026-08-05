import { Droplets, Shirt, Wind } from 'lucide-react';
import type { AqiLevel, RunConditions } from '../lib/weather';

const AQI_STYLE: Record<AqiLevel, { bg: string; text: string; dot: string }> = {
  good: { bg: 'bg-sage-100', text: 'text-sage-600', dot: '#7A9A8B' },
  moderate: { bg: 'bg-amber-100', text: 'text-amber-700', dot: '#D9A441' },
  bad: { bg: 'bg-coral-100', text: 'text-coral-600', dot: '#F2603E' },
  verybad: { bg: 'bg-red-100', text: 'text-red-700', dot: '#DC2626' },
};

function scoreColor(score: number): string {
  if (score >= 75) return '#7A9A8B';
  if (score >= 55) return '#D9A441';
  return '#F2603E';
}

export default function ConditionsCard({ c }: { c: RunConditions | null }) {
  if (!c) {
    return (
      <div className="h-[132px] animate-pulse rounded-3xl border border-line bg-paper" />
    );
  }
  const aqi = AQI_STYLE[c.aqiLevel];
  const ring = scoreColor(c.runScore);
  const dash = 2 * Math.PI * 26;

  return (
    <div className="animate-fadeUp rounded-3xl border border-line bg-paper p-4 shadow-soft">
      <div className="flex items-center gap-4">
        {/* 러닝 적합도 링 */}
        <div className="relative grid h-[72px] w-[72px] shrink-0 place-items-center">
          <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
            <circle cx="32" cy="32" r="26" fill="none" stroke="#F0EAE1" strokeWidth="7" />
            <circle
              cx="32"
              cy="32"
              r="26"
              fill="none"
              stroke={ring}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={dash}
              strokeDashoffset={dash * (1 - c.runScore / 100)}
            />
          </svg>
          <div className="absolute flex flex-col items-center leading-none">
            <span className="text-lg font-extrabold text-espresso">{c.runScore}</span>
            <span className="text-[9px] text-espresso-soft">적합도</span>
          </div>
        </div>

        {/* 날씨 요약 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{c.emoji}</span>
            <span className="text-2xl font-bold text-espresso">{c.tempC}°</span>
            <span className="text-[13px] text-espresso-muted">{c.condition}</span>
            <span
              className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${aqi.bg} ${aqi.text}`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: aqi.dot }} />
              미세먼지 {c.aqiLabel}
            </span>
          </div>
          <p className="mt-1.5 text-[13.5px] font-semibold leading-snug text-espresso">
            {c.headline}
          </p>
        </div>
      </div>

      {/* 디테일 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[12px] text-espresso-muted">
        <span className="inline-flex items-center gap-1">
          <Droplets size={13} /> 습도 {c.humidity}%
        </span>
        <span className="inline-flex items-center gap-1">
          <Wind size={13} /> 바람 {c.windKmh}km/h
        </span>
        <span className="inline-flex items-center gap-1 text-espresso">
          <Shirt size={13} className="text-coral" /> {c.outfit}
        </span>
      </div>
    </div>
  );
}
