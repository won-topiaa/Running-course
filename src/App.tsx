import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useFitness } from './lib/useFitness';
import BottomNav, { type Screen } from './components/BottomNav';
import InstallPrompt from './components/InstallPrompt';
import BuildScreen from './screens/BuildScreen';
import { lazyWithReload } from './lib/lazyRetry';

// 첫 화면(만들기)만 즉시 받고 나머지는 눌렀을 때 받는다. 첫 로딩에 필요 없는
// 화면·시트가 같이 묶여 있으면 그만큼 첫 그림이 늦어진다.
// 오프라인에서 처음 눌러도 되도록, 뜬 직후 한가할 때 미리 받아 캐시에 넣는다
// (아래 prefetch effect). 서비스워커가 그때 받은 청크를 캐시한다.
const ExploreScreen = lazyWithReload(() => import('./screens/ExploreScreen'));
const SavedScreen = lazyWithReload(() => import('./screens/SavedScreen'));
const MyScreen = lazyWithReload(() => import('./screens/MyScreen'));
const RecordScreen = lazyWithReload(() => import('./components/RecordScreen'));
const RouteSheet = lazyWithReload(() => import('./components/RouteSheet'));
const CourseDetailSheet = lazyWithReload(() => import('./components/CourseDetailSheet'));
import { loadSettings, saveSettings, type Settings } from './lib/config';
import { loadRoutes, parseSharedFromHash, persistRoutes, type SavedRoute } from './lib/savedRoutes';
import { loadCloudSession, pushCloud } from './lib/cloud';
import { captureTokenFromHash } from './lib/strava';
import type { RouteResult } from './lib/routing';
import { getConditions, type RunConditions } from './lib/weather';
import type { AppApi, RouteView } from './ui/appApi';

const SAVED_KEY = 'run-app-saved-v1';

function loadSaved(): string[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    // 배열·문자열인지 확인한다. 깨진 값이 들어오면 렌더 중에 터지는데,
    // 그 값은 localStorage 에 그대로 남아 새로고침해도 계속 같은 자리에서 터진다.
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    }
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

  // 오늘의 러닝 컨디션 — 한 번 받고 끝나면 PWA 를 오래 열어둘 때 어제 날씨가
  // 남는다. 성공 시 30분마다 갱신, 실패(샘플 폴백) 시 30초 뒤 재시도,
  // 앱으로 돌아오면(visibilitychange) 5분 넘었을 때 즉시 갱신한다.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAt = 0;
    const load = async () => {
      const c = await getConditions(settings.homeLocation);
      if (!alive) return;
      setConditions(c);
      lastAt = Date.now();
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, c.source === 'sample' ? 30_000 : 30 * 60_000);
    };
    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastAt > 5 * 60_000) {
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [settings.homeLocation]);

  // 한가할 때 나머지 화면을 미리 받아 둔다 — 오프라인에서 처음 눌러도 열리고,
  // 온라인에서도 탭 전환이 즉시 끝난다. 첫 그림에는 영향을 주지 않는다.
  useEffect(() => {
    const load = () => {
      void import('./screens/ExploreScreen');
      void import('./screens/SavedScreen');
      void import('./screens/MyScreen');
      void import('./components/RecordScreen');
      void import('./components/RouteSheet');
      void import('./components/CourseDetailSheet');
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (ric) {
      const id = ric(load);
      return () =>
        (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(
          id,
        );
    }
    const t = setTimeout(load, 2000);
    return () => clearTimeout(t);
  }, []);

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
  // 꽉 차면 persistRoutes 가 오래된 기록의 지도 해상도를 낮춰 자리를 만들고,
  // 그렇게 줄인 결과를 돌려주면 화면 상태도 같은 값으로 맞춘다.
  useEffect(() => {
    const r = persistRoutes(savedRoutes);
    setStorageFull(!r.ok);
    if (r.compacted) setSavedRoutes(r.compacted);
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

  // 체력은 앱 전역의 기본 값이라 여기서 한 번만 계산한다.
  // 화면마다 부르면 같은 기준 분포를 화면 수만큼 받아 오게 된다.
  const fitness = useFitness(settings.fitness, settings.kspoServiceKey);

  const api: AppApi = useMemo(
    () => ({
      nav: setScreen,
      settings,
      setSettings: setSettingsState,
      conditions,
      fitness,
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
    [
      settings,
      conditions,
      fitness,
      savedIds,
      savedRoutes,
      toggleSaved,
      addSavedRoute,
      removeSavedRoute,
    ],
  );

  return (
    <div className="min-h-full bg-cream">
      {screen === 'build' && <BuildScreen api={api} />}
      <Suspense fallback={<ScreenSkeleton />}>
        {screen === 'explore' && <ExploreScreen api={api} />}
        {screen === 'saved' && <SavedScreen api={api} />}
        {screen === 'my' && <MyScreen api={api} />}
      </Suspense>

      {storageFull && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+86px)] z-[1100] px-3">
          <div className="mx-auto max-w-md rounded-2xl border border-coral/50 bg-coral-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-espresso shadow-card">
            <b className="text-coral-600">저장 공간이 가득 찼어요.</b> 새 기록이 이 기기에 저장되지
            않고 있어요. 마이 → 내 코스에서 오래된 기록을 지우거나, 계정에 백업한 뒤 정리해 주세요.
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
      {(screen === 'explore' || screen === 'my') && !recordOpen && !detailId && !routeView && (
        <InstallPrompt />
      )}

      <Suspense fallback={null}>
        {detailId && (
          <CourseDetailSheet courseId={detailId} api={api} onClose={() => setDetailId(null)} />
        )}
        {routeView && <RouteSheet view={routeView} api={api} onClose={() => setRouteView(null)} />}
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
      </Suspense>
    </div>
  );
}

/** 화면 청크를 받는 동안의 자리 표시 — 하단 네비까지 사라지지 않게 높이만 채운다 */
function ScreenSkeleton() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-coral" />
    </div>
  );
}
