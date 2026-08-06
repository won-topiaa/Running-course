import { useCallback, useEffect, useMemo, useState } from 'react';
import BottomNav, { type Screen } from './components/BottomNav';
import CourseDetailSheet from './components/CourseDetailSheet';
import InstallPrompt from './components/InstallPrompt';
import RecordScreen from './components/RecordScreen';
import RouteSheet from './components/RouteSheet';
import HomeScreen from './screens/HomeScreen';
import ExploreScreen from './screens/ExploreScreen';
import BuildScreen from './screens/BuildScreen';
import SavedScreen from './screens/SavedScreen';
import MyScreen from './screens/MyScreen';
import { COURSES } from './data/courses';
import { loadSettings, saveSettings, type Settings } from './lib/config';
import {
  loadRoutes,
  parseSharedFromHash,
  persistRoutes,
  type SavedRoute,
} from './lib/savedRoutes';
import { captureTokenFromHash } from './lib/strava';
import { getConditions, type RunConditions } from './lib/weather';
import type { AppApi, RouteView } from './ui/appApi';

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
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(loadRoutes);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [routeView, setRouteView] = useState<RouteView | null>(null);

  // 오늘의 러닝 컨디션
  useEffect(() => {
    let alive = true;
    getConditions(settings.homeLocation).then((c) => alive && setConditions(c));
    return () => {
      alive = false;
    };
  }, [settings.homeLocation]);

  // Strava OAuth 복귀 — 해시에 담겨온 토큰 저장
  useEffect(() => {
    if (captureTokenFromHash()) setScreen('my');
  }, []);

  // 공유 링크(#course=...) 로 진입한 경우 코스 시트 열기
  useEffect(() => {
    const shared = parseSharedFromHash(location.hash);
    if (shared) {
      setRouteView({
        name: shared.name,
        route: shared.route,
        kind: 'shared',
        style: shared.style as RouteView['style'],
        source: shared.source,
      });
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, []);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => persistRoutes(savedRoutes), [savedRoutes]);
  useEffect(() => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(savedIds));
    } catch {
      /* 무시 */
    }
  }, [savedIds]);

  const toggleSaved = useCallback((id: string) => {
    setSavedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);

  const addSavedRoute = useCallback((r: SavedRoute) => {
    setSavedRoutes((cur) => [r, ...cur]);
  }, []);

  const removeSavedRoute = useCallback((id: string) => {
    setSavedRoutes((cur) => cur.filter((r) => r.id !== id));
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
      savedRoutes,
      addSavedRoute,
      removeSavedRoute,
      startRecord: () => setRecordOpen(true),
      viewRoute: setRouteView,
    }),
    [settings, conditions, savedIds, savedRoutes, toggleSaved, addSavedRoute, removeSavedRoute],
  );

  const detailCourse = detailId ? COURSES.find((c) => c.id === detailId) ?? null : null;

  return (
    <div className="min-h-full bg-cream">
      {screen === 'home' && <HomeScreen api={api} />}
      {screen === 'explore' && <ExploreScreen api={api} />}
      {screen === 'build' && <BuildScreen api={api} />}
      {screen === 'saved' && <SavedScreen api={api} />}
      {screen === 'my' && <MyScreen api={api} />}

      <BottomNav active={screen} onChange={setScreen} savedCount={savedIds.length} />
      {!recordOpen && !detailCourse && !routeView && <InstallPrompt />}

      {detailCourse && (
        <CourseDetailSheet course={detailCourse} api={api} onClose={() => setDetailId(null)} />
      )}
      {routeView && (
        <RouteSheet view={routeView} api={api} onClose={() => setRouteView(null)} />
      )}
      {recordOpen && <RecordScreen api={api} onClose={() => setRecordOpen(false)} />}
    </div>
  );
}
