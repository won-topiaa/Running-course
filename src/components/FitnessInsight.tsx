import { Activity, MapPin, TrendingUp, Users } from 'lucide-react';
import {
  recentTrend,
  latestYear,
  topSeoulCenters,
  seoulTotalTests,
  formatCount,
  getTestCountData,
} from '../lib/testCounts';

export default function FitnessInsight() {
  const latest = latestYear();
  const trend = recentTrend(8);
  const data = getTestCountData();
  const seoulTop = topSeoulCenters(5);
  const seoulTotal = seoulTotalTests();

  // 데이터가 없으면 빈 카드를 띄우느니 통째로 뺀다
  if (!latest || trend.length === 0) return null;

  const maxTests = Math.max(...trend.map((t) => t.totalTests));

  return (
    <div className="rounded-3xl border border-line bg-paper p-4 shadow-soft">
      <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-espresso">
        <Activity size={16} className="text-coral" />
        국민체력100 참여 현황
      </h2>
      <p className="mt-1 text-[11.5px] leading-relaxed text-espresso-soft">
        전국 체력인증센터의 측정 참여 추세예요. 런코스의 체력 처방은 이 데이터를 기반으로 해요.
      </p>

      {/* 핵심 지표 3개 */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniStat
          icon={<Users size={14} className="text-coral" />}
          value={formatCount(data.totalMeasurements)}
          label="누적 측정건수"
        />
        <MiniStat
          icon={<MapPin size={14} className="text-coral" />}
          value={`${latest.centers}곳`}
          label={`${latest.year}년 인증센터`}
        />
        <MiniStat
          icon={<TrendingUp size={14} className="text-coral" />}
          value={`${data.seoulCenters.length}곳`}
          label="서울 인증센터"
        />
      </div>

      {/* 연도별 추세 미니 바 차트 */}
      <div className="mt-4">
        <span className="text-[12px] font-semibold text-espresso">연도별 측정 참여</span>
        <div className="mt-2 flex items-end gap-1.5" style={{ height: 64 }}>
          {trend.map((t) => {
            const h = Math.max(6, (t.totalTests / maxTests) * 56);
            return (
              <div key={t.year} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full items-end" style={{ height: 56 }}>
                  <div
                    className="w-full rounded-md bg-coral"
                    style={{ height: `${h}px` }}
                    title={`${t.year}년: ${t.totalTests.toLocaleString()}건`}
                  />
                </div>
                <span className="text-[9.5px] text-espresso-soft">{String(t.year).slice(2)}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10.5px] text-espresso-soft">
          {trend[0].year}년 {formatCount(trend[0].totalTests)}건 → {latest.year}년{' '}
          {formatCount(latest.totalTests)}건
        </p>
      </div>

      {/* 서울 인증센터 — 측정을 받으러 갈 곳을 알려 주는 쪽이 쓸모 있다 */}
      {seoulTop.length > 0 && (
        <div className="mt-4">
          <span className="text-[12px] font-semibold text-espresso">
            서울에서 많이 찾는 인증센터
          </span>
          <div className="mt-2 space-y-1.5">
            {seoulTop.map((c) => (
              <div key={c.name} className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate text-[11px] font-medium text-espresso-muted">
                  {c.name}
                </span>
                <div className="flex h-3.5 flex-1 overflow-hidden rounded-full bg-tint">
                  <div
                    className="h-full rounded-full bg-coral/70"
                    style={{ width: `${(c.totalTests / seoulTop[0].totalTests) * 100}%` }}
                  />
                </div>
                <span className="w-11 shrink-0 text-right text-[11px] font-semibold text-espresso-muted">
                  {formatCount(c.totalTests)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 서울 요약 */}
      <div className="mt-3 rounded-2xl bg-tint/60 px-3 py-2.5">
        <p className="text-[11.5px] leading-relaxed text-espresso-muted">
          서울 {data.seoulCenters.length}개 인증센터에서 지금까지 약{' '}
          <b className="text-espresso">{formatCount(seoulTotal)}건</b> 측정이 이뤄졌어요. 런코스는
          이 측정 결과를 기반으로 당신의 체력 백분위를 산출하고 맞춤 코스를 처방해요.
        </p>
      </div>
    </div>
  );
}

function MiniStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-2xl bg-tint/60 px-2.5 py-2.5 text-center">
      <div className="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full bg-coral-50">
        {icon}
      </div>
      <p className="text-[14px] font-extrabold leading-none text-espresso">{value}</p>
      <p className="mt-0.5 text-[10px] text-espresso-soft">{label}</p>
    </div>
  );
}
