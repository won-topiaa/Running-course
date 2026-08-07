import { useEffect, useState } from 'react';
import {
  Activity,
  Bookmark,
  Check,
  Download,
  Loader2,
  Mountain,
  Play,
  Share2,
  Timer,
  TrendingUp,
  Trash2,
  X,
} from 'lucide-react';
import GradeElevationChart from './GradeElevationChart';
import KakaoLinkRow from './KakaoLinkRow';
import RouteMap from './RouteMap';
import { GRADE_COLORS, GRADE_LEGEND, RUN_STYLES } from '../lib/routeStyle';
import { buildGpx, downloadGpx } from '../lib/gpx';
import { loadToken, STRAVA_UPLOAD_PAGE, uploadGpx } from '../lib/strava';
import { buildShareToken, savedFromView, shareUrl } from '../lib/savedRoutes';
import { estimateTimeLabel, formatDuration, formatPace } from '../lib/format';
import type { AppApi, RouteView } from '../ui/appApi';

const noop = () => {};

export default function RouteSheet({
  view,
  api,
  mode = 'view',
  onClose,
}: {
  view: RouteView;
  api: AppApi;
  mode?: 'view' | 'summary';
  onClose: () => void;
}) {
  const [savedId, setSavedId] = useState<string | undefined>(view.savedId);
  const [toast, setToast] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  };

  const { route } = view;
  const styleLabel = view.style ? RUN_STYLES.find((s) => s.id === view.style)?.label : null;
  const paceSec =
    view.durationSec && route.distanceKm > 0
      ? view.durationSec / route.distanceKm
      : api.settings.paceSecPerKm;
  const timeLabel = view.durationSec
    ? formatDuration(view.durationSec)
    : `약 ${estimateTimeLabel(route.distanceKm, api.settings.paceSecPerKm)}`;

  const doSave = () => {
    const rec = savedFromView({
      name: view.name,
      route,
      kind: view.kind === 'shared' ? 'built' : view.kind,
      style: view.style,
      source: view.source,
      durationSec: view.durationSec,
    });
    api.addSavedRoute(rec);
    setSavedId(rec.id);
    flash('내 코스에 저장했어요');
  };

  const doDelete = () => {
    if (savedId) api.removeSavedRoute(savedId);
    onClose();
  };

  const doShare = async () => {
    const token = buildShareToken({
      name: view.name,
      style: view.style,
      distanceKm: route.distanceKm,
      ascentM: route.ascentM,
      maxGradePct: route.maxGradePct,
      source: view.source,
      coords: route.coords,
      elevations: route.elevations,
    });
    const url = shareUrl(token);
    try {
      if (navigator.share) {
        await navigator.share({ title: view.name, text: '내 러닝 코스를 확인해보세요', url });
        return;
      }
    } catch {
      /* 사용자가 취소 */
    }
    try {
      await navigator.clipboard.writeText(url);
      flash('공유 링크를 복사했어요');
    } catch {
      flash('링크 복사에 실패했어요');
    }
  };

  const gpxOf = () =>
    buildGpx({
      name: view.name,
      coords: route.coords,
      elevations: route.elevations,
      times: view.times,
    });

  const doGpx = () => {
    downloadGpx(view.name, gpxOf());
    flash('GPX 파일을 내보냈어요');
  };

  /**
   * Strava 는 시각(<time>) 정보가 없는 GPX 를 거부한다.
   * 기록한 러닝은 실제 시각을 쓰고, 만든 코스는 설정 페이스로 시각을 합성해
   * '예상 페이스 러닝'으로 올라가게 한다. (GPX 내보내기는 시각 없이 순수 경로 유지)
   */
  const gpxForStrava = () => {
    if (view.times) return gpxOf();
    const paceMs = api.settings.paceSecPerKm * 1000;
    const startT = Date.now() - route.distanceKm * paceMs;
    const times: number[] = [startT];
    let t = startT;
    for (const seg of route.segments) {
      t += (seg.lengthM / 1000) * paceMs;
      times.push(t);
    }
    return buildGpx({
      name: view.name,
      coords: route.coords,
      elevations: route.elevations,
      times,
    });
  };

  const doStrava = async () => {
    const workerUrl = api.settings.stravaWorkerUrl;
    const token = loadToken();
    // Worker 미연결이면 지금 바로 되는 경로: GPX 저장 + 업로드 페이지
    if (!workerUrl || !token) {
      downloadGpx(view.name, gpxForStrava());
      window.open(STRAVA_UPLOAD_PAGE, '_blank', 'noopener');
      flash('GPX 저장 · Strava 업로드 페이지를 열었어요');
      return;
    }
    setUploading(true);
    try {
      await uploadGpx({ workerUrl, token, name: view.name, gpx: gpxForStrava() });
      flash('Strava에 업로드했어요 🎉');
    } catch (e) {
      flash(e instanceof Error ? e.message : '업로드에 실패했어요');
    } finally {
      setUploading(false);
    }
  };

  const headline = mode === 'summary' ? '🎉 러닝 완료!' : styleLabel ?? '내 코스';

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-4xl bg-cream shadow-card sm:rounded-4xl">
        {/* 헤더 */}
        <div className="relative bg-gradient-to-br from-coral to-coral-600 p-5 text-ink">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-ink/15 text-ink backdrop-blur active:scale-90"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
          <p className="text-[12.5px] font-semibold text-ink/70">{headline}</p>
          <h2 className="mt-0.5 text-[20px] font-extrabold leading-tight">{view.name}</h2>
          <div className="mt-3 flex items-end gap-4">
            <div>
              <p className="text-[34px] font-extrabold leading-none">
                {route.distanceKm.toFixed(2)}
                <span className="ml-1 text-[15px] font-bold">km</span>
              </p>
            </div>
            <div className="mb-0.5">
              <p className="text-[15px] font-bold leading-none">{timeLabel}</p>
              <p className="mt-1 text-[12px] text-ink/70">{formatPace(paceSec)}/km</p>
            </div>
          </div>
        </div>

        <div className="p-4">
          {/* 지도 */}
          <div className="h-56 overflow-hidden rounded-3xl border border-line">
            <RouteMap
              mode="pins"
              center={route.coords[0]}
              waypoints={[]}
              start={null}
              route={route}
              onMapClick={noop}
              kakaoKey={api.settings.kakaoJsKey}
              mapboxToken={api.settings.mapboxToken}
            />
          </div>
          {/* 경사 범례 */}
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10.5px] text-espresso-muted">
            {GRADE_LEGEND.map((g) => (
              <span key={g.band} className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: GRADE_COLORS[g.band] }} />
                {g.label}
              </span>
            ))}
          </div>

          {/* 스탯 */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Metric icon={<Timer size={15} />} value={timeLabel.replace('약 ', '')} label="시간" />
            <Metric icon={<TrendingUp size={15} />} value={`${route.ascentM}m`} label="총 오르막" />
            <Metric icon={<Mountain size={15} />} value={`${route.maxGradePct}%`} label="최대 경사" />
          </div>

          {/* 고도 */}
          <div className="mt-3 rounded-3xl border border-line bg-paper p-4 shadow-soft">
            <GradeElevationChart
              elevations={route.elevations}
              lengthsM={route.segments.map((s) => s.lengthM)}
              distanceKm={route.distanceKm}
              ascentM={route.ascentM}
            />
          </div>

          {/* 이 경로 따라 뛰기 — 기록 요약에서는 이미 뛴 것이라 숨긴다 */}
          {mode !== 'summary' && (
            <button
              onClick={() => {
                onClose();
                api.startRecord({ name: view.name, route });
              }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-espresso py-3.5 text-[14px] font-bold text-ink active:scale-[0.98]"
            >
              <Play size={16} fill="currentColor" /> 이 경로 따라 뛰기
            </button>
          )}

          {/* 카카오맵 링크 — 코스 출발점까지 길찾기 */}
          <KakaoLinkRow name={view.name} point={route.coords[0]} className="mt-4" />

          {/* 액션 */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {savedId ? (
              <ActionBtn onClick={doDelete} tone="line" icon={<Trash2 size={16} />}>
                삭제
              </ActionBtn>
            ) : (
              <ActionBtn onClick={doSave} tone="coral" icon={<Bookmark size={16} />}>
                내 코스에 저장
              </ActionBtn>
            )}
            <ActionBtn onClick={doShare} tone="sage" icon={<Share2 size={16} />}>
              공유
            </ActionBtn>
            <ActionBtn onClick={doGpx} tone="line" icon={<Download size={16} />}>
              GPX 내보내기
            </ActionBtn>
            <ActionBtn
              onClick={doStrava}
              tone="strava"
              icon={
                uploading ? <Loader2 size={16} className="animate-spin" /> : <Activity size={16} />
              }
            >
              {uploading ? '업로드 중…' : 'Strava에 올리기'}
            </ActionBtn>
          </div>
          {savedId && (
            <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-sage-600">
              <Check size={13} /> 내 코스에 저장됨
            </p>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[2100] -translate-x-1/2 rounded-full bg-espresso px-4 py-2.5 text-[13px] font-medium text-ink shadow-card">
          {toast}
        </div>
      )}
    </div>
  );
}

function Metric({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-3 text-center shadow-soft">
      <div className="mx-auto mb-1 flex items-center justify-center text-coral">{icon}</div>
      <p className="text-[15px] font-extrabold leading-none text-espresso">{value}</p>
      <p className="mt-1 text-[10.5px] text-espresso-soft">{label}</p>
    </div>
  );
}

const TONES: Record<string, string> = {
  coral: 'bg-coral text-ink shadow-warm',
  sage: 'bg-sage-100 text-sage-600',
  line: 'border border-line bg-paper text-espresso-muted',
  strava: 'bg-[#FC4C02] text-white',
};

function ActionBtn({
  onClick,
  tone,
  icon,
  children,
}: {
  onClick: () => void;
  tone: keyof typeof TONES | string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-full py-3 text-[13px] font-semibold transition active:scale-[0.98] ${TONES[tone] ?? TONES.line}`}
    >
      {icon}
      {children}
    </button>
  );
}
