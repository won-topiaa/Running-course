// ---------------------------------------------------------------------------
// 체력 — 마이 페이지의 기본 항목
//
// 별도 기능 버튼이 아니다. 나이·성별만 넣어도 또래 기준이 잡히고, 체력인증
// 센터 측정값을 넣으면 국민체력100 분포와 견줘 백분위·처방이 나온다.
// 그 처방은 추천 탭의 코스 순서에 언제나 반영된다.
//
// 화면이 지키는 것: 모르면 모른다고 쓴다. 표본이 모자라거나 기준 데이터를
// 못 받았으면 '상위 몇 %' 를 만들어 내지 않고 왜 못 냈는지를 말한다.
// ---------------------------------------------------------------------------

import { Activity } from 'lucide-react';
import {
  FITNESS_ITEM_LABEL,
  type FitnessItem,
  type FitnessProfile,
  type Sex,
} from '../lib/fitness';
import type { FitnessState } from '../lib/useFitness';
import type { AppApi } from '../ui/appApi';

/** 입력받을 항목과 단위 — 체력인증센터 결과지에 적힌 순서대로 */
const INPUTS: { item: FitnessItem; unit: string; step: number }[] = [
  { item: 'bodyFatPct', unit: '%', step: 0.1 },
  { item: 'waistCm', unit: 'cm', step: 0.1 },
  { item: 'gripKg', unit: 'kg', step: 0.1 },
  { item: 'sitUpReps', unit: '회', step: 1 },
  { item: 'jumpReps', unit: '회', step: 1 },
];

const SEX_LABEL: Record<Sex, string> = { male: '남성', female: '여성' };

export default function FitnessSection({
  api,
  fitness,
}: {
  api: AppApi;
  fitness: FitnessState;
}) {
  const profile = api.settings.fitness;
  const patch = (p: Partial<FitnessProfile>) =>
    api.setSettings({ ...api.settings, fitness: { ...profile, ...p } });

  const setMeasured = (item: FitnessItem, raw: string) => {
    const next = { ...profile.measured };
    const v = Number(raw);
    // 빈칸·0 이하는 '측정 안 함' 이다. 0 을 표본에 넣으면 분포가 망가진다.
    if (raw.trim() === '' || !Number.isFinite(v) || v <= 0) delete next[item];
    else next[item] = v;
    patch({ measured: next });
  };

  const { assessment, prescription, loading } = fitness;
  const thisYear = new Date().getFullYear();

  return (
    <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-1.5 text-[14px] font-bold text-espresso">
          <Activity size={16} className="text-coral" /> 내 체력
        </h2>
        {assessment.overall != null && (
          <span className="text-[16px] font-extrabold text-coral-600">
            상위 {100 - assessment.overall}%
          </span>
        )}
      </div>

      {/* 나이·성별 — 또래 비교의 기준이라 가장 먼저 받는다 */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11.5px] font-semibold text-espresso-muted">출생연도</span>
          <input
            type="number"
            inputMode="numeric"
            min={1900}
            max={thisYear}
            placeholder="1994"
            value={profile.birthYear ?? ''}
            onChange={(e) => {
              const v = Number(e.target.value);
              patch({
                birthYear:
                  Number.isInteger(v) && v >= 1900 && v <= thisYear ? v : null,
              });
            }}
            className="mt-1 w-full rounded-2xl border border-line bg-cream px-3 py-2.5 text-[14px] text-espresso"
          />
        </label>
        <div>
          <span className="text-[11.5px] font-semibold text-espresso-muted">성별</span>
          <div className="mt-1 flex rounded-full bg-tint p-1">
            {(['male', 'female'] as Sex[]).map((s) => (
              <button
                key={s}
                onClick={() => patch({ sex: profile.sex === s ? null : s })}
                aria-pressed={profile.sex === s}
                className={`flex-1 rounded-full py-1.5 text-[12.5px] font-bold transition ${
                  profile.sex === s ? 'bg-paper text-espresso shadow-soft' : 'text-espresso-muted'
                }`}
              >
                {SEX_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 측정값 — 체력인증센터에서 받은 결과지를 그대로 옮겨 적는다 */}
      <div className="mt-3">
        <p className="text-[11.5px] font-semibold text-espresso-muted">
          체력인증센터 측정값 <span className="font-normal">(아는 것만 넣어도 돼요)</span>
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {INPUTS.map(({ item, unit, step }) => (
            <label key={item} className="block">
              <span className="text-[11px] text-espresso-soft">
                {FITNESS_ITEM_LABEL[item]} ({unit})
              </span>
              <input
                type="number"
                inputMode="decimal"
                step={step}
                min={0}
                value={profile.measured[item] ?? ''}
                onChange={(e) => setMeasured(item, e.target.value)}
                className="mt-0.5 w-full rounded-2xl border border-line bg-cream px-3 py-2 text-[13.5px] text-espresso"
              />
            </label>
          ))}
        </div>
      </div>

      {/* 결과 — 낼 수 있으면 백분위와 처방, 못 내면 그 이유 */}
      <div className="mt-3 rounded-2xl bg-tint/70 p-3">
        {loading ? (
          <p className="text-[12px] text-espresso-muted">체력 기준 데이터를 불러오는 중…</p>
        ) : assessment.missing ? (
          <p className="text-[12px] leading-relaxed text-espresso-muted">{assessment.missing}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {assessment.items.map((it) => (
                <span key={it.item} className="text-[11.5px] text-espresso-muted">
                  {FITNESS_ITEM_LABEL[it.item]}{' '}
                  <b className="text-espresso">상위 {100 - it.percentile}%</b>
                </span>
              ))}
            </div>
            {prescription && (
              <p className="mt-2 text-[12.5px] leading-relaxed text-espresso">
                지금 체력이면 <b>한 번에 {prescription.sessionKm.min}~{prescription.sessionKm.max}km</b>,
                주 <b>{prescription.perWeek}회</b>가 알맞아요. 추천 탭이 이 기준으로 코스를 골라 줘요.
              </p>
            )}
            {/* 어디서 온 숫자인지 밝힌다 — 국가 기준으로 진단받았다고 오해하지 않게 */}
            {assessment.norm && (
              <p className="mt-2 text-[10.5px] leading-relaxed text-espresso-soft">
                {assessment.norm.ageBand} {SEX_LABEL[assessment.norm.sex]} 표본{' '}
                {assessment.norm.n.toLocaleString()}명 기준 · {assessment.norm.source}
                {prescription && <> · {prescription.basis}</>}
              </p>
            )}
          </>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-espresso-soft">
        가까운 국민체력100 체력인증센터에서 <b>무료로 측정</b>받을 수 있어요.
        측정값을 넣으면 또래와 견준 내 체력과 그에 맞는 코스를 볼 수 있어요.
      </p>
    </div>
  );
}
