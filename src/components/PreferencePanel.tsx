import {
  COURSE_TYPE_EMOJI,
  COURSE_TYPE_LABEL,
  FACTOR_META,
  GRADIENT_PREF_LABEL,
  type CourseType,
  type FactorKey,
  type GradientPreference,
  type Preferences,
} from '../lib/types';

interface Props {
  prefs: Preferences;
  onChange: (next: Preferences) => void;
  onReset: () => void;
}

const COURSE_TYPES: CourseType[] = [
  'city',
  'uninterrupted',
  'green',
  'waterfront',
  'trail',
  'track',
];
const GRADIENT_PREFS: GradientPreference[] = ['flat', 'any', 'hilly'];
const FACTOR_KEYS: FactorKey[] = [
  'gradient',
  'preference',
  'safety',
  'amenities',
  'scenery',
  'distance',
];
const WEIGHT_LABEL = ['끔', '조금', '보통', '중요', '매우', '최우선'];

export default function PreferencePanel({ prefs, onChange, onReset }: Props) {
  const set = (patch: Partial<Preferences>) => onChange({ ...prefs, ...patch });

  const toggleType = (t: CourseType) => {
    const has = prefs.courseTypes.includes(t);
    set({
      courseTypes: has
        ? prefs.courseTypes.filter((x) => x !== t)
        : [...prefs.courseTypes, t],
    });
  };

  const setWeight = (key: FactorKey, value: number) =>
    set({ weights: { ...prefs.weights, [key]: value } });

  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>내 취향 설정</h2>
        <button className="link-btn" onClick={onReset}>
          초기화
        </button>
      </div>

      {/* 목표 거리 */}
      <section className="field">
        <div className="field-top">
          <label htmlFor="dist">📏 목표 거리</label>
          <span className="field-val">{prefs.targetDistanceKm}km</span>
        </div>
        <input
          id="dist"
          type="range"
          min={1}
          max={15}
          step={0.5}
          value={prefs.targetDistanceKm}
          onChange={(e) => set({ targetDistanceKm: Number(e.target.value) })}
        />
        <div className="range-ticks">
          <span>1km</span>
          <span>15km</span>
        </div>
      </section>

      {/* 경사 선호 */}
      <section className="field">
        <label>⛰️ 경사 선호</label>
        <div className="segmented">
          {GRADIENT_PREFS.map((g) => (
            <button
              key={g}
              className={prefs.gradientPref === g ? 'seg active' : 'seg'}
              onClick={() => set({ gradientPref: g })}
            >
              {GRADIENT_PREF_LABEL[g]}
            </button>
          ))}
        </div>
      </section>

      {/* 취향 태그 */}
      <section className="field">
        <label>💚 코스 취향 (복수 선택)</label>
        <div className="chips">
          {COURSE_TYPES.map((t) => (
            <button
              key={t}
              className={prefs.courseTypes.includes(t) ? 'chip active' : 'chip'}
              onClick={() => toggleType(t)}
            >
              <span aria-hidden>{COURSE_TYPE_EMOJI[t]}</span>{' '}
              {COURSE_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </section>

      {/* 야간 러닝 */}
      <section className="field">
        <label className="switch-row">
          <span>🌙 야간 러닝</span>
          <input
            type="checkbox"
            role="switch"
            checked={prefs.nightRun}
            onChange={(e) => set({ nightRun: e.target.checked })}
          />
          <span className="switch-track" aria-hidden />
        </label>
        <p className="hint">켜면 조명·야경·야간 안전 비중이 커집니다.</p>
      </section>

      {/* 요소별 중요도 */}
      <section className="field">
        <label>요소별 중요도</label>
        <p className="hint">각 요소가 추천에 얼마나 반영될지 정합니다.</p>
        <div className="weights">
          {FACTOR_KEYS.map((key) => {
            const meta = FACTOR_META[key];
            const val = prefs.weights[key];
            return (
              <div className="weight-row" key={key}>
                <div className="weight-top">
                  <span title={meta.hint}>
                    {meta.emoji} {meta.label}
                  </span>
                  <span className="weight-tag">{WEIGHT_LABEL[val]}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={val}
                  onChange={(e) => setWeight(key, Number(e.target.value))}
                />
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
