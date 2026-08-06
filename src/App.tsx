import { useCallback, useEffect, useMemo, useState } from 'react';
import BottomNav, { type Screen } from './components/BottomNav';
import CourseDetailSheet from './components/CourseDetailSheet';
import InstallPrompt from './components/InstallPrompt';
import RecordScreen from './components/RecordScreen';
import RouteSheet from './components/RouteSheet';
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
import { loadSyncCode, pushSync } from './lib/backup';
import { loadCloudSession, pushCloud } from './lib/cloud';
import { captureTokenFromHash } from './lib/strava';
import type { RouteResult } from './lib/routing';
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
  const [screen, setScreen] = useState<Screen>('build');
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [conditions, setConditions] = useState<RunConditions | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>(loadSaved);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(loadRoutes);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [plannedRun, setPlannedRun] = useState<{ name: string; route: RouteResult } | null>(null);
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

  // 자동 백업 — 변경 몇 초 뒤 조용히 올린다. 계정 로그인이 있으면 클라우드로,
  // 아니면 동기화 코드로. (실패는 무시 — 오프라인이면 다음 변경 때 재시도)
  useEffect(() => {
    const t = setTimeout(() => {
      const sbUrl = settings.supabaseUrl;
      const sbKey = settings.supabaseAnonKey;
      if (sbUrl && sbKey && loadCloudSession()) {
        pushCloud({ url: sbUrl, anonKey: sbKey }).catch(() => {
          /* 다음 변경 때 재시도 */
        });
        return;
      }
      const url = settings.syncWorkerUrl;
      const code = loadSyncCode();
      if (url && code) {
        pushSync(url, code).catch(() => {
          /* 다음 변경 때 재시도 */
        });
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [savedRoutes, savedIds, settings]);

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
      startRecord: (planned) => {
        setPlannedRun(planned ?? null);
        setRecordOpen(true);
      },
      viewRoute: setRouteView,
    }),
    [settings, conditions, savedIds, savedRoutes, toggleSaved, addSavedRoute, removeSavedRoute],
  );

  const detailCourse = detailId ? COURSES.find((c) => c.id === detailId) ?? null : null;

  return (
    <div className="min-h-full bg-cream">
      {screen === 'explore' && <ExploreScreen api={api} />}
      {screen === 'build' && <BuildScreen api={api} />}
      {screen === 'saved' && <SavedScreen api={api} />}
      {screen === 'my' && <MyScreen api={api} />}

      <BottomNav
        active={screen}
        onChange={setScreen}
        onRecord={() => api.startRecord()}
        savedCount={savedIds.length}
      />
      {/* 설치 배너는 목록형 화면에서만 — 만들기 화면의 바텀시트 버튼을 가리지 않게 */}
      {(screen === 'explore' || screen === 'my') &&
        !recordOpen &&
        !detailCourse &&
        !routeView && <InstallPrompt />}

      {detailCourse && (
        <CourseDetailSheet course={detailCourse} api={api} onClose={() => setDetailId(null)} />
      )}
      {routeView && (
        <RouteSheet view={routeView} api={api} onClose={() => setRouteView(null)} />
      )}
      {recordOpen && (
        <RecordScreen
          api={api}
          planned={plannedRun}
          onClose={() => {
            setRecordOpen(false);
            setPlannedRun(null);
          }}
        />
      )}
    </div>
  );
}
