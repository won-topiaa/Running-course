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
  const [storageFull, setStorageFull] = useState(false);

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

  // 저장 실패(용량 초과)는 조용히 넘기지 않는다. 방금 뛴 기록이 사라지는데
  // 아무 표시가 없으면 사용자는 한참 뒤에야 알게 된다.
  useEffect(() => {
    setStorageFull(!persistRoutes(savedRoutes));
  }, [savedRoutes]);
  useEffect(() => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(savedIds));
    } catch {
      /* 무시 */
    }
  }, [savedIds]);

  // 자동 백업 — 로그인 상태면 변경 몇 초 뒤 조용히 계정에 올린다.
  // (실패는 무시 — 오프라인이면 다음 변경 때 재시도)
  useEffect(() => {
    const t = setTimeout(() => {
      const sbUrl = settings.supabaseUrl;
      const sbKey = settings.supabaseAnonKey;
      if (sbUrl && sbKey && loadCloudSession()) {
        pushCloud({ url: sbUrl, anonKey: sbKey }).catch(() => {
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

      {storageFull && (
        <div className="fixed inset-x-0 bottom-[86px] z-[1100] px-3">
          <div className="mx-auto max-w-md rounded-2xl border border-coral/50 bg-coral-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-espresso shadow-card">
            <b className="text-coral-600">저장 공간이 가득 찼어요.</b> 새 기록이 이 기기에
            저장되지 않고 있어요. 마이 → 내 코스에서 오래된 기록을 지우거나,
            계정에 백업한 뒤 정리해 주세요.
          </div>
        </div>
      )}

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
