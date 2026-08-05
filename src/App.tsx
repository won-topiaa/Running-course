import { useEffect, useMemo, useState } from 'react';
import CourseCard from './components/CourseCard';
import CourseMap from './components/CourseMap';
import PreferencePanel from './components/PreferencePanel';
import { COURSES } from './data/courses';
import { defaultPreferences, recommend } from './lib/scoring';
import type { Preferences } from './lib/types';

const STORAGE_KEY = 'run-course-prefs-v1';

function loadPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultPreferences(), ...JSON.parse(raw) };
  } catch {
    /* 무시 */
  }
  return defaultPreferences();
}

export default function App() {
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 선호가 바뀔 때마다 저장
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* 무시 */
    }
  }, [prefs]);

  const recommendations = useMemo(() => recommend(COURSES, prefs), [prefs]);
  const best = recommendations[0];

  const handleSelect = (id: string) =>
    setSelectedId((cur) => (cur === id ? null : id));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            🏃
          </span>
          <div>
            <h1>런코스</h1>
            <p>취향으로 찾는 나만의 서울 러닝 코스</p>
          </div>
        </div>
        {best && (
          <div className="topbar-best">
            <span className="best-label">오늘의 추천</span>
            <span className="best-name">{best.course.name}</span>
            <span className="best-score">{best.matchScore}% 일치</span>
          </div>
        )}
      </header>

      <main className="layout">
        <PreferencePanel
          prefs={prefs}
          onChange={setPrefs}
          onReset={() => {
            setPrefs(defaultPreferences());
            setSelectedId(null);
          }}
        />

        <section className="map-wrap">
          <CourseMap
            recommendations={recommendations}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
          <div className="map-legend">
            <span>
              <i className="dot dot-top" /> 상위 추천
            </span>
            <span>
              <i className="dot dot-other" /> 그 외 코스
            </span>
            <span className="legend-hint">경로·마커를 누르면 상세로 이동</span>
          </div>
        </section>

        <section className="results">
          <div className="results-head">
            <h2>추천 코스</h2>
            <span className="results-count">{recommendations.length}곳</span>
          </div>
          <div className="results-list">
            {recommendations.map((rec, i) => (
              <CourseCard
                key={rec.course.id}
                rec={rec}
                rank={i}
                selected={rec.course.id === selectedId}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
