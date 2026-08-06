import { useState } from 'react';
import {
  Bookmark,
  Crosshair,
  Info,
  Loader2,
  MapPin,
  Mountain,
  Play,
  Sparkles,
  Timer,
  TrendingUp,
  Undo2,
} from 'lucide-react';
import RouteMap from '../components/RouteMap';
import GradeElevationChart from '../components/GradeElevationChart';
import { buildFromDistance, buildFromPins, type BuiltRoute } from '../lib/courseBuilder';
import { makeProvider, OfflineProvider, RoutingError } from '../lib/routing';
import { GRADE_LEGEND, GRADE_COLORS, RUN_STYLES, type RunStyle } from '../lib/routeStyle';
import { estimateTimeLabel, formatDistance } from '../lib/format';
import type { LatLng } from '../lib/types';
import type { AppApi } from '../ui/appApi';

type Mode = 'pins' | 'distance';

export default function BuildScreen({ api }: { api: AppApi }) {
  const [mode, setMode] = useState<Mode>('pins');
  const [waypoints, setWaypoints] = useState<LatLng[]>([]);
  const [start, setStart] = useState<LatLng>(api.settings.homeLocation);
  const [targetKm, setTargetKm] = useState(5);
  const [style, setStyle] = useState<RunStyle>('flat');

  const [results, setResults] = useState<BuiltRoute[] | null>(null);
  const [selIdx, setSelIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);

  const selected = results?.[selIdx] ?? null;

  const onMapClick = (p: LatLng) => {
    if (mode === 'pins') {
      setWaypoints((w) => (w.length >= 6 ? w : [...w, p]));
    } else {
      setStart(p);
    }
    setResults(null);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStart([pos.coords.latitude, pos.coords.longitude]);
        setResults(null);
      },
      () => setError('위치 권한을 가져올 수 없어요. 지도를 눌러 시작점을 정해주세요.'),
    );
  };

  const generate = async () => {
    setLoading(true);
    setError(null);
    setFallback(null);
    let provider = makeProvider(api.settings.orsKey);
    const build = (): Promise<BuiltRoute[]> =>
      mode === 'pins'
        ? buildFromPins(waypoints, style, provider)
        : buildFromDistance(start, targetKm, style, provider);
    try {
      let out: BuiltRoute[];
      try {
        out = await build();
      } catch (e) {
        // ORS 실패 시 오프라인 데모로 폴백
        if (provider.id === 'ors') {
          provider = new OfflineProvider();
          setFallback(
            e instanceof RoutingError && e.code === 'invalid_key'
              ? 'API 키 오류로 오프라인 데모 경로를 보여드려요.'
              : '실 API에 연결할 수 없어 오프라인 데모 경로를 보여드려요.',
          );
          out = await build();
        } else {
          throw e;
        }
      }
      setResults(out);
      setSelIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '경로를 만들 수 없어요.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const canGenerate = mode === 'pins' ? waypoints.length >= 2 : true;
  const offline = !api.settings.orsKey;

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-28 pt-5">
      <header className="mb-3">
        <h1 className="text-[22px] font-extrabold tracking-tightish text-espresso">
          나만의 코스 만들기
        </h1>
        <p className="mt-1 text-[13px] text-espresso-muted">
          핀을 찍거나 거리를 정하면 스타일에 맞는 최적 코스를 추천해요.
        </p>
      </header>

      {/* 모드 토글 */}
      <div className="mb-3 flex rounded-full bg-tint p-1">
        <ModeBtn active={mode === 'pins'} onClick={() => { setMode('pins'); setResults(null); }}>
          📍 핀으로 만들기
        </ModeBtn>
        <ModeBtn active={mode === 'distance'} onClick={() => { setMode('distance'); setResults(null); }}>
          🎯 거리로 만들기
        </ModeBtn>
      </div>

      {/* 지도 */}
      <div className="relative h-[44vh] min-h-[300px] overflow-hidden rounded-3xl border border-line shadow-soft">
        <RouteMap
          mode={mode}
          center={mode === 'distance' ? start : api.settings.homeLocation}
          waypoints={waypoints}
          start={mode === 'distance' ? start : null}
          route={selected?.route ?? null}
          onMapClick={onMapClick}
          kakaoKey={api.settings.kakaoJsKey}
          mapboxToken={api.settings.mapboxToken}
        />
        {/* 안내 오버레이 */}
        <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-paper/90 px-3 py-1.5 text-[11.5px] font-medium text-espresso shadow-soft backdrop-blur">
          {mode === 'pins'
            ? `지도를 눌러 핀 추가 (${waypoints.length}/6)`
            : '지도를 눌러 시작점 변경'}
        </div>
        {mode === 'pins' && waypoints.length > 0 && (
          <button
            onClick={() => { setWaypoints((w) => w.slice(0, -1)); setResults(null); }}
            className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-paper/90 px-3 py-1.5 text-[11.5px] font-semibold text-espresso shadow-soft backdrop-blur active:scale-95"
          >
            <Undo2 size={13} /> 되돌리기
          </button>
        )}
        {selected && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl bg-paper/90 px-3 py-2 text-[10.5px] text-espresso-muted shadow-soft backdrop-blur">
            {GRADE_LEGEND.map((g) => (
              <span key={g.band} className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: GRADE_COLORS[g.band] }} />
                {g.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 컨트롤 */}
      <div className="mt-3 rounded-3xl border border-line bg-paper p-4 shadow-soft">
        {mode === 'distance' && (
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[13.5px] font-semibold text-espresso">목표 거리</label>
              <span className="text-[15px] font-bold text-coral-600">{targetKm}km</span>
            </div>
            <input
              type="range"
              min={1}
              max={15}
              step={0.5}
              value={targetKm}
              onChange={(e) => { setTargetKm(Number(e.target.value)); setResults(null); }}
              className="coral w-full"
            />
            <button
              onClick={useMyLocation}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-cream px-3.5 py-2 text-[12.5px] font-semibold text-espresso active:scale-95"
            >
              <Crosshair size={14} className="text-coral" /> 내 위치에서 시작
            </button>
          </div>
        )}

        {/* 스타일 선택 */}
        <label className="text-[13.5px] font-semibold text-espresso">러닝 스타일</label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {RUN_STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => { setStyle(s.id); setResults(null); }}
              className={`flex items-center gap-2 rounded-2xl border p-3 text-left transition active:scale-[0.98] ${
                style === s.id
                  ? 'border-coral bg-coral-50'
                  : 'border-line bg-paper'
              }`}
            >
              <span className="text-xl">{s.emoji}</span>
              <span>
                <span className="block text-[13px] font-bold text-espresso">{s.label}</span>
                <span className="block text-[11px] text-espresso-soft">{s.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={generate}
          disabled={!canGenerate || loading}
          className={`mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[14px] font-bold text-white shadow-warm transition active:scale-[0.98] ${
            canGenerate && !loading ? 'bg-coral' : 'bg-espresso-soft/50'
          }`}
        >
          {loading ? (
            <><Loader2 size={17} className="animate-spin" /> 최적 코스 찾는 중…</>
          ) : (
            <><Sparkles size={17} /> 코스 추천받기</>
          )}
        </button>
        {mode === 'pins' && waypoints.length < 2 && (
          <p className="mt-2 text-center text-[11.5px] text-espresso-soft">
            핀을 2개 이상 찍어주세요.
          </p>
        )}
      </div>

      {/* 데이터 소스 안내 */}
      {offline && (
        <button
          onClick={() => api.nav('my')}
          className="mt-3 flex w-full items-start gap-2 rounded-2xl border border-line bg-tint/60 p-3 text-left"
        >
          <Info size={15} className="mt-0.5 shrink-0 text-sage-600" />
          <span className="text-[12px] leading-relaxed text-espresso-muted">
            지금은 <b className="text-espresso">오프라인 데모</b>(합성 고도) 모드예요. 실제 도로
            경로·고도를 쓰려면 마이 페이지에서 OpenRouteService 키를 연결하세요.
          </span>
        </button>
      )}
      {fallback && (
        <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-[12px] text-amber-700">{fallback}</p>
      )}
      {error && (
        <p className="mt-3 rounded-2xl bg-coral-50 p-3 text-[12px] text-coral-600">{error}</p>
      )}

      {/* 결과 */}
      {results && results.length > 0 && (
        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-espresso">추천 코스</h2>
            <span className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-medium text-espresso-muted">
              {selected?.route.source === 'ors' ? '실데이터 · ORS' : '오프라인 데모'}
            </span>
          </div>
          <div className="space-y-3">
            {results.map((r, i) => (
              <ResultCard
                key={i}
                r={r}
                selected={i === selIdx}
                onSelect={() => setSelIdx(i)}
                api={api}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ModeBtn({
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
      className={`flex-1 rounded-full py-2.5 text-[13px] font-semibold transition ${
        active ? 'bg-paper text-espresso shadow-soft' : 'text-espresso-muted'
      }`}
    >
      {children}
    </button>
  );
}

function ResultCard({
  r,
  selected,
  onSelect,
  api,
}: {
  r: BuiltRoute;
  selected: boolean;
  onSelect: () => void;
  api: AppApi;
}) {
  const { route, styleEval, matchScore, label } = r;
  const paceSec = api.settings.paceSecPerKm;
  const styleLabel = RUN_STYLES.find((s) => s.id === styleEval.style)?.label ?? '러닝';
  const openSheet = () =>
    api.viewRoute({
      name: `${styleLabel} ${formatDistance(route.distanceKm)} 코스`,
      route,
      kind: 'built',
      style: styleEval.style,
      source: route.source,
    });
  return (
    <article
      onClick={onSelect}
      className={`cursor-pointer rounded-3xl border bg-paper p-4 shadow-soft transition ${
        selected ? 'border-coral ring-2 ring-coral-100' : 'border-line'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-0.5">
          <span className="text-[22px] font-extrabold text-coral-600">{matchScore}</span>
          <span className="text-[12px] font-semibold text-coral-600">%</span>
        </div>
        <div className="flex-1">
          <p className="text-[14px] font-bold text-espresso">{label}</p>
          <p className="text-[11.5px] text-espresso-soft">스타일 매칭</p>
        </div>
        {selected && (
          <span className="rounded-full bg-coral px-2.5 py-1 text-[11px] font-semibold text-white">
            지도에 표시됨
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Stat icon={<MapPin size={13} />}>{formatDistance(route.distanceKm)}</Stat>
        <Stat icon={<TrendingUp size={13} />}>상승 {route.ascentM}m</Stat>
        <Stat icon={<Mountain size={13} />}>최대 {route.maxGradePct}%</Stat>
        <Stat icon={<Timer size={13} />}>약 {estimateTimeLabel(route.distanceKm, paceSec)}</Stat>
      </div>

      {selected && (
        <div className="mt-3">
          <GradeElevationChart
            elevations={route.elevations}
            lengthsM={route.segments.map((s) => s.lengthM)}
            distanceKm={route.distanceKm}
            ascentM={route.ascentM}
          />
          <p className="mt-2 rounded-2xl bg-tint/70 p-3 text-[12.5px] leading-relaxed text-espresso-muted">
            ✅ {styleEval.reason}
          </p>
          <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={openSheet}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-line bg-paper py-2.5 text-[12.5px] font-semibold text-espresso-muted active:scale-[0.98]"
            >
              <Bookmark size={14} /> 저장 · 공유
            </button>
            <button
              onClick={() => api.startRecord()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-coral py-2.5 text-[12.5px] font-semibold text-white shadow-warm active:scale-[0.98]"
            >
              <Play size={14} fill="#fff" /> 이 코스로 뛰기
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function Stat({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sage-50 px-2.5 py-1 text-[11.5px] font-medium text-sage-600">
      {icon}
      {children}
    </span>
  );
}
