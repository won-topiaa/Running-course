import { useEffect, useMemo, useState } from 'react';
import { Moon } from 'lucide-react';
import FitnessInsight from '../components/FitnessInsight';
import ScenePhoto from '../components/ScenePhoto';
import { COURSES } from '../data/courses';
import { defaultPreferences, recommend } from '../lib/scoring';
import { fitLabel, type RunPrescription } from '../lib/fitness';
import { sceneForCourse } from '../lib/scene';
import { formatDistance } from '../lib/format';
import {
  COURSE_TYPE_EMOJI,
  COURSE_TYPE_LABEL,
  ELEVATION_LABEL,
  GRADIENT_PREF_LABEL,
  type CourseType,
  type GradientPreference,
  type Preferences,
  type Recommendation,
} from '../lib/types';
import type { AppApi } from '../ui/appApi';

const TYPES: CourseType[] = ['city', 'uninterrupted', 'green', 'waterfront', 'trail', 'track'];
const GRADS: GradientPreference[] = ['flat', 'any', 'hilly'];

/**
 * 취향 설정도 탭을 옮기면 사라졌다 — 코스를 하나 열어보고 돌아오면 슬라이더를
 * 처음부터 다시 맞춰야 했다. BuildScreen 과 같은 이유로 세션 동안만 기억한다.
 */
let session: { prefs: Preferences } | null = null;

export default function ExploreScreen({ api }: { api: AppApi }) {
  const [prefs, setPrefs] = useState<Preferences>(session?.prefs ?? defaultPreferences);
  useEffect(() => {
    session = { prefs };
  }, [prefs]);

  // 체력 처방을 언제나 넘긴다 — 사용자가 켜고 끄는 기능이 아니다.
  // 모르면 null 이고, 그때는 기존과 똑같이 6요소로만 고른다.
  const rx = api.fitness.prescription;
  const recs = useMemo(() => recommend(COURSES, prefs, rx), [prefs, rx]);
  const set = (patch: Partial<Preferences>) => setPrefs({ ...prefs, ...patch });
  const toggleType = (t: CourseType) =>
    set({
      courseTypes: prefs.courseTypes.includes(t)
        ? prefs.courseTypes.filter((x) => x !== t)
        : [...prefs.courseTypes, t],
    });

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-28 pt-[calc(env(safe-area-inset-top,0px)+1.25rem)]">
      <header className="mb-4">
        <h1 className="text-[22px] font-extrabold tracking-tightish text-espresso">추천 코스</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-espresso-muted">
          어디서 뛸지 모르겠다면 — 서울에서 러너들이 실제로 많이 뛰는 코스 중에 취향에 맞는 곳을
          골라드려요.
        </p>
      </header>

      {/* 컨트롤 카드 */}
      <div className="rounded-3xl border border-line bg-paper p-4 shadow-soft">
        {/* 거리 */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-espresso">목표 거리</span>
            <span className="text-[15px] font-bold text-coral-600">{prefs.targetDistanceKm}km</span>
          </div>
          <input
            type="range"
            min={1}
            max={15}
            step={0.5}
            value={prefs.targetDistanceKm}
            onChange={(e) => set({ targetDistanceKm: Number(e.target.value) })}
            className="coral w-full"
            aria-label="목표 거리"
            aria-valuetext={`${prefs.targetDistanceKm}km`}
          />
        </div>

        {/* 경사 선호 */}
        <div className="mb-4">
          <span className="mb-2 block text-[13px] font-semibold text-espresso">경사 선호</span>
          <div className="flex rounded-full bg-tint p-1">
            {GRADS.map((g) => (
              <button
                key={g}
                onClick={() => set({ gradientPref: g })}
                className={`flex-1 rounded-full py-2 text-[12.5px] font-semibold transition ${
                  prefs.gradientPref === g
                    ? 'bg-paper text-espresso shadow-soft'
                    : 'text-espresso-muted'
                }`}
              >
                {GRADIENT_PREF_LABEL[g]}
              </button>
            ))}
          </div>
        </div>

        {/* 취향 태그 */}
        <div className="mb-4">
          <span className="mb-2 block text-[13px] font-semibold text-espresso">코스 취향</span>
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition active:scale-95 ${
                  prefs.courseTypes.includes(t)
                    ? 'bg-coral text-ink'
                    : 'border border-line bg-paper text-espresso-muted'
                }`}
              >
                {COURSE_TYPE_EMOJI[t]} {COURSE_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        {/* 야간 */}
        <label className="flex cursor-pointer items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-espresso">
            <Moon size={15} className="text-coral" /> 야간 러닝
          </span>
          <input
            type="checkbox"
            checked={prefs.nightRun}
            onChange={(e) => set({ nightRun: e.target.checked })}
            className="sr-only"
          />
          <span className={`relative h-6 w-11 rounded-full transition ${prefs.nightRun ? 'bg-coral' : 'bg-line'}`}>
            <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow transition ${prefs.nightRun ? 'translate-x-5 bg-ink' : 'bg-espresso-muted'}`} />
          </span>
        </label>

      </div>

      {/* 결과 */}
      <div className="mt-5 mb-2 flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-espresso">나에게 맞는 순서</h2>
        <span className="text-[12px] text-espresso-soft">{recs.length}곳</span>
      </div>
      <div className="space-y-4">
        {recs.map((r, i) => (
          <RecoCard key={r.course.id} rec={r} rank={i} api={api} rx={rx} />
        ))}
      </div>

      {/* 국민체력100 참여 현황 — 데이터셋 15114286 활용 */}
      <div className="mt-6">
        <FitnessInsight />
      </div>
    </div>
  );
}

function RecoCard({
  rec,
  rank,
  api,
  rx,
}: {
  rec: Recommendation;
  rank: number;
  api: AppApi;
  rx: RunPrescription | null;
}) {
  const { course, matchScore, reasons } = rec;
  // 체력을 아는 경우에만 붙는다 — 모르면 아무 말도 하지 않는다
  const fit = fitLabel(course, rx);
  const scoreColor =
    matchScore >= 80 ? 'text-sage-600' : matchScore >= 60 ? 'text-coral-600' : 'text-espresso-soft';
  return (
    <button
      onClick={() => api.openCourse(course.id)}
      className="block w-full overflow-hidden rounded-3xl border border-line bg-paper text-left shadow-soft transition active:scale-[0.99]"
    >
      <ScenePhoto scene={sceneForCourse(course)} className="aspect-[16/9] w-full">
        <div className="flex h-full items-start justify-between p-3">
          {rank < 3 && (
            <span className="rounded-full bg-ink/70 px-2.5 py-1 text-[11px] font-bold text-white shadow-soft backdrop-blur">
              추천 {rank + 1}위
            </span>
          )}
          <span className="ml-auto rounded-full bg-ink/70 px-2.5 py-1 text-[13px] font-extrabold shadow-soft backdrop-blur">
            <span className={scoreColor}>{matchScore}%</span>
          </span>
        </div>
      </ScenePhoto>
      <div className="p-4">
        <h3 className="text-[16px] font-bold tracking-tightish text-espresso">{course.name}</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {fit && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                fit.tone === 'good'
                  ? 'bg-sage-50 text-sage-600'
                  : fit.tone === 'push'
                    ? 'bg-coral-50 text-coral-600'
                    : 'bg-tint text-espresso-muted'
              }`}
            >
              {fit.text}
            </span>
          )}
          <MiniTag>{formatDistance(course.distanceKm)}</MiniTag>
          <MiniTag>{ELEVATION_LABEL[course.elevation.category]}</MiniTag>
          {course.courseTypes.slice(0, 2).map((t) => (
            <MiniTag key={t}>
              {COURSE_TYPE_EMOJI[t]} {COURSE_TYPE_LABEL[t]}
            </MiniTag>
          ))}
        </div>
        {reasons[0] && (
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-espresso-muted">
            ✅ {reasons[0]}
          </p>
        )}
      </div>
    </button>
  );
}

function MiniTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-tint px-2.5 py-1 text-[11px] font-medium text-espresso-muted">
      {children}
    </span>
  );
}
