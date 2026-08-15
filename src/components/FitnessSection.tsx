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

import { Activity, Timer } from 'lucide-react';
import {
  FITNESS_ITEM_LABEL,
  FITNESS_ITEM_UNIT,
  type FitnessItem,
  type FitnessProfile,
  type Sex,
} from '../lib/fitness';
import { hasBundledNorm, hasCardioNorm } from '../lib/kspoFitness';
import type { FitnessState } from '../lib/useFitness';
import { CONFIDENCE_LABEL } from '../lib/vo2max';
import type { AppApi } from '../ui/appApi';

/**
 * 입력받을 항목 — 결과지에서 찾기 쉬운 순서.
 * 심폐지구력이 러닝에 가장 크게 걸리므로 맨 위에 둔다.
 */
const INPUTS: { item: FitnessItem; step: number }[] = [
  { item: 'vo2max', step: 0.1 },
  { item: 'bodyFatPct', step: 0.1 },
  { item: 'longJumpCm', step: 1 },
  { item: 'gripKg', step: 0.1 },
  { item: 'waistCm', step: 0.1 },
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

  const { assessment, prescription, loading, vo2maxEstimate, age } = fitness;
  const thisYear = new Date().getFullYear();
  // 이 또래에 기준 표본이 있는지 — '아직 못 불러왔다' 와 '아예 없다' 는 다르다
  const cohortKnown = profile.sex != null && age != null && hasBundledNorm(profile.sex, age);
  const cardioKnown = profile.sex != null && age != null && hasCardioNorm(profile.sex, age);

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
          체력인증센터 측정값{' '}
          <span className="font-normal">
            (아는 것만 넣어도 돼요{vo2maxEstimate ? ' · 넣으면 추정 대신 실측을 씁니다' : ''})
          </span>
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {INPUTS.map(({ item, step }) => (
            <label key={item} className="block">
              <span className="text-[11px] text-espresso-soft">
                {FITNESS_ITEM_LABEL[item]} ({FITNESS_ITEM_UNIT[item]})
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

      {/* 러닝 기록에서 추정한 심폐지구력.
          실측이 아니라는 걸 눈에 띄게 적는다 — 추정치를 실측인 척하면
          사용자는 국가 기준으로 진단받았다고 믿는다. */}
      {vo2maxEstimate && (
        <div className="mt-3 rounded-2xl border border-sage-600/25 bg-sage-50/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-sage-600">
              내 러닝 기록으로 추정한 심폐지구력
            </span>
            <span className="text-[15px] font-extrabold text-sage-600">
              {vo2maxEstimate.value}
              <span className="ml-0.5 text-[10px] font-semibold">ml/kg/min</span>
            </span>
          </div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-espresso-soft">
            {CONFIDENCE_LABEL[vo2maxEstimate.confidence]} · {vo2maxEstimate.note}
          </p>
          {vo2maxEstimate.method !== 'cooper' && (
            <>
              <p className="mt-1 text-[10.5px] leading-relaxed text-espresso-soft">
                평소 기록은 최대로 달린 게 아니라서 실제보다 낮게 나와요.
                12분 검사를 하면 <b>정확도 높음</b>으로 올라가요.
              </p>
              {/* 안내 문장이 아니라 버튼이어야 한다. 숫자를 처음 본 직후가
                  그 숫자의 정확도에 관심이 생기는 유일한 순간인데, 거기서
                  '어디서 하지?' 를 찾게 만들면 대부분 그냥 넘어간다. */}
              <button
                onClick={() => api.startRecord(null, { cooperTest: true })}
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-sage-600 py-2.5 text-[12.5px] font-bold text-white active:scale-[0.98]"
              >
                <Timer size={14} /> 12분 검사로 정확하게 재기
              </button>
            </>
          )}
        </div>
      )}

      {/* 아직 추정할 기록이 없는 사람 — 이 사람에게는 검사가 유일한 출발선이다.
          '러닝을 몇 번 하면 나와요' 만 적어 두면, 오늘 당장 자기 상태를 알고
          싶은 사람은 아무것도 못 받고 나간다. */}
      {/* 센터 실측값을 이미 넣은 사람에게는 권하지 않는다 — 그쪽이 더 정확하다 */}
      {!vo2maxEstimate && profile.measured.vo2max == null && (
        <div className="mt-3 rounded-2xl border border-sage-600/25 bg-sage-50/60 p-3">
          <p className="text-[11.5px] font-bold text-sage-600">심폐지구력을 아직 몰라요</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-espresso-soft">
            러닝을 몇 번 기록하면 그 기록으로 자동 추정해 드려요. 지금 바로 알고 싶으면
            12분 검사를 해 보세요 — 12분 동안 간 거리로 계산해요.
          </p>
          <button
            onClick={() => api.startRecord(null, { cooperTest: true })}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-sage-600 py-2.5 text-[12.5px] font-bold text-white active:scale-[0.98]"
          >
            <Timer size={14} /> 12분 검사 시작
          </button>
        </div>
      )}

      {/* 결과 — 낼 수 있으면 백분위와 처방, 못 내면 그 이유 */}
      <div className="mt-3 rounded-2xl bg-tint/70 p-3">
        {loading ? (
          <p className="text-[12px] text-espresso-muted">체력 기준 데이터를 불러오는 중…</p>
        ) : assessment.missing ? (
          <p className="text-[12px] leading-relaxed text-espresso-muted">
            {/* 표본이 아예 없는 또래에게 '아직 못 불러왔다' 고 하면 계속 기다리게 된다 */}
            {!assessment.norm && profile.sex && age != null && !cohortKnown
              ? '공단 체력인증센터 표본은 20대부터 있어서, 지금 나이대는 또래 기준을 만들 수 없어요. 러닝 기록과 코스 추천은 그대로 쓸 수 있어요.'
              : assessment.missing}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {assessment.items.map((it) => (
                <span key={it.item} className="text-[11.5px] text-espresso-muted">
                  {FITNESS_ITEM_LABEL[it.item]}
                  {it.estimated && (
                    <span className="ml-0.5 text-[10px] text-sage-600">(추정)</span>
                  )}{' '}
                  <b className="text-espresso">상위 {100 - it.percentile}%</b>
                </span>
              ))}
            </div>
            {prescription ? (
              <p className="mt-2 text-[12.5px] leading-relaxed text-espresso">
                지금 체력이면 <b>한 번에 {prescription.sessionKm.min}~{prescription.sessionKm.max}km</b>,
                주 <b>{prescription.perWeek}회</b>가 알맞아요. 추천 탭이 이 기준으로 코스를 골라 줘요.
              </p>
            ) : cardioKnown ? (
              /* 심폐지구력 없이도 백분위는 보여주되 '얼마나 뛰어라' 는 말하지 않는다.
                 왜 안 나오는지를 말해야 사용자가 다음 걸음을 뗄 수 있다. */
              <p className="mt-2 text-[12.5px] leading-relaxed text-espresso-muted">
                코스 처방은 <b>심폐지구력</b>을 알아야 낼 수 있어요. 러닝을 한 번 기록하거나
                12분 검사를 하면 바로 나와요.
              </p>
            ) : (
              /* 기다린다고 생기지 않는 경우다. 70대 이상은 공단 표본에 심폐지구력
                 측정값이 0건이라, '검사하면 나온다' 고 하면 거짓말이 된다. */
              <p className="mt-2 text-[12.5px] leading-relaxed text-espresso-muted">
                이 연령대는 공단 표본에 심폐지구력 측정값이 없어서 <b>또래 대비</b> 코스
                처방까지는 낼 수 없어요. 다른 항목의 상위 %는 위에 그대로 나와 있어요.
              </p>
            )}
            {/* 어디서 온 숫자인지 밝힌다 — 국가 기준으로 진단받았다고 오해하지 않게 */}
            {assessment.norm && (
              <p className="mt-2 text-[10.5px] leading-relaxed text-espresso-soft">
                {assessment.norm.ageBand} {SEX_LABEL[assessment.norm.sex]} 표본{' '}
                {assessment.norm.n.toLocaleString()}명 기준
                {assessment.norm.period && (
                  <> · {assessment.norm.period.from}~{assessment.norm.period.to} 측정</>
                )}
                {' · '}
                {assessment.norm.source}
                {/* 어느 자로 잰 분포인지 — '상위 몇 %' 만큼 중요한 정보다 */}
                {assessment.norm.vo2Methods && (
                  <> · 심폐지구력은 스텝·트레드밀 측정분만 사용(왕복오래달리기는 눈금이 달라 제외)</>
                )}
                {prescription && <> · {prescription.basis}</>}
              </p>
            )}
          </>
        )}
      </div>

      {/* 남는 한계는 측정 방식이 아니라 '누구와 비교하는가' 다.
          방식 차이는 실제로 재서 처리했다 — 스텝·트레드밀은 눈금이 같아
          함께 쓰고, 2~3 낮게 나오는 왕복오래달리기는 기준에서 뺐다.
          하지만 비교 대상은 여전히 체력인증센터를 찾은 '일반인' 이다.
          꾸준히 달리는 사람은 대개 위쪽에 자리하는 게 정상이고, 그걸
          말해 주지 않으면 '상위 5%' 를 러너들 사이 등수로 오해한다. */}
      <p className="mt-2 text-[11px] leading-relaxed text-espresso-soft">
        비교 대상은 체력인증센터에서 측정받은 <b>또래 일반인</b>이에요 — 러너끼리의 등수가
        아니라서, 꾸준히 달리는 분은 대체로 위쪽에 나와요. 가장 정확한 값은 가까운
        국민체력100 체력인증센터에서 무료로 측정받을 수 있고, 실측값을 넣으면 추정 대신
        그 값을 씁니다.
      </p>
    </div>
  );
}
