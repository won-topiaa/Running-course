import { useCallback, useEffect, useMemo, useState } from 'react';
import BottomNav, { type Screen } from './components/BottomNav';
import CourseDetailSheet from './components/CourseDetailSheet';
import HomeScreen from './screens/HomeScreen';
import ExploreScreen from './screens/ExploreScreen';
import BuildScreen from './screens/BuildScreen';
import SavedScreen from './screens/SavedScreen';
import MyScreen from './screens/MyScreen';
import { COURSES } from './data/courses';
import { loadSettings, saveSettings, type Settings } from './lib/config';
import { getConditions, type RunConditions } from './lib/weather';
import type { AppApi } from './ui/appApi';

const SAVED_KEY = 'run-app-saved-v1';

function loadSaved(): string[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* 무시 */
  }
  return [];
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [conditions, setConditions] = useState<RunConditions | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>(loadSaved);
  const [detailId, setDetailId] = useState<string | null>(null);

  // 오늘의 러닝 컨디션 로드 (실패 시 샘플 폴백)
  useEffect(() => {
    let alive = true;
    getConditions(settings.homeLocation).then((c) => {
      if (alive) setConditions(c);
    });
    return () => {
      alive = false;
    };
  }, [settings.homeLocation]);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(savedIds));
    } catch {
      /* 무시 */
    }
  }, [savedIds]);

  const toggleSaved = useCallback((id: string) => {
    setSavedIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }, []);

  const api: AppApi = useMemo(
    () => ({
      nav: setScreen,
      settings,
      setSettings: setSettingsState,
      conditions,
      savedIds,
      isSaved: (id) => savedIds.includes(id),
      toggleSaved,
      openCourse: setDetailId,
    }),
    [settings, conditions, savedIds, toggleSaved],
  );

  const detailCourse = detailId
    ? COURSES.find((c) => c.id === detailId) ?? null
    : null;

  return (
    <div className="min-h-full bg-cream">
      {screen === 'home' && <HomeScreen api={api} />}
      {screen === 'explore' && <ExploreScreen api={api} />}
      {screen === 'build' && <BuildScreen api={api} />}
      {screen === 'saved' && <SavedScreen api={api} />}
      {screen === 'my' && <MyScreen api={api} />}

      <BottomNav active={screen} onChange={setScreen} savedCount={savedIds.length} />

      {detailCourse && (
        <CourseDetailSheet
          course={detailCourse}
          api={api}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
