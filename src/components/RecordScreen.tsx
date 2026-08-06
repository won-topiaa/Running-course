import { useMemo, useRef, useState } from 'react';
import { Pause, Play, Square, X, Zap } from 'lucide-react';
import LiveMap from './LiveMap';
import RouteSheet from './RouteSheet';
import { savedFromView } from '../lib/savedRoutes';
import { useRunRecorder } from '../lib/useRunRecorder';
import { wakeLockSupported } from '../lib/wakeLock';
import { buildResult } from '../lib/routing';
import { formatDistance, formatDuration, formatPace } from '../lib/format';
import { coloredSegments } from '../lib/routeColor';
import { advanceProgress, progressRatio, remainingMeters } from '../lib/routeProgress';
import type { RouteResult } from '../lib/routing';
import type { AppApi, RouteView } from '../ui/appApi';

function runName(): string {
  const d = new Date();
  const h = d.getHours();
  const part = h < 11 ? '아침' : h < 17 ? '한낮' : h < 21 ? '저녁' : '심야';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${part} 러닝`;
}

export default function RecordScreen({
  api,
  planned,
  onClose,
}: {
  api: AppApi;
  /** 따라 뛸 계획 경로 (없으면 자유 러닝) */
  planned?: { name: string; route: RouteResult } | null;
  onClose: () => void;
}) {
  const rec = useRunRecorder(planned?.route.coords[0] ?? api.settings.homeLocation);
  const [name] = useState(() => (planned ? `${planned.name} 따라 뛰기` : runName()));

  // 종료 시 자동 저장된 기록 id — 마이 통계의 데이터 원천이 된다
  const autoSaved = useRef<string | null>(null);

  // 계획 경로를 어디까지 지났는지 (뒤로 가지 않는 인덱스)
  const progIdx = useRef(0);
  const cur = rec.coords.length ? rec.coords[rec.coords.length - 1] : null;
  if (planned && cur) {
    progIdx.current = advanceProgress(planned.route.coords, cur, progIdx.current);
  }
  const idx = progIdx.current;

  // 지나온 구간은 경사 색상, 남은 구간은 눈금(점선)
  const { traveled, remainPath, remainM, ratio } = useMemo(() => {
    if (!planned) return { traveled: undefined, remainPath: undefined, remainM: 0, ratio: 0 };
    const done: RouteResult = {
      ...planned.route,
      coords: planned.route.coords.slice(0, idx + 1),
      segments: planned.route.segments.slice(0, Math.max(idx, 0)),
    };
    return {
      traveled: idx > 0 ? coloredSegments(done) : [],
      remainPath: planned.route.coords.slice(Math.max(idx, 0)),
      remainM: remainingMeters(planned.route.coords, idx),
      ratio: progressRatio(planned.route.coords, idx),
    };
  }, [planned, idx]);

  // 기록 종료 → 요약 시트
  if (rec.status === 'finished' && rec.coords.length > 1) {
    const route = buildResult(rec.coords, rec.elevations, 'offline', [rec.coords[0]]);
    const view: RouteView = {
      name,
      route,
      kind: 'recorded',
      source: 'gps',
      durationSec: rec.elapsedSec,
      times: rec.times,
      savedId: autoSaved.current ?? undefined,
    };
    return (
      <RouteSheet
        view={view}
        api={api}
        mode="summary"
        onClose={() => {
          rec.reset();
          onClose();
        }}
      />
    );
  }

  const keepAwake = wakeLockSupported();

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-cream">
      {/* 지도 */}
      <div className="relative flex-1">
        <LiveMap
          coords={rec.coords}
          center={planned?.route.coords[0] ?? api.settings.homeLocation}
          plannedPath={remainPath}
          traveled={traveled}
          kakaoKey={api.settings.kakaoJsKey}
          mapboxToken={api.settings.mapboxToken}
        />
        <button
          onClick={() => {
            rec.reset();
            onClose();
          }}
          className="absolute left-4 top-4 z-[1000] grid h-10 w-10 place-items-center rounded-full bg-paper/90 text-espresso shadow-card backdrop-blur active:scale-90"
          aria-label="닫기"
        >
          <X size={20} />
        </button>
        {rec.demo && (
          <span className="absolute right-4 top-4 z-[1000] inline-flex items-center gap-1 rounded-full bg-espresso/80 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
            <Zap size={12} /> 데모 재생 중
          </span>
        )}
      </div>

      {/* 하단 패널 */}
      <div className="rounded-t-4xl bg-paper px-5 pb-8 pt-5 shadow-[0_-8px_24px_rgba(44,39,37,0.08)]">
        {rec.status === 'idle' ? (
          <div className="text-center">
            <h2 className="text-[19px] font-extrabold text-espresso">
              {planned ? '이 경로로 뛰기' : '지금 바로 뛰기'}
            </h2>
            <p className="mt-1 text-[13px] text-espresso-muted">
              {planned
                ? `점선을 따라 ${formatDistance(planned.route.distanceKm)}. 지나간 구간은 경사 색으로 채워져요.`
                : '위치를 추적해 거리·시간·페이스를 실시간으로 기록해요.'}
            </p>
            {(rec.error === 'no-geo' || rec.error === 'denied') && (
              <p className="mt-2 rounded-2xl bg-coral-50 px-3 py-2 text-[12px] text-coral-600">
                {rec.error === 'no-geo'
                  ? '이 기기에서 위치를 쓸 수 없어요.'
                  : '위치 권한이 거부됐어요.'}{' '}
                아래 데모로 체험해보세요.
              </p>
            )}
            <button
              onClick={rec.start}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-coral py-4 text-[15px] font-bold text-white shadow-warm active:scale-[0.98]"
            >
              <Play size={18} fill="#fff" /> 러닝 시작
            </button>
            <button
              onClick={rec.startDemo}
              className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-espresso-muted underline"
            >
              <Zap size={13} /> GPS 없이 데모로 체험
            </button>
          </div>
        ) : (
          <>
            {/* 실시간 지표 */}
            <div className="flex items-end justify-center gap-2">
              <span className="text-[52px] font-extrabold leading-none tracking-tight text-espresso">
                {rec.distanceKm.toFixed(2)}
              </span>
              <span className="mb-2 text-[16px] font-bold text-espresso-muted">km</span>
            </div>
            {planned && (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[11.5px]">
                  <span className="font-semibold text-espresso-muted">코스 진행</span>
                  <span className="font-bold text-espresso">
                    {Math.round(ratio * 100)}% · 남은 {formatDistance(remainM / 1000)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-tint">
                  <div
                    className="h-full rounded-full bg-coral transition-[width]"
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Live label="시간" value={formatDuration(rec.elapsedSec)} />
              <Live label="평균 페이스" value={rec.avgPaceSec ? `${formatPace(rec.avgPaceSec)}` : '--'} />
              <Live label="현재 페이스" value={rec.currentPaceSec ? `${formatPace(rec.currentPaceSec)}` : '--'} />
            </div>

            {/* 컨트롤 */}
            <div className="mt-5 flex items-center justify-center gap-3">
              {rec.status === 'recording' ? (
                <button
                  onClick={rec.pause}
                  className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-line bg-paper text-espresso active:scale-95"
                  aria-label="일시정지"
                >
                  <Pause size={26} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={rec.resume}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-coral text-white shadow-warm active:scale-95"
                  aria-label="재개"
                >
                  <Play size={26} fill="#fff" />
                </button>
              )}
              <button
                onClick={() => {
                  // 데모가 아니면 자동으로 내 코스에 저장 — 마이 통계가 여기서 나온다
                  if (!rec.demo && rec.coords.length > 1 && !autoSaved.current) {
                    const route = buildResult(rec.coords, rec.elevations, 'offline', [
                      rec.coords[0],
                    ]);
                    const saved = savedFromView({
                      name,
                      route,
                      kind: 'recorded',
                      source: 'gps',
                      durationSec: rec.elapsedSec,
                    });
                    api.addSavedRoute(saved);
                    autoSaved.current = saved.id;
                  }
                  rec.stop();
                }}
                className="flex h-16 flex-1 items-center justify-center gap-2 rounded-full bg-espresso text-[15px] font-bold text-white active:scale-[0.98]"
              >
                <Square size={18} fill="#fff" /> 종료 · 저장
              </button>
            </div>
            <p className="mt-3 text-center text-[11.5px] font-medium">
              {rec.status === 'paused' ? (
                <span className="text-coral-600">일시정지됨</span>
              ) : keepAwake ? (
                <span className="text-espresso-soft">🔆 뛰는 동안 화면이 꺼지지 않아요</span>
              ) : null}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Live({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-tint/70 py-3">
      <p className="text-[18px] font-extrabold leading-none text-espresso">{value}</p>
      <p className="mt-1 text-[11px] text-espresso-soft">{label}</p>
    </div>
  );
}
