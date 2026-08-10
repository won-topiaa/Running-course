import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Crosshair,
  Loader2,
  Play,
  Share2,
  Sparkles,
  Undo2,
} from 'lucide-react';
import RouteMap from '../components/RouteMap';
import GradeElevationChart from '../components/GradeElevationChart';
import { buildFromDistance, buildFromPins, type BuiltRoute } from '../lib/courseBuilder';
import { fallbackProvider, makeProvider, RoutingError, type RoutingProvider } from '../lib/routing';
import {
  GRADE_LEGEND,
  GRADE_COLORS,
  PATH_PREFS,
  RUN_STYLES,
  type PathPref,
  type RunStyle,
} from '../lib/routeStyle';
import { estimateTimeLabel, formatDistance } from '../lib/format';
import { fetchGreenShares } from '../lib/greenShare';
import { wayMixLabel } from '../lib/wayMix';
import { haversineMeters } from '../lib/geo';
import type { LatLng } from '../lib/types';
import type { AppApi } from '../ui/appApi';
import { HALO, VOLT } from '../ui/theme';

type Mode = 'pins' | 'distance';

/**
 * 탭을 옮겼다 돌아와도 만들던 코스가 남아 있게 하는 세션 캐시.
 *
 * 화면 컴포넌트는 탭을 바꿀 때마다 언마운트되므로 useState 만으로는 찾아둔
 * 후보가 통째로 사라진다 — 코스를 고르다 '추천'을 잠깐 열어보고 돌아오면
 * 처음부터 다시 찾아야 했다(라우팅 서버 호출도 다시 나간다).
 * 새로고침하면 사라지는 건 그대로 둔다. 그때는 새로 시작하는 게 자연스럽다.
 */
let session: {
  mode: Mode;
  waypoints: LatLng[];
  start: LatLng;
  targetKm: number;
  style: RunStyle;
  pathPref: PathPref;
  returnToStart: boolean;
  results: BuiltRoute[] | null;
  selIdx: number;
  sheetOpen: boolean;
} | null = null;

/**
 * 코스 만들기 — 지도 우선(map-first) 화면.
 * 지도가 배경 전체를 차지하고, 입력·결과는 그 위에 떠 있는 카드/바텀시트로 올린다.
 */
export default function BuildScreen({ api }: { api: AppApi }) {
  const [mode, setMode] = useState<Mode>(session?.mode ?? 'distance');
  const [waypoints, setWaypoints] = useState<LatLng[]>(session?.waypoints ?? []);
  const [start, setStart] = useState<LatLng>(session?.start ?? api.settings.homeLocation);
  const [targetKm, setTargetKm] = useState(session?.targetKm ?? 5);
  const [style, setStyle] = useState<RunStyle>(session?.style ?? 'flat');
  const [pathPref, setPathPref] = useState<PathPref>(session?.pathPref ?? 'any');

  const [results, setResults] = useState<BuiltRoute[] | null>(session?.results ?? null);
  const [selIdx, setSelIdx] = useState(session?.selIdx ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(session?.sheetOpen ?? true);
  // 고도·경사 상세는 기본으로 접는다. 한 줄 요약만 두고, 궁금한 사람만 편다.
  const [gradeOpen, setGradeOpen] = useState(false);
  // 지도를 만지는 동안에는 오버레이를 비켜준다. 반투명·블러는 실측해보니
  // 뒤가 거의 안 비쳐서 대비만 잃었다 — 잠깐 치우는 쪽이 실제로 지도를 보여준다.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [returnToStart, setReturnToStart] = useState(session?.returnToStart ?? true);
  const attemptRef = useRef(0);

  const selected = results?.[selIdx] ?? null;

  // 후보 카드는 가로로 넘긴다. 세로로 쌓으면 3개가 시트 절반을 먹어서
  // 지도가 거의 안 보였다. 스크롤이 멈춘 자리의 카드가 곧 선택이다.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const stripRaf = useRef<number | null>(null);
  // 프로그램 스크롤(점 클릭·카드 탭) 중에는 중간에 지나가는 카드로 선택이
  // 튀지 않게 잠근다 — 안 그러면 지도 경로가 한 번 깜빡였다 돌아온다.
  const stripLock = useRef(0);

  /** 스트립 중앙에 가장 가까운 카드의 index */
  const centeredIndex = (el: HTMLElement) => {
    const mid = el.getBoundingClientRect().left + el.clientWidth / 2;
    let best = 0;
    let bestD = Infinity;
    Array.from(el.children).forEach((c, i) => {
      const b = (c as HTMLElement).getBoundingClientRect();
      const d = Math.abs(b.left + b.width / 2 - mid);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const onStripScroll = () => {
    const el = stripRef.current;
    if (!el || Date.now() < stripLock.current) return;
    // scroll 은 프레임마다 수십 번 온다 — rAF 로 한 번만 반영한다
    if (stripRaf.current) cancelAnimationFrame(stripRaf.current);
    stripRaf.current = requestAnimationFrame(() => {
      const i = centeredIndex(el);
      setSelIdx((prev) => (prev === i ? prev : i));
    });
  };

  const scrollToCard = (i: number) => {
    const el = stripRef.current;
    const child = el?.children[i] as HTMLElement | undefined;
    if (!el || !child) return;
    const left =
      child.getBoundingClientRect().left -
      el.getBoundingClientRect().left +
      el.scrollLeft -
      (el.clientWidth - child.offsetWidth) / 2;
    stripLock.current = Date.now() + 600;
    el.scrollTo({ left, behavior: 'smooth' });
  };

  // 오버레이에 가리지 않는 '지도 창'의 크기. 화면 맞추기에 이 여백을 넘겨야
  // 경로가 시트 뒤에 반쯤 숨지 않는다. 스페이서(flex-1)가 곧 그 창이다.
  const gapRef = useRef<HTMLDivElement | null>(null);
  const [gapInset, setGapInset] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    const el = gapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = {
        top: Math.max(0, Math.round(r.top) + 10),
        bottom: Math.max(0, Math.round(window.innerHeight - r.bottom) + 10),
      };
      // 값이 같으면 새 객체를 만들지 않는다 — RouteMap 의 memo 가 깨진다
      setGapInset((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // 탭 전환으로 언마운트돼도 남도록 매 변경마다 세션 캐시에 반영한다
  useEffect(() => {
    session = {
      mode,
      waypoints,
      start,
      targetKm,
      style,
      pathPref,
      returnToStart,
      results,
      selIdx,
      sheetOpen,
    };
  }, [
    mode,
    waypoints,
    start,
    targetKm,
    style,
    pathPref,
    returnToStart,
    results,
    selIdx,
    sheetOpen,
  ]);

  // 새 결과가 오면 첫 카드로, 탭에서 돌아온 거면 보고 있던 카드로 맞춘다.
  // 무조건 0 으로 되돌리면 복귀 직후 onScroll 이 선택을 1번 카드로 되돌려버린다.
  const selIdxRef = useRef(selIdx);
  selIdxRef.current = selIdx;
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const child = el.children[selIdxRef.current] as HTMLElement | undefined;
    stripLock.current = Date.now() + 400;
    if (!child) {
      el.scrollTo({ left: 0 });
      return;
    }
    el.scrollTo({
      left:
        child.getBoundingClientRect().left -
        el.getBoundingClientRect().left +
        el.scrollLeft -
        (el.clientWidth - child.offsetWidth) / 2,
    });
  }, [results]);

  useEffect(
    () => () => {
      if (stripRaf.current) cancelAnimationFrame(stripRaf.current);
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    [],
  );

  // 숲길 비율 — 코스가 나온 뒤 뒤늦게 채워지는 부가 정보(greenShare.ts).
  // 순위에는 안 넣는다. 결과가 뜬 다음 도착하는 값이라 여기서 재정렬하면
  // 사용자가 카드를 고르는 중에 순서가 바뀐다.
  const [greenPct, setGreenPct] = useState<(number | null)[]>([]);
  useEffect(() => {
    setGreenPct([]);
    if (!results || results.length === 0) return;
    let alive = true;
    void fetchGreenShares(results.map((r) => r.route.coords)).then((pcts) => {
      if (alive) setGreenPct(pcts);
    });
    return () => {
      alive = false;
    };
  }, [results]);

  // 접힌 상태에서도 남길 한 줄용 고도 범위
  const elevRange = useMemo(() => {
    const e = selected?.route.elevations ?? [];
    if (e.length === 0) return null;
    return { lo: Math.round(Math.min(...e)), hi: Math.round(Math.max(...e)) };
  }, [selected]);

  // 선택되지 않은 후보는 지도에 흐린 점선으로 함께 그려 비교를 돕는다
  const alternatives = useMemo(
    () => (results ?? []).filter((_, i) => i !== selIdx).map((r) => r.route.coords),
    [results, selIdx],
  );

  const reset = () => {
    setResults(null);
    setError(null);
    setNotice(null);
  };

  const onMapClick = (p: LatLng) => {
    if (mode === 'pins') setWaypoints((w) => (w.length >= 6 ? w : [...w, p]));
    else setStart(p);
    reset();
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError('이 기기에서 위치를 쓸 수 없어요.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here: LatLng = [pos.coords.latitude, pos.coords.longitude];
        setStart(here);
        // 날씨·미세먼지도 이 위치로 맞춘다. 예전엔 홈 위치가 서울시청에 박혀
        // 있어서, 부산에서 열든 제주에서 열든 늘 '서울 날씨'가 떴다. 사용자가
        // 이미 허락한 위치라 새 권한 팝업 없이 정확해진다.
        // 같은 자리를 다시 누를 때 날씨를 또 부르지 않도록 500m 넘게 움직였을
        // 때만 갱신한다(홈 위치가 바뀌면 App 이 예보를 다시 받는다).
        if (haversineMeters(api.settings.homeLocation, here) > 500) {
          api.setSettings({ ...api.settings, homeLocation: here });
        }
        reset();
      },
      () => setError('위치 권한이 없어요. 지도를 눌러 시작점을 정해주세요.'),
    );
  };

  const generate = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setSheetOpen(true);

    // '다시 찾기'마다 시드 대역을 바꿔 새로운 루프 후보를 얻는다
    const attempt = attemptRef.current++;

    const build = (p: RoutingProvider): Promise<BuiltRoute[]> =>
      mode === 'pins'
        ? buildFromPins(waypoints, style, p, { loop: returnToStart, pathPref })
        : buildFromDistance(start, targetKm, style, p, {
            seedBase: attempt,
            oneWay: !returnToStart,
            pathPref,
          });

    // ORS → OSRM(키 불필요) → 데모(직선) 순으로 내려가며 시도
    let provider: RoutingProvider | null = makeProvider(api.settings.orsKey);
    let lastErr: unknown = null;
    try {
      while (provider) {
        try {
          const out = await build(provider);
          setResults(out);
          setSelIdx(0);
          if (!provider.realRoads) {
            setNotice(
              '실제 경로 서버에 연결할 수 없어 직선 데모로 그렸어요. 이 경로는 실제 도로가 아닙니다.',
            );
          } else if (provider.id === 'osrm' && api.settings.orsKey) {
            // 왜 대체됐는지 말해준다. 분당 한도는 1분이면 풀리는 일시적 상황이라
            // '오류'가 아니라 '잠깐 대체'로 읽혀야 한다.
            setNotice(
              lastErr instanceof RoutingError && lastErr.code === 'rate_limit'
                ? '경로 서버 무료 한도가 잠깐 가득 찼어요 — OSM 도보 경로로 만들었어요. 1분쯤 뒤 다시 찾기를 누르면 원래대로 돌아와요.'
                : 'ORS 대신 OSM 도보 경로로 만들었어요.',
            );
          }
          return;
        } catch (e) {
          lastErr = e;
          provider = fallbackProvider(provider);
        }
      }
      throw lastErr ?? new Error('경로를 만들 수 없어요.');
    } catch (e) {
      const msg =
        e instanceof RoutingError
          ? e.message
          : e instanceof Error
            ? e.message
            : '경로를 만들 수 없어요.';
      setError(msg);
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const canGenerate = mode === 'pins' ? waypoints.length >= 2 : true;
  const headline = results ? buildHeadline(results, selIdx, style) : null;

  // 결과가 있으면 '실제로 무엇으로 그렸는지', 없으면 '무엇으로 그릴 예정인지'
  const sourceBadge = (() => {
    const src = selected?.route.source;
    // short 는 좁은 화면용 — 컨디션 줄이 두 줄로 깨지지 않게 한다
    if (src === 'ors') return { text: '🛰 실경로 · ORS', short: '🛰 ORS', demo: false };
    if (src === 'osrm') return { text: '🚶 실보행로 · OSM', short: '🚶 OSM', demo: false };
    if (src === 'offline') return { text: '⚠️ 직선 데모', short: '⚠️ 데모', demo: true };
    return api.settings.orsKey
      ? { text: '🛰 실경로 · ORS', short: '🛰 ORS', demo: false }
      : { text: '🚶 실보행로 · OSM', short: '🚶 OSM', demo: false };
  })();

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-cream">
      {/* ── 배경: 전체 화면 지도 ─────────────────────────────
          지도를 누르고 있는 동안 오버레이를 잠깐 치워 전체를 보여준다.
          손을 떼면 잠시 뒤 되돌아온다 (탭으로 시작점을 찍는 흐름은 그대로). */}
      <div
        className="absolute inset-0"
        /* 캡처 단계로 듣는다 — Leaflet/카카오가 지도 위 포인터 이벤트의 전파를
           막기 때문에, 버블 단계에서는 이 핸들러까지 오지 않는다. */
        onPointerDownCapture={() => {
          if (peekTimer.current) clearTimeout(peekTimer.current);
          setPeek(true);
        }}
        onPointerUpCapture={() => {
          if (peekTimer.current) clearTimeout(peekTimer.current);
          peekTimer.current = setTimeout(() => setPeek(false), 1400);
        }}
        onPointerCancelCapture={() => {
          if (peekTimer.current) clearTimeout(peekTimer.current);
          peekTimer.current = setTimeout(() => setPeek(false), 1400);
        }}
      >
        <RouteMap
          mode={mode}
          center={mode === 'distance' ? start : api.settings.homeLocation}
          waypoints={waypoints}
          start={mode === 'distance' ? start : null}
          route={selected?.route ?? null}
          alternatives={alternatives}
          onMapClick={onMapClick}
          onPinClick={
            mode === 'pins'
              ? (i) => {
                  setWaypoints((w) => w.filter((_, k) => k !== i));
                  reset();
                }
              : undefined
          }
          kakaoKey={api.settings.kakaoJsKey}
          mapboxToken={api.settings.mapboxToken}
          fitInsets={gapInset}
        />
      </div>

      {/* ── 좌측 오버레이 컬럼 ─────────────────────────────
          입력 카드(위) · 거리 슬라이더 · 바텀시트(아래)를 한 세로 컬럼에 담는다.
          예전엔 카드는 top, 시트는 bottom 기준으로 따로 띄웠는데, 창이 낮으면
          위에서 자란 카드와 아래에서 올라온 시트가 만나 왕복/편도 줄이 가려졌다.
          같은 flex 컬럼에 두면 공간이 모자랄 때 각자 내부 스크롤로 줄어들 뿐
          서로 겹칠 수가 없다. 컬럼 자체는 클릭을 통과시켜 지도를 가리지 않는다. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+88px)] top-0 z-[500] flex flex-col px-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] transition-opacity duration-200 sm:inset-x-auto sm:left-0 sm:w-[420px] ${
          peek ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="pointer-events-auto mx-auto w-full max-w-md shrink-0 overflow-hidden rounded-3xl border border-line/70 bg-paper/80 shadow-card backdrop-blur-md sm:mx-0">
          {/* 오늘의 러닝 컨디션 — 한 줄 요약 (뛸지 말지 바로 판단) */}
          {api.conditions && (
            <div
              className={`flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 text-[11.5px] ${
                api.conditions.runScore >= 75
                  ? 'bg-sage-50 text-sage-600'
                  : api.conditions.runScore >= 55
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-coral-50 text-coral-600'
              }`}
            >
              <span>{api.conditions.emoji}</span>
              <span className="font-bold">{api.conditions.tempC}°</span>
              <span className="opacity-70">·</span>
              <span className="min-w-0 truncate">미세먼지 {api.conditions.aqiLabel}</span>
              <span className="ml-auto shrink-0 font-semibold">
                {/* 실측이 아닌 폴백 값이면 숨기지 말고 정직하게 표시 */}
                {api.conditions.source === 'sample' && (
                  <span className="mr-1 font-normal opacity-60">예시</span>
                )}
                {api.conditions.runScore}점
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  sourceBadge.demo ? 'bg-coral-100 text-coral-600' : 'bg-sage-100 text-sage-600'
                }`}
              >
                <span className="sm:hidden">{sourceBadge.short}</span>
                <span className="hidden sm:inline">{sourceBadge.text}</span>
              </span>
            </div>
          )}

          {/* 더위·자외선 조언 — 한국 여름엔 '지금 뛸까'가 코스보다 먼저다.
              위험할 때만 나오고 평소엔 줄 자체가 없다. */}
          {api.conditions?.advice && (
            <p
              className={`px-3.5 py-2 text-[11.5px] leading-relaxed ${
                api.conditions.heatRisk === 'danger'
                  ? 'bg-coral-50 text-coral-600'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              {api.conditions.advice}
            </p>
          )}

          {/* 결과를 보는 동안에는 입력 컨트롤을 접는다. 코스를 고르는 단계에서
              모드·출발·왕복·거리는 이미 정해진 값이고, 바꾸려면 시트의
              '취향 다시 고르기'(reset)로 돌아오면 된다. 이 블록이 284px 중
              대부분을 차지해서, 접어야 가로 스와이프로 아낀 높이가 실제로
              지도에 돌아간다. */}
          {!results && (
            <>
              {/* 모드 세그먼트 — 화면 제목은 하단 네비가 이미 알려주므로 두지 않는다 */}
              <div className="mx-4 mt-3 flex rounded-full bg-tint p-1">
                <SegBtn
                  active={mode === 'distance'}
                  onClick={() => {
                    setMode('distance');
                    reset();
                  }}
                >
                  🎯 거리로
                </SegBtn>
                <SegBtn
                  active={mode === 'pins'}
                  onClick={() => {
                    setMode('pins');
                    reset();
                  }}
                >
                  📍 핀으로
                </SegBtn>
              </div>

              {/* 입력 행 */}
              <div className="mt-2 px-4 pb-3">
                {mode === 'distance' ? (
                  <>
                    <InputRow
                      dot={HALO}
                      label="출발"
                      value="지도를 눌러 시작점 지정"
                      action={
                        <button
                          onClick={useMyLocation}
                          className="rounded-full bg-tint px-2.5 py-1 text-[11px] font-semibold text-espresso-muted active:scale-95"
                        >
                          내 위치
                        </button>
                      }
                    />
                  </>
                ) : (
                  <InputRow
                    dot={VOLT}
                    label="경유"
                    value={
                      waypoints.length === 0
                        ? '지도를 눌러 지점을 찍어주세요'
                        : `${waypoints.length}개 지점 · 핀을 누르면 삭제`
                    }
                    action={
                      waypoints.length > 0 ? (
                        <button
                          onClick={() => {
                            setWaypoints([]);
                            reset();
                          }}
                          className="rounded-full bg-tint px-2.5 py-1 text-[11px] font-semibold text-espresso-muted active:scale-95"
                        >
                          전체 지우기
                        </button>
                      ) : undefined
                    }
                  />
                )}

              </div>
            </>
          )}
        </div>

        {/* 지도가 보이는 구멍 — 남는 높이를 여기서 먹는다.
            min-h 로 바닥을 깔아 둔다: 예전엔 min-h-2(8px)라 화면이 짧은 폰
            (360×640)에서 시트가 지도를 60px 까지 밀어내 첫 화면이 다시
            꽉 막혀 보였다. 지도에 최소 20vh 를 먼저 떼어 주고, 모자란 만큼은
            시트가 내부 스크롤로 줄어든다(아래 CTA 는 고정이라 늘 보인다).
            여기 크기를 재서 화면 맞추기 여백으로 쓴다.

            원형 버튼도 여기에 절대배치로 얹는다. 예전엔 top-[46%] 로 화면
            비율에 고정돼 있었는데, 시트 높이가 상태에 따라 바뀌면서 시트
            위로 겹쳐 올라갔다. 구멍 바닥에 붙이면 항상 시트 바로 위에 선다. */}
        <div ref={gapRef} className="relative min-h-[20vh] flex-1">
          <div className="pointer-events-auto absolute bottom-2 right-0 flex flex-col gap-2">
            <RoundBtn label="내 위치" onClick={useMyLocation}>
              <Crosshair size={19} className="text-coral" />
            </RoundBtn>
            {mode === 'pins' && waypoints.length > 0 && (
              <RoundBtn
                label="되돌리기"
                onClick={() => {
                  setWaypoints((w) => w.slice(0, -1));
                  reset();
                }}
              >
                <Undo2 size={19} className="text-espresso-muted" />
              </RoundBtn>
            )}
          </div>
        </div>

        {/* ── 바텀시트 ─────────────────────────────────────
            컬럼의 마지막 자식. 공간이 모자라면 내부 스크롤로 줄어든다. */}
        <div className="pointer-events-auto min-h-0 shrink px-0">
          <div className="mx-auto flex h-full w-full max-w-md flex-col overflow-hidden rounded-4xl border border-line/70 bg-paper shadow-card sm:mx-0">
            {/* 핸들 — 접었을 때는 손잡이 모양만으로는 뭘 하라는 건지 안 보여서
                (하단 네비에 붙어 애매하게 겹쳐 보였다) 글자로 알려준다. */}
            <button
              onClick={() => setSheetOpen((v) => !v)}
              className="flex w-full shrink-0 items-center justify-center gap-1.5 py-2.5"
              aria-label={sheetOpen ? '접기' : '펼치기'}
              aria-expanded={sheetOpen}
            >
              {sheetOpen ? (
                <>
                  <span className="h-1 w-9 rounded-full bg-line" />
                  <ChevronDown size={14} className="text-espresso-soft" />
                </>
              ) : (
                <>
                  <ChevronUp size={15} className="text-coral" />
                  <span className="text-[12.5px] font-bold text-espresso-muted">
                    {results ? '코스 다시 보기' : '위로 올리기'}
                  </span>
                </>
              )}
            </button>

            <div
              className={`min-h-0 px-4 ${
                // 아래 여백은 고정 바가 직접 갖는다. 여기에 pb 를 두면 sticky 바가
                // 그만큼 위에 떠서, 그 틈으로 스크롤된 글자가 버튼 밑에 비친다.
                sheetOpen ? 'flex-1 overflow-y-auto pb-0' : 'overflow-hidden pb-0'
              }`}
              style={{ maxHeight: sheetOpen ? '46vh' : '0px' }}
            >
              {/* 결과 */}
              {results && headline ? (
                <>
                  {/* 헤드라인 + 되돌리기.
                      되돌리기는 원래 위에 한 줄을 따로 차지했는데, 그 46px 이
                      그대로 지도에서 빠지는 높이라 헤드라인 오른쪽으로 붙였다.
                      결과를 보다가 '다른 스타일로 뛰고 싶다'로 바뀌면 취향
                      선택으로 돌아간다(출발점·거리는 유지). */}
                  <div className="flex items-start gap-2">
                    <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[15.5px] font-extrabold leading-snug tracking-tightish text-espresso">
                      <span>{headline.lead}</span>
                      {headline.from && (
                        <>
                          <span className="text-[14px] font-semibold text-espresso-soft line-through">
                            {headline.from}
                          </span>
                          <span className="font-bold text-espresso-soft">→</span>
                        </>
                      )}
                      <span className="text-[21px] leading-none text-coral-600">
                        {headline.value}
                      </span>
                      <span>{headline.tail}</span>
                    </p>
                    <button
                      onClick={reset}
                      aria-label="취향 다시 고르기"
                      title="취향 다시 고르기"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-espresso-muted active:scale-90"
                    >
                      <Undo2 size={15} />
                    </button>
                  </div>

                  {/* 가로 스와이프 스트립. 카드 폭 86% + 양끝 7% 여백이라
                    첫/마지막 카드도 정확히 가운데에 스냅되고, 옆 카드가
                    살짝 보여서 '넘길 수 있다'는 게 드러난다. */}
                  <div
                    ref={stripRef}
                    onScroll={onStripScroll}
                    className="no-scrollbar -mx-4 mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1"
                  >
                    {results.map((r, i) => (
                      <div
                        key={i}
                        className="w-[86%] shrink-0 snap-center first:ml-[7%] last:mr-[7%]"
                      >
                        <CompareCard
                          r={r}
                          selected={i === selIdx}
                          greenPct={greenPct[i] ?? null}
                          paceSec={api.settings.paceSecPerKm}
                          onSelect={() => {
                            setSelIdx(i);
                            scrollToCard(i);
                          }}
                        />
                      </div>
                    ))}
                  </div>

                  {results.length > 1 && (
                    <div className="mt-1.5 flex items-center justify-center gap-1.5">
                      {results.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setSelIdx(i);
                            scrollToCard(i);
                          }}
                          aria-label={`${i + 1}번째 코스 보기`}
                          aria-current={i === selIdx}
                          className="grid h-4 w-4 place-items-center"
                        >
                          <span
                            className={`block rounded-full transition-all ${
                              i === selIdx ? 'h-1.5 w-4 bg-coral' : 'h-1.5 w-1.5 bg-line'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 고도·경사 상세 — 기본은 접어둔다. 그래프+범례가 200px 가까이
                      먹어서 지도를 다 덮었다. 접힌 상태에서도 '어떤 코스인지'
                      한 줄과 고도 범위는 남는다. */}
                  {selected && (
                    <div className="mt-3 overflow-hidden rounded-2xl bg-tint/60">
                      <button
                        onClick={() => setGradeOpen((v) => !v)}
                        aria-expanded={gradeOpen}
                        className="flex w-full items-center gap-2 p-3 text-left active:scale-[0.99]"
                      >
                        <span className="min-w-0 flex-1 text-[12px] leading-snug text-espresso-muted">
                          {selected.styleEval.reason}
                          {selected.pathEval.reason && (
                            <span className="mt-0.5 block text-espresso-soft">
                              {selected.pathEval.reason}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-0.5 text-[11.5px] font-bold text-espresso-soft">
                          {elevRange ? `고도 ${elevRange.lo}~${elevRange.hi}m` : '고도'}
                          <ChevronDown
                            size={13}
                            className={`transition-transform ${gradeOpen ? 'rotate-180' : ''}`}
                          />
                        </span>
                      </button>

                      {gradeOpen && (
                        <div className="px-3 pb-3">
                          <GradeElevationChart
                            elevations={selected.route.elevations}
                            lengthsM={selected.route.segments.map((s) => s.lengthM)}
                            distanceKm={selected.route.distanceKm}
                            ascentM={selected.route.ascentM}
                            height={84}
                          />
                          {/* 경사 색 범례 — 지도의 경로 색과 1:1 대응 */}
                          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-line/70 pt-2 text-[10px] text-espresso-soft">
                            {GRADE_LEGEND.map((g) => (
                              <span key={g.band} className="inline-flex items-center gap-1">
                                <span
                                  className="h-1.5 w-3 rounded-full"
                                  style={{ background: GRADE_COLORS[g.band] }}
                                />
                                {g.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 하단 액션 — 스크롤해도 항상 보이도록 고정.
                      보조 두 버튼은 아이콘만(정사각). 예전엔 글자까지 넣었더니
                      좁은 폰(375·360)에서 셋이 공간을 못 나눠 '이 경로로 뛰기'가
                      두 줄로 접혔다. 주 CTA 는 어떤 폭에서도 한 줄로 유지한다. */}
                  <div className="sticky bottom-0 -mx-4 mt-3 flex items-center gap-2 border-t border-line/60 bg-paper px-4 pb-4 pt-2.5">
                    <button
                      onClick={generate}
                      disabled={loading}
                      aria-label={loading ? '찾는 중' : '다시 찾기'}
                      title="다시 찾기"
                      className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-line text-espresso-muted transition active:scale-95 disabled:opacity-60"
                    >
                      {loading ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <Sparkles size={18} />
                      )}
                    </button>
                    <button
                      onClick={() =>
                        selected &&
                        api.viewRoute({
                          name: courseName(selected),
                          route: selected.route,
                          kind: 'built',
                          style: selected.styleEval.style,
                          source: selected.route.source,
                        })
                      }
                      aria-label="저장 · 공유"
                      title="저장 · 공유"
                      className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-line text-espresso-muted active:scale-95"
                    >
                      <Share2 size={18} />
                    </button>
                    <button
                      onClick={() =>
                        selected &&
                        api.startRecord({
                          name: courseName(selected),
                          route: selected.route,
                        })
                      }
                      className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-espresso py-3.5 text-[14px] font-bold text-ink active:scale-[0.98]"
                    >
                      <Play size={15} fill="#fff" /> 이 경로로 뛰기
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* 코스를 만드는 입력은 전부 여기 모은다.
                      예전엔 거리 슬라이더와 왕복/편도가 지도 위에 각각 떠 있어서,
                      첫 화면이 '판때기 넉 장 사이에 낀 지도 한 줄'이 됐다
                      (실측: 지도가 보이는 세로가 844px 중 190px). 입력을 시트로
                      모으면 지도가 하나의 큰 덩어리로 열린다. */}
                  {mode === 'distance' && (
                    <div className="flex items-center gap-3">
                      <span className="shrink-0 text-[12.5px] font-bold text-espresso">거리</span>
                      <div className="min-w-0 flex-1">
                        <input
                          type="range"
                          min={1}
                          max={15}
                          step={0.5}
                          value={targetKm}
                          onChange={(e) => {
                            setTargetKm(Number(e.target.value));
                            reset();
                          }}
                          className="coral w-full"
                          list="km-ticks"
                        />
                        {/* 눈금 — 1·5·10·15km 위치 표시 */}
                        <div className="relative mt-1 h-3.5">
                          {[1, 5, 10, 15].map((v) => (
                            <span
                              key={v}
                              className="absolute -translate-x-1/2 text-[9.5px] font-semibold text-espresso-soft"
                              style={{ left: `${((v - 1) / 14) * 100}%` }}
                            >
                              {v}
                            </span>
                          ))}
                        </div>
                      </div>
                      <datalist id="km-ticks">
                        {[1, 5, 10, 15].map((v) => (
                          <option key={v} value={v} />
                        ))}
                      </datalist>
                      <span className="w-[58px] shrink-0 text-right text-[16px] font-extrabold text-espresso">
                        {targetKm}
                        <span className="text-[11px] font-bold text-espresso-muted">km</span>
                      </span>
                    </div>
                  )}

                  {/* 왕복(시작점 복귀) / 편도 — 두 모드 공통 */}
                  <div className={`flex rounded-full bg-tint p-1 ${mode === 'distance' ? 'mt-2' : ''}`}>
                    <SegBtn
                      active={returnToStart}
                      onClick={() => {
                        setReturnToStart(true);
                        reset();
                      }}
                    >
                      🔄 왕복
                    </SegBtn>
                    <SegBtn
                      active={!returnToStart}
                      onClick={() => {
                        setReturnToStart(false);
                        reset();
                      }}
                    >
                      ➡️ 편도
                    </SegBtn>
                  </div>

                  {/* 스타일 선택 — 가로 한 줄 칩. 2×2 카드(설명 포함)는 세로로 너무 커서
                    지도를 다 덮었다. 선택한 것의 설명만 아래 한 줄로 보여준다. */}
                  <div className="no-scrollbar -mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
                    {RUN_STYLES.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setStyle(s.id);
                          reset();
                        }}
                        className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-[12.5px] font-bold transition active:scale-95 ${
                          style === s.id
                            ? 'border-coral bg-coral-50 text-coral-600'
                            : 'border-line bg-paper text-espresso-muted'
                        }`}
                      >
                        <span className="text-[14px]">{s.emoji}</span>
                        {s.label}
                      </button>
                    ))}
                  </div>

                  {/* 두 번째 취향 축 — 길 성격. 경사만으로는 대로변 5km 와
                      천변 5km 를 구분하지 못한다. ORS 가 같이 주는
                      waytype/surface 로 후보 순위를 조정한다. */}
                  <div className="no-scrollbar -mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
                    {PATH_PREFS.map((pp) => (
                      <button
                        key={pp.id}
                        onClick={() => {
                          setPathPref(pp.id);
                          reset();
                        }}
                        className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-[12.5px] font-bold transition active:scale-95 ${
                          pathPref === pp.id
                            ? 'border-coral bg-coral-50 text-coral-600'
                            : 'border-line bg-paper text-espresso-muted'
                        }`}
                      >
                        <span className="text-[14px]">{pp.emoji}</span>
                        {pp.label}
                      </button>
                    ))}
                  </div>
                  {/* 두 축의 설명을 한 줄로 합친다 — 각각 한 줄씩 두면 첫 화면에서
                      그 높이가 그대로 지도에서 빠진다. */}
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-espresso-soft">
                    {RUN_STYLES.find((s) => s.id === style)?.desc} ·{' '}
                    {PATH_PREFS.find((pp) => pp.id === pathPref)?.desc}
                  </p>

                  {/* 화면이 짧으면 시트가 내부 스크롤로 줄어드는데, 그때 이 버튼이
                      접힌 아래로 밀려나면 처음 쓰는 사람은 다음에 뭘 눌러야 할지
                      알 수 없다. 바닥에 고정해 어떤 높이에서도 늘 보이게 한다. */}
                  <div className="sticky bottom-0 -mx-4 mt-3 border-t border-line/60 bg-paper px-4 pb-4 pt-2.5">
                    <button
                      onClick={generate}
                      disabled={!canGenerate || loading}
                      className={`flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[14px] font-bold text-ink transition active:scale-[0.98] ${
                        canGenerate && !loading ? 'bg-coral shadow-warm' : 'bg-espresso-soft/50'
                      }`}
                    >
                      {loading ? (
                        <>
                          <Loader2 size={17} className="animate-spin" /> 최적 코스 찾는 중…
                        </>
                      ) : (
                        <>
                          <Sparkles size={17} /> 코스 추천받기
                        </>
                      )}
                    </button>
                    {mode === 'pins' && waypoints.length < 2 && (
                      <p className="mt-2 text-center text-[11.5px] text-espresso-soft">
                        지도를 눌러 지점을 2개 이상 찍어주세요.
                      </p>
                    )}
                  </div>

                </>
              )}

              {notice && (
                <p className="mt-2.5 rounded-2xl bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700">
                  {notice}
                </p>
              )}
              {error && (
                <p className="mt-2.5 rounded-2xl bg-coral-50 px-3 py-2 text-[11.5px] text-coral-600">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── 우측 상단 경사 색상 범례 ───────────────────────── */}
      <div className="pointer-events-none absolute right-3 top-3 z-[500] hidden rounded-2xl border border-line/70 bg-paper/95 p-2.5 shadow-card backdrop-blur-md sm:block">
        <p className="mb-1.5 text-[10px] font-bold text-espresso-muted">경사</p>
        <div className="space-y-1">
          {[...GRADE_LEGEND].reverse().map((g) => (
            <div key={g.band} className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full" style={{ background: GRADE_COLORS[g.band] }} />
              <span className="text-[10px] text-espresso-muted">{g.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const styleLabel = (s: RunStyle) => RUN_STYLES.find((x) => x.id === s)?.label ?? '러닝';

const courseName = (b: BuiltRoute) =>
  `${styleLabel(b.styleEval.style)} ${formatDistance(b.route.distanceKm)} 코스`;

/**
 * "총 오르막 78m → 12m 로 줄였어요" 형태의 문장형 헤드라인.
 * 후보들 중 선택된 코스가 원하는 스타일에서 얼마나 나아졌는지를 대비로 보여준다.
 */
function buildHeadline(
  results: BuiltRoute[],
  selIdx: number,
  style: RunStyle,
): { lead: string; from: string | null; value: string; tail: string } {
  const sel = results[selIdx];
  const mine = Math.round(sel.route.ascentM);
  const wantsLess = style === 'flat' || style === 'gentle';

  // 비교 대상은 '다른 후보'들 — 선택한 코스가 실제로 더 나을 때만 대비 문장을 쓴다
  const others = results.filter((_, i) => i !== selIdx).map((r) => Math.round(r.route.ascentM));
  if (others.length > 0) {
    const rival = wantsLess ? Math.max(...others) : Math.min(...others);
    const better = wantsLess ? mine < rival : mine > rival;
    if (better && Math.abs(rival - mine) >= 5) {
      return {
        lead: '총 오르막',
        from: `${rival}m`,
        value: `${mine}m`,
        tail: wantsLess ? '로 줄였어요' : '로 늘렸어요',
      };
    }
  }
  return {
    lead: `${styleLabel(style)} ·`,
    from: null,
    value: formatDistance(sel.route.distanceKm),
    tail: `· 총 오르막 ${mine}m`,
  };
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-full py-2 text-[12.5px] font-semibold transition ${
        active ? 'bg-paper text-espresso shadow-soft' : 'text-espresso-muted'
      }`}
    >
      {children}
    </button>
  );
}

function InputRow({
  dot,
  label,
  value,
  action,
}: {
  dot: string;
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white"
        style={{ background: dot }}
      />
      <span className="shrink-0 text-[12px] font-bold text-espresso-muted">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-espresso">{value}</span>
      {action}
    </div>
  );
}

function RoundBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="grid h-11 w-11 place-items-center rounded-full border border-line/70 bg-paper/95 shadow-card backdrop-blur active:scale-90"
    >
      {children}
    </button>
  );
}

/** 경로 비교 카드 — 스와치 · 이름/뱃지 · 좌측 부가정보 · 우측 핵심지표 */
function CompareCard({
  r,
  selected,
  paceSec,
  greenPct,
  onSelect,
}: {
  r: BuiltRoute;
  selected: boolean;
  paceSec: number;
  /** 숲길 비율(%) — 아직 안 왔거나 못 구했으면 null */
  greenPct: number | null;
  onSelect: () => void;
}) {
  const { route, matchScore } = r;
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99] ${
        selected ? 'border-coral bg-coral-50' : 'border-line bg-paper'
      }`}
    >
      {/* 지도 위 선 스타일과 1:1 대응하는 스와치 */}
      <span className="flex w-8 shrink-0 justify-center">
        {selected ? (
          <span className="h-1 w-8 rounded-full bg-coral" />
        ) : (
          <span className="flex w-8 gap-[3px]">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1 flex-1 rounded-full bg-espresso-soft/60" />
            ))}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-bold text-espresso">{r.label}</span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              selected ? 'bg-coral text-ink' : 'bg-tint text-espresso-muted'
            }`}
          >
            상승 {route.ascentM}m
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-espresso-muted">
          {formatDistance(route.distanceKm)} · {estimateTimeLabel(route.distanceKm, paceSec)} · 최대{' '}
          {route.maxGradePct}%
        </span>
        {/* 길 성격 + 숲길 비율. 둘 다 없으면 줄 자체를 안 만든다 —
            모르는 값을 0% 로 적으면 거짓말이 된다. */}
        {(route.way || greenPct != null) && (
          <span className="mt-0.5 block truncate text-[11px] text-espresso-soft">
            {route.way && wayMixLabel(route.way)}
            {route.way && greenPct != null && ' · '}
            {greenPct != null && (
              <span className={greenPct >= 40 ? 'font-bold text-sage-600' : ''}>
                🌳 숲길 {greenPct}%
              </span>
            )}
          </span>
        )}
      </span>

      <span className="shrink-0 text-right">
        <span
          className={`block text-[20px] font-extrabold leading-none ${
            selected ? 'text-coral-600' : 'text-espresso-soft'
          }`}
        >
          {matchScore}%
        </span>
        <span className="mt-0.5 block text-[10px] text-espresso-soft">매칭</span>
      </span>
    </button>
  );
}
