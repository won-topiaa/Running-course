import { useState } from 'react';
import {
  Activity,
  Check,
  Flame,
  Footprints,
  Map as MapIcon,
  Timer,
} from 'lucide-react';
import { PROFILE } from '../data/profile';
import { estimateTimeLabel, formatPace } from '../lib/format';
import type { Settings } from '../lib/config';
import type { AppApi } from '../ui/appApi';

export default function MyScreen({ api }: { api: AppApi }) {
  const p = PROFILE;
  const pace = api.settings.paceSecPerKm;
  const maxWeek = Math.max(...p.weekly.map((w) => w.km), 8);
  const goalPct = Math.min(100, Math.round((p.weekKm / p.weekGoalKm) * 100));

  const setPace = (v: number) => api.setSettings({ ...api.settings, paceSecPerKm: v });
  const saveField = (field: keyof Settings, value: string) =>
    api.setSettings({ ...api.settings, [field]: value.trim() || null });

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-28 pt-5">
      {/* 프로필 */}
      <div className="flex items-center gap-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-coral-50 text-3xl">
          {p.emoji}
        </span>
        <div>
          <h1 className="text-[19px] font-extrabold text-espresso">{p.name}</h1>
          <p className="text-[12.5px] text-espresso-muted">
            {p.level} · 함께한 지 {p.joinedMonths}개월
          </p>
        </div>
      </div>

      {/* 이번 주 목표 */}
      <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold text-espresso">이번 주 러닝</span>
          <span className="text-[12.5px] text-espresso-muted">
            <b className="text-coral-600">{p.weekKm}km</b> / {p.weekGoalKm}km 목표
          </span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-tint">
          <div className="h-full rounded-full bg-coral" style={{ width: `${goalPct}%` }} />
        </div>
        {/* 주간 막대 */}
        <div className="mt-4 flex items-end justify-between gap-2" style={{ height: 74 }}>
          {p.weekly.map((w) => (
            <div key={w.label} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end">
                <div
                  className={`w-full rounded-md ${w.km > 0 ? 'bg-sage' : 'bg-line'}`}
                  style={{ height: `${Math.max(4, (w.km / maxWeek) * 56)}px` }}
                  title={`${w.km}km`}
                />
              </div>
              <span className="text-[10.5px] text-espresso-soft">{w.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 스탯 타일 */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <StatTile icon={<Footprints size={16} className="text-coral" />} value={`${p.totalKm}`} unit="km" label="누적 거리" />
        <StatTile icon={<Flame size={16} className="text-coral" />} value={`${p.streakDays}`} unit="일" label="연속 러닝" />
        <StatTile icon={<MapIcon size={16} className="text-coral" />} value={`${p.courseVariety}`} unit="곳" label="다녀온 코스" />
      </div>

      {/* 러닝화 마일리지 */}
      <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
        <h2 className="text-[14px] font-bold text-espresso">👟 러닝화 마일리지</h2>
        <div className="mt-3 space-y-3">
          {p.shoes.map((s) => {
            const pct = Math.min(100, Math.round((s.mileageKm / s.limitKm) * 100));
            const warn = pct >= 80;
            return (
              <div key={s.name}>
                <div className="flex justify-between text-[12.5px]">
                  <span className="font-semibold text-espresso">
                    {s.emoji} {s.name}
                  </span>
                  <span className={warn ? 'font-semibold text-coral-600' : 'text-espresso-muted'}>
                    {s.mileageKm} / {s.limitKm}km
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-tint">
                  <div
                    className={`h-full rounded-full ${warn ? 'bg-coral' : 'bg-sage'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {warn && (
                  <p className="mt-1 text-[11px] text-coral-600">교체 시기가 다가와요.</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 배지 */}
      <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
        <h2 className="text-[14px] font-bold text-espresso">획득 배지</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {p.badges.map((b) => (
            <span
              key={b.label}
              className="inline-flex items-center gap-1.5 rounded-full bg-tint px-3 py-2 text-[12px] font-medium text-espresso"
            >
              <span className="text-base">{b.emoji}</span> {b.label}
            </span>
          ))}
        </div>
      </div>

      {/* 페이스 계산기 */}
      <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <h2 className="inline-flex items-center gap-1.5 text-[14px] font-bold text-espresso">
            <Timer size={16} className="text-coral" /> 페이스 계산기
          </h2>
          <span className="text-[16px] font-extrabold text-coral-600">{formatPace(pace)}/km</span>
        </div>
        <input
          type="range"
          min={210}
          max={480}
          step={5}
          value={pace}
          onChange={(e) => setPace(Number(e.target.value))}
          className="coral mt-3 w-full"
        />
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { label: '5K', km: 5 },
            { label: '10K', km: 10 },
            { label: '하프', km: 21.0975 },
          ].map((d) => (
            <div key={d.label} className="rounded-2xl bg-tint/70 py-2.5">
              <p className="text-[11px] text-espresso-soft">{d.label}</p>
              <p className="text-[14px] font-bold text-espresso">
                {estimateTimeLabel(d.km, pace)}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-espresso-soft">
          이 페이스는 코스별 예상 소요 시간에도 함께 반영돼요.
        </p>
      </div>

      {/* 외부 서비스 연동 */}
      <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
        <h2 className="text-[14px] font-bold text-espresso">🔌 외부 서비스 연동</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-espresso-muted">
          키를 넣으면 실지도·실경로가 켜져요. 없어도 앱은 오프라인 데모로 동작합니다.
        </p>

        <div className="mt-3 space-y-3">
          <KeyRow
            icon={<MapIcon size={15} className="text-coral" />}
            title="Mapbox 지도"
            desc="러닝 지도 배경(Outdoors). 없으면 OpenStreetMap."
            placeholder="pk.eyJ... 토큰"
            current={api.settings.mapboxToken}
            connected="Mapbox 연결됨"
            offline="OSM 사용 중"
            link="https://account.mapbox.com/access-tokens/"
            onSave={(v) => saveField('mapboxToken', v)}
          />
          <KeyRow
            icon={<Activity size={15} className="text-coral" />}
            title="OpenRouteService 경로"
            desc="코스 만들기의 실제 도로 경로·경사."
            placeholder="ORS API 키"
            current={api.settings.orsKey}
            connected="실경로 연결됨"
            offline="오프라인 데모"
            link="https://openrouteservice.org/dev/#/signup"
            onSave={(v) => saveField('orsKey', v)}
          />
          <KeyRow
            icon={<Activity size={15} style={{ color: '#FC4C02' }} />}
            title="Strava 자동 업로드 (선택)"
            desc="지금도 GPX 내보내기로 업로드 가능. 자동 업로드는 서버 콜백 필요."
            placeholder="Strava Client ID"
            current={api.settings.stravaClientId}
            connected="Client ID 등록됨"
            offline="GPX 수동 업로드"
            link="https://www.strava.com/settings/api"
            onSave={(v) => saveField('stravaClientId', v)}
          />
        </div>
      </div>
    </div>
  );
}

function KeyRow({
  icon,
  title,
  desc,
  placeholder,
  current,
  connected,
  offline,
  link,
  onSave,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  placeholder: string;
  current: string | null;
  connected: string;
  offline: string;
  link: string;
  onSave: (v: string) => void;
}) {
  const [val, setVal] = useState(current ?? '');
  const [done, setDone] = useState(false);
  const save = () => {
    onSave(val);
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  };
  return (
    <div className="rounded-2xl bg-tint/50 p-3">
      <div className="flex items-center gap-1.5 text-[13px] font-bold text-espresso">
        {icon} {title}
      </div>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-espresso-soft">{desc}</p>
      <div className="mt-2 flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-full border border-line bg-paper px-3.5 py-2 text-[12.5px] text-espresso outline-none focus:border-coral"
        />
        <button
          onClick={save}
          className="shrink-0 rounded-full bg-coral px-3.5 py-2 text-[12.5px] font-semibold text-white active:scale-95"
        >
          {done ? <Check size={15} /> : '저장'}
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold ${
            current ? 'text-sage-600' : 'text-espresso-soft'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${current ? 'bg-sage' : 'bg-espresso-soft/50'}`} />
          {current ? connected : offline}
        </span>
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="text-[11.5px] font-medium text-coral-600 underline"
        >
          키 발급 →
        </a>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  value,
  unit,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <div className="rounded-3xl border border-line bg-paper p-3.5 text-center shadow-soft">
      <div className="mx-auto mb-1 grid h-8 w-8 place-items-center rounded-full bg-coral-50">
        {icon}
      </div>
      <p className="text-[18px] font-extrabold leading-none text-espresso">
        {value}
        <span className="text-[11px] font-semibold text-espresso-soft"> {unit}</span>
      </p>
      <p className="mt-1 text-[11px] text-espresso-soft">{label}</p>
    </div>
  );
}
