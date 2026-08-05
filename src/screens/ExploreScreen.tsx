import { useMemo, useState } from 'react';
import { ChevronDown, Moon, SlidersHorizontal } from 'lucide-react';
import ScenePhoto from '../components/ScenePhoto';
import { COURSES } from '../data/courses';
import { defaultPreferences, recommend } from '../lib/scoring';
import { sceneForCourse } from '../lib/scene';
import { formatDistance } from '../lib/format';
import {
  COURSE_TYPE_EMOJI,
  COURSE_TYPE_LABEL,
  ELEVATION_LABEL,
  FACTOR_META,
  GRADIENT_PREF_LABEL,
  type CourseType,
  type FactorKey,
  type GradientPreference,
  type Preferences,
  type Recommendation,
} from '../lib/types';
import type { AppApi } from '../ui/appApi';

const TYPES: CourseType[] = ['city', 'uninterrupted', 'green', 'waterfront', 'trail', 'track'];
const GRADS: GradientPreference[] = ['flat', 'any', 'hilly'];
const FACTORS: FactorKey[] = ['gradient', 'preference', 'safety', 'amenities', 'scenery', 'distance'];

export default function ExploreScreen({ api }: { api: AppApi }) {
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences);
  const [showWeights, setShowWeights] = useState(false);

  const recs = useMemo(() => recommend(COURSES, prefs), [prefs]);
  const set = (patch: Partial<Preferences>) => setPrefs({ ...prefs, ...patch });
  const toggleType = (t: CourseType) =>
    set({
      courseTypes: prefs.courseTypes.includes(t)
        ? prefs.courseTypes.filter((x) => x !== t)
        : [...prefs.courseTypes, t],
    });

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-28 pt-5">
      <header className="mb-4">
        <h1 className="text-[22px] font-extrabold tracking-tightish text-espresso">
          취향으로 코스 찾기
        </h1>
        <p className="mt-1 text-[13px] text-espresso-muted">
          중요하게 보는 걸 정하면 딱 맞는 코스를 골라드려요.
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
                  prefs.gradientPref === g ? 'bg-paper text-espresso shadow-soft' : 'text-espresso-muted'
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
                    ? 'bg-coral text-white'
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
            className="peer sr-only"
          />
          <span className="relative h-6 w-11 rounded-full bg-line transition peer-checked:bg-coral">
            <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
          </span>
        </label>

        {/* 세부 중요도 */}
        <button
          onClick={() => setShowWeights((v) => !v)}
          className="mt-4 flex w-full items-center justify-between border-t border-line pt-3 text-[12.5px] font-semibold text-espresso-muted"
        >
          <span className="inline-flex items-center gap-1.5">
            <SlidersHorizontal size={14} /> 요소별 중요도 세부 조정
          </span>
          <ChevronDown size={16} className={`transition ${showWeights ? 'rotate-180' : ''}`} />
        </button>
        {showWeights && (
          <div className="mt-3 space-y-3">
            {FACTORS.map((k) => (
              <div key={k}>
                <div className="mb-1 flex justify-between text-[12px] text-espresso-muted">
                  <span>
                    {FACTOR_META[k].emoji} {FACTOR_META[k].label}
                  </span>
                  <span className="font-semibold text-espresso">{prefs.weights[k]}/5</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={prefs.weights[k]}
                  onChange={(e) => set({ weights: { ...prefs.weights, [k]: Number(e.target.value) } })}
                  className="coral w-full"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 결과 */}
      <div className="mt-5 mb-2 flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-espresso">추천 순위</h2>
        <span className="text-[12px] text-espresso-soft">{recs.length}곳</span>
      </div>
      <div className="space-y-4">
        {recs.map((r, i) => (
          <RecoCard key={r.course.id} rec={r} rank={i} api={api} />
        ))}
      </div>
    </div>
  );
}

function RecoCard({ rec, rank, api }: { rec: Recommendation; rank: number; api: AppApi }) {
  const { course, matchScore, reasons } = rec;
  const scoreColor = matchScore >= 80 ? 'text-sage-600' : matchScore >= 60 ? 'text-coral-600' : 'text-espresso-soft';
  return (
    <button
      onClick={() => api.openCourse(course.id)}
      className="block w-full overflow-hidden rounded-3xl border border-line bg-paper text-left shadow-soft transition active:scale-[0.99]"
    >
      <ScenePhoto scene={sceneForCourse(course)} className="aspect-[16/9] w-full">
        <div className="flex h-full items-start justify-between p-3">
          {rank < 3 && (
            <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-espresso shadow-soft backdrop-blur">
              추천 {rank + 1}위
            </span>
          )}
          <span className="ml-auto rounded-full bg-white/90 px-2.5 py-1 text-[13px] font-extrabold shadow-soft backdrop-blur">
            <span className={scoreColor}>{matchScore}%</span>
          </span>
        </div>
      </ScenePhoto>
      <div className="p-4">
        <h3 className="text-[16px] font-bold tracking-tightish text-espresso">{course.name}</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <MiniTag>{formatDistance(course.distanceKm)}</MiniTag>
          <MiniTag>{ELEVATION_LABEL[course.elevation.category]}</MiniTag>
          {course.courseTypes.slice(0, 2).map((t) => (
            <MiniTag key={t}>
              {COURSE_TYPE_EMOJI[t]} {COURSE_TYPE_LABEL[t]}
            </MiniTag>
          ))}
        </div>
        {reasons[0] && (
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-espresso-muted">✅ {reasons[0]}</p>
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
