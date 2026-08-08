import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Compass,
  Crosshair,
  Loader2,
  Play,
  Route as RouteIcon,
  Sparkles,
  Undo2,
} from 'lucide-react';
import RouteMap from '../components/RouteMap';
import GradeElevationChart from '../components/GradeElevationChart';
import { buildFromDistance, buildFromPins, type BuiltRoute } from '../lib/courseBuilder';
import {
  fallbackProvider,
  makeProvider,
  RoutingError,
  type RoutingProvider,
} from '../lib/routing';
import { GRADE_LEGEND, GRADE_COLORS, RUN_STYLES, type RunStyle } from '../lib/routeStyle';
import { estimateTimeLabel, formatDistance } from '../lib/format';
import type { LatLng } from '../lib/types';
import type { AppApi } from '../ui/appApi';
import { HALO, VOLT } from '../ui/theme';

type Mode = 'pins' | 'distance';

/**
 * 코스 만들기 — 지도 우선(map-first) 화면.
 * 지도가 배경 전체를 차지하고, 입력·결과는 그 위에 떠 있는 카드/바텀시트로 올린다.
 */
export default function BuildScreen({ api }: { api: AppApi }) {
  const [mode, setMode] = useState<Mode>('distance');
  const [waypoints, setWaypoints] = useState<LatLng[]>([]);
  const [start, setStart] = useState<LatLng>(api.settings.homeLocation);
  const [targetKm, setTargetKm] = useState(5);
  const [style, setStyle] = useState<RunStyle>('flat');

  const [results, setResults] = useState<BuiltRoute[] | null>(null);
  const [selIdx, setSelIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [returnToStart, setReturnToStart] = useState(true);
  const attemptRef = useRef(0);

  const selected = results?.[selIdx] ?? null;

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
        setStart([pos.coords.latitude, pos.coords.longitude]);
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
        ? buildFromPins(waypoints, style, p, { loop: returnToStart })
        : buildFromDistance(start, targetKm, style, p, {
            seedBase: attempt,
            oneWay: !returnToStart,
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
            setNotice('ORS 대신 OSM 도보 경로로 만들었어요.');
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
    if (src === 'ors') return { text: '🛰 실경로 · ORS', demo: false };
    if (src === 'osrm') return { text: '🚶 실보행로 · OSM', demo: false };
    if (src === 'offline') return { text: '⚠️ 직선 데모', demo: true };
    return api.settings.orsKey
      ? { text: '🛰 실경로 · ORS', demo: false }
      : { text: '🚶 실보행로 · OSM', demo: false };
  })();

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-cream">
      {/* ── 배경: 전체 화면 지도 ───────────────────────────── */}
      <div className="absolute inset-0">
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
        />
      </div>

      {/* ── 좌측 오버레이 컬럼 ─────────────────────────────
          입력 카드(위) · 거리 슬라이더 · 바텀시트(아래)를 한 세로 컬럼에 담는다.
          예전엔 카드는 top, 시트는 bottom 기준으로 따로 띄웠는데, 창이 낮으면
          위에서 자란 카드와 아래에서 올라온 시트가 만나 왕복/편도 줄이 가려졌다.
          같은 flex 컬럼에 두면 공간이 모자랄 때 각자 내부 스크롤로 줄어들 뿐
          서로 겹칠 수가 없다. 컬럼 자체는 클릭을 통과시켜 지도를 가리지 않는다. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[100px] top-0 z-[500] flex flex-col px-3 pt-3 sm:inset-x-auto sm:left-0 sm:w-[420px]">
        <div className="pointer-events-auto mx-auto w-full max-w-md shrink-0 rounded-3xl border border-line/70 bg-paper/95 shadow-card backdrop-blur-md sm:mx-0">
          {/* 오늘의 러닝 컨디션 — 한 줄 요약 (뛸지 말지 바로 판단) */}
          {api.conditions && (
            <div
              className={`flex items-center gap-2 px-4 py-2 text-[11.5px] ${
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
              <span>미세먼지 {api.conditions.aqiLabel}</span>
              <span className="ml-auto font-semibold">
                러닝 적합도 {api.conditions.runScore}
              </span>
            </div>
          )}

          {/* 헤더 */}
          <div className="flex items-center gap-2 px-4 pt-3.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-coral">
              <RouteIcon size={16} className="text-white" strokeWidth={2.4} />
            </span>
            <h1 className="text-[16px] font-extrabold tracking-tightish text-espresso">
              코스 만들기
            </h1>
            <span
              className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                sourceBadge.demo
                  ? 'bg-coral-100 text-coral-600'
                  : 'bg-sage-100 text-sage-600'
              }`}
            >
              {sourceBadge.text}
            </span>
          </div>

          {/* 모드 세그먼트 */}
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
                <div className="my-1 h-px bg-line" />
                <InputRow
                  dot={VOLT}
                  label="목표"
                  value={`${targetKm}km ${returnToStart ? '왕복' : '편도'} 코스`}
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

            {/* 왕복(시작점 복귀) / 편도 — 두 모드 공통 */}
            <div className="my-1 h-px bg-line" />
            <div className="flex rounded-full bg-tint p-1">
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
          </div>
        </div>

        {/* 거리 슬라이더 — 카드 바로 아래, 같은 컬럼 안 */}
        {mode === 'distance' && (
          <div className="pointer-events-auto mt-2 shrink-0">
            <div className="mx-auto flex w-full max-w-md items-center gap-3 rounded-full border border-line/70 bg-paper/95 py-2.5 pl-3 pr-4 shadow-card backdrop-blur-md sm:mx-0">
              <span className="shrink-0 rounded-full bg-tint px-3 py-1.5 text-[12px] font-bold text-espresso">
                거리
              </span>
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
              <span className="w-[62px] shrink-0 text-right text-[16px] font-extrabold text-espresso">
                {targetKm}
                <span className="text-[11px] font-bold text-espresso-muted">km</span>
              </span>
            </div>
          </div>
        )}

        {/* 지도가 보이는 구멍 — 남는 높이를 여기서 먹는다 */}
        <div className="min-h-2 flex-1" />

        {/* ── 바텀시트 ─────────────────────────────────────
            컬럼의 마지막 자식. 공간이 모자라면 내부 스크롤로 줄어든다. */}
        <div className="pointer-events-auto min-h-0 shrink px-0">
          <div className="mx-auto flex h-full w-full max-w-md flex-col overflow-hidden rounded-4xl border border-line/70 bg-paper shadow-card sm:mx-0">
          {/* 핸들 */}
          <button
            onClick={() => setSheetOpen((v) => !v)}
            className="flex w-full shrink-0 items-center justify-center gap-1.5 py-2.5"
            aria-label={sheetOpen ? '접기' : '펼치기'}
          >
            <span className="h-1 w-9 rounded-full bg-line" />
            <ChevronDown
              size={14}
              className={`text-espresso-soft transition-transform ${sheetOpen ? '' : 'rotate-180'}`}
            />
          </button>

          <div
            className={`min-h-0 px-4 ${
              sheetOpen ? 'flex-1 overflow-y-auto pb-4' : 'overflow-hidden pb-0'
            }`}
            style={{ maxHeight: sheetOpen ? '46vh' : '0px' }}
          >
            {/* 결과 */}
            {results && headline ? (
              <>
                {/* 되돌리기 — 결과를 보다가 '다른 스타일로 뛰고 싶다'로 생각이
                    바뀌면 취향 선택으로 돌아간다. 입력(출발점·거리)은 유지된다. */}
                <button
                  onClick={reset}
                  aria-label="취향 다시 고르기"
                  className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-espresso-muted active:scale-95"
                >
                  <Undo2 size={13} /> 취향 다시 고르기
                </button>
                <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[15.5px] font-extrabold leading-snug tracking-tightish text-espresso">
                  <span>{headline.lead}</span>
                  {headline.from && (
                    <>
                      <span className="text-[14px] font-semibold text-espresso-soft line-through">
                        {headline.from}
                      </span>
                      <span className="font-bold text-espresso-soft">→</span>
                    </>
                  )}
                  <span className="text-[21px] leading-none text-coral-600">{headline.value}</span>
                  <span>{headline.tail}</span>
                </p>

                <div className="mt-3 space-y-2">
                  {results.map((r, i) => (
                    <CompareCard
                      key={i}
                      r={r}
                      selected={i === selIdx}
                      paceSec={api.settings.paceSecPerKm}
                      onSelect={() => setSelIdx(i)}
                    />
                  ))}
                </div>

                {selected && (
                  <div className="mt-3 rounded-2xl bg-tint/60 p-3">
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
                    <p className="mt-2 text-[12px] leading-relaxed text-espresso-muted">
                      {selected.styleEval.reason}
                    </p>
                  </div>
                )}

                {/* 하단 액션 — 스크롤해도 항상 보이도록 고정 */}
                <div className="sticky bottom-0 -mx-4 mt-3 flex items-center gap-2 border-t border-line/60 bg-paper px-4 pb-1 pt-2.5">
                  <button
                    onClick={generate}
                    disabled={loading}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-3 text-[12.5px] font-semibold text-espresso-muted transition active:scale-95 disabled:opacity-60"
                  >
                    {loading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    {loading ? '찾는 중…' : '다시 찾기'}
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
                    className="shrink-0 rounded-full border border-line px-3.5 py-3 text-[12.5px] font-semibold text-espresso-muted active:scale-95"
                  >
                    저장 · 공유
                  </button>
                  <button
                    onClick={() =>
                      selected &&
                      api.startRecord({ name: courseName(selected), route: selected.route })
                    }
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-espresso py-3 text-[13.5px] font-bold text-ink active:scale-[0.98]"
                  >
                    <Play size={15} fill="#fff" /> 이 경로로 뛰기
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* 스타일 선택 */}
                <p className="text-[13px] font-bold text-espresso">어떻게 뛰고 싶으세요?</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {RUN_STYLES.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setStyle(s.id);
                        reset();
                      }}
                      className={`flex items-center gap-2 rounded-2xl border p-2.5 text-left transition active:scale-[0.98] ${
                        style === s.id ? 'border-coral bg-coral-50' : 'border-line bg-paper'
                      }`}
                    >
                      <span className="text-lg">{s.emoji}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-bold text-espresso">
                          {s.label}
                        </span>
                        <span className="block truncate text-[10.5px] text-espresso-soft">
                          {s.desc}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>

                <button
                  onClick={generate}
                  disabled={!canGenerate || loading}
                  className={`mt-3 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[14px] font-bold text-ink transition active:scale-[0.98] ${
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

                {/* 코스를 짜는 것 자체가 막막한 사람을 위한 보조 진입로 */}
                <button
                  onClick={() => api.nav('explore')}
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 py-1 text-[12px] font-semibold text-espresso-soft underline decoration-line underline-offset-4"
                >
                  <Compass size={13} /> 어디서 뛸지 모르겠다면 · 추천 코스 보기
                </button>
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
              <span
                className="h-2 w-4 rounded-full"
                style={{ background: GRADE_COLORS[g.band] }}
              />
              <span className="text-[10px] text-espresso-muted">{g.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 우측 원형 플로팅 버튼 ─────────────────────────── */}
      <div className="absolute right-3 top-[46%] z-[500] flex flex-col gap-2">
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
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-espresso">
        {value}
      </span>
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
  onSelect,
}: {
  r: BuiltRoute;
  selected: boolean;
  paceSec: number;
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
          {formatDistance(route.distanceKm)} · {estimateTimeLabel(route.distanceKm, paceSec)} ·
          최대 {route.maxGradePct}%
        </span>
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
