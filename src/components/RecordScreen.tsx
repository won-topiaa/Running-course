// ---------------------------------------------------------------------------
// 러닝 중 화면
//
// 이 화면만 앱의 따뜻한 톤에서 벗어나 어두운 고대비 레이아웃을 쓴다.
// 계획·탐색 화면은 소파에서 천천히 보는 화면이지만, 이 화면은 팔을 흔들며
// 0.5초 흘깃 보는 화면이기 때문이다. 그래서:
//   - 검정 바탕 + 볼트 강조색 하나 → 멈춤 버튼을 읽지 않고 찾을 수 있다
//   - 거리 숫자를 압도적으로 크게 → 팔 길이에서 초점 없이 읽힌다
//   - 모든 실시간 숫자에 tabular-nums → 초가 바뀔 때 폭이 흔들리지 않는다
//   - 어두운 바탕은 야간 러닝에 눈부심이 없고 OLED 배터리도 덜 쓴다
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from 'react';
import { Pause, Play, Square, X, Zap } from 'lucide-react';
import LiveMap from './LiveMap';
import RouteSheet from './RouteSheet';
import { savedFromView } from '../lib/savedRoutes';
import { useRunRecorder } from '../lib/useRunRecorder';
import { wakeLockSupported } from '../lib/wakeLock';
import { buildResult } from '../lib/routing';
import { formatClock, formatDistance, formatPace } from '../lib/format';
import { coloredSegments } from '../lib/routeColor';
import { advanceProgress, progressRatio, remainingMeters } from '../lib/routeProgress';
import { kmSplits, type Split } from '../lib/splits';
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

  // km 구간 기록 — 활성 시간 기준이라 신호 대기로 멈춘 시간이 섞이지 않는다
  const splits = useMemo(
    () => kmSplits(rec.coords, rec.activeTimes, true),
    [rec.coords, rec.activeTimes],
  );

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
      activeTimes: rec.activeTimes,
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
  const live = rec.status === 'recording' || rec.status === 'paused';

  const finish = () => {
    // 데모가 아니면 자동으로 내 코스에 저장 — 마이 통계가 여기서 나온다
    if (!rec.demo && rec.coords.length > 1 && !autoSaved.current) {
      const route = buildResult(rec.coords, rec.elevations, 'offline', [rec.coords[0]]);
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
  };

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-ink text-white">
      {/* 지도 — 코스를 따라 뛸 때는 넓게, 자유 러닝일 때는 숫자에 자리를 내준다 */}
      <div className={`relative ${live ? (planned ? 'h-[46%]' : 'h-[38%]') : 'flex-1'}`}>
        <LiveMap
          coords={rec.coords}
          center={planned?.route.coords[0] ?? api.settings.homeLocation}
          plannedPath={remainPath}
          traveled={traveled}
          kakaoKey={api.settings.kakaoJsKey}
          mapboxToken={api.settings.mapboxToken}
        />
        {/* 지도와 검정 패널 사이 경계를 부드럽게 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[900] h-12 bg-gradient-to-t from-ink to-transparent" />
        <button
          onClick={() => {
            rec.reset();
            onClose();
          }}
          /* top-4 로 두면 노치 기기의 PWA 에서 이 버튼이 상태바 밑으로 들어간다.
             화면에는 보이는데 그 영역의 탭은 iOS 가 먼저 가져가서 눌리지 않는다
             (index.html 이 viewport-fit=cover 라 콘텐츠가 상태바 아래까지 깔린다).
             안전영역만큼 내려서 항상 누를 수 있게 한다. 손가락 기준 44px. */
          className="absolute left-4 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[1000] grid h-11 w-11 place-items-center rounded-full bg-ink/80 text-white backdrop-blur active:scale-90"
          aria-label="닫기"
        >
          <X size={20} />
        </button>
        {rec.demo && (
          <span className="absolute right-4 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[1000] inline-flex items-center gap-1 rounded-full bg-ink/80 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-volt backdrop-blur">
            <Zap size={12} /> DEMO
          </span>
        )}
      </div>

      {/* 지표 · 컨트롤 */}
      <div className="flex flex-1 flex-col px-6 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] pt-2">
        {!live ? (
          <StartPanel rec={rec} planned={planned} />
        ) : (
          <>
            {/* 거리 — 이 화면의 주인공 */}
            <div className="flex flex-col pt-3">
              <Label>DISTANCE</Label>
              <div className="flex items-baseline gap-2">
                <span className="font-black leading-[0.85] tracking-[-0.045em] tabular-nums text-[clamp(64px,22vw,104px)]">
                  {rec.distanceKm.toFixed(2)}
                </span>
                <span className="text-[20px] font-black tracking-[0.06em] text-ink-muted">KM</span>
              </div>

              {planned && (
                <div className="mt-5">
                  <div className="mb-2 flex items-baseline justify-between">
                    <Label>COURSE</Label>
                    <span className="text-[12px] font-bold tabular-nums text-white">
                      {Math.round(ratio * 100)}% · 남은 {formatDistance(remainM / 1000)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink-line">
                    <div
                      className="h-full rounded-full bg-volt transition-[width] duration-500"
                      style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="mt-6 grid grid-cols-3 gap-3 border-t border-ink-line pt-5">
                <Stat label="TIME" value={formatClock(rec.elapsedSec)} />
                <Stat label="AVG PACE" value={rec.avgPaceSec ? formatPace(rec.avgPaceSec) : '--'} />
                <Stat
                  label="PACE"
                  value={rec.currentPaceSec ? formatPace(rec.currentPaceSec) : '--'}
                  accent
                />
              </div>
            </div>

            {/* GPS 오차가 커지면 거리 적산을 멈춘다 — 화면은 그대로인데 숫자만
                안 오르면 고장으로 보이니 이유를 말해준다. */}
            {rec.weakSignal && (
              <p className="mt-4 rounded-2xl border border-ink-line bg-ink-soft px-3 py-2.5 text-[11.5px] leading-relaxed text-white/80">
                <b className="text-volt">
                  GPS 신호가 약해요{rec.accuracyM ? ` (오차 ±${Math.round(rec.accuracyM)}m)` : ''}.
                </b>{' '}
                오차가 큰 위치는 거리에 넣지 않아요. 하늘이 보이는 곳으로 나오면 다시 쌓입니다.
              </p>
            )}

            {rec.gapSec > 0 && (
              <p className="mt-4 rounded-2xl border border-coral/50 bg-coral-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-espresso">
                <b className="text-coral-600">
                  화면이 꺼진 사이 약 {formatClock(rec.gapSec)} 동안 위치가 기록되지 않았어요.
                </b>{' '}
                그 구간 거리는 빠져 있어요 — 정확히 재려면 화면을 켜 둔 채로 뛰어 주세요.
              </p>
            )}

            <SplitList splits={splits} />

            {/* 컨트롤 — 볼트는 '계속 간다', 흰 테두리는 '멈춘다' */}
            <div className="mt-auto flex items-center gap-3 pt-5">
              {rec.status === 'recording' ? (
                <button
                  onClick={rec.pause}
                  className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-full border-2 border-ink-line text-white active:scale-95"
                  aria-label="일시정지"
                >
                  <Pause size={26} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={rec.resume}
                  className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-full bg-volt text-ink shadow-[0_0_28px_rgba(216,255,62,0.35)] active:scale-95"
                  aria-label="재개"
                >
                  <Play size={26} fill="currentColor" />
                </button>
              )}
              <button
                onClick={finish}
                className="flex h-[68px] flex-1 items-center justify-center gap-2 rounded-full bg-white text-[15px] font-black uppercase tracking-[0.08em] text-ink active:scale-[0.98]"
              >
                <Square size={17} fill="currentColor" /> 종료 · 저장
              </button>
            </div>

            <p className="mt-3 h-4 text-center text-[11px] font-bold uppercase tracking-[0.14em]">
              {rec.status === 'paused' ? (
                <span className="text-volt">PAUSED</span>
              ) : keepAwake ? (
                <span className="text-ink-muted">화면 꺼짐 방지 중</span>
              ) : null}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** 시작 전 — 큰 원형 버튼 하나로 뭘 해야 하는지 즉시 보이게 */
function StartPanel({
  rec,
  planned,
}: {
  rec: ReturnType<typeof useRunRecorder>;
  planned?: { name: string; route: RouteResult } | null;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <Label>{planned ? 'FOLLOW COURSE' : 'FREE RUN'}</Label>
      <h2 className="mt-1.5 max-w-[19rem] text-[19px] font-black leading-snug">
        {planned ? planned.name : '지금 바로 뛰기'}
      </h2>
      <p className="mt-1.5 max-w-[19rem] text-[12.5px] leading-relaxed text-ink-muted">
        {planned
          ? `점선을 따라 ${formatDistance(planned.route.distanceKm)}. 지나간 구간은 경사 색으로 채워져요.`
          : '위치를 추적해 거리·시간·페이스를 실시간으로 기록해요.'}
      </p>

      {(rec.error === 'no-geo' || rec.error === 'denied') && (
        <p className="mt-3 max-w-[19rem] rounded-2xl bg-ink-soft px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-muted">
          {rec.error === 'no-geo' ? '이 기기에서 위치를 쓸 수 없어요.' : '위치 권한이 거부됐어요.'}{' '}
          아래 데모로 체험해보세요.
        </p>
      )}

      <button
        onClick={rec.start}
        className="mt-7 grid h-[132px] w-[132px] place-items-center rounded-full bg-volt text-ink shadow-[0_0_50px_rgba(216,255,62,0.3)] active:scale-95"
      >
        <span className="text-[19px] font-black uppercase tracking-[0.06em]">START</span>
      </button>

      {/* 뛰기 전에 알려준다 — 다 뛰고 나서 기록이 비었다는 걸 아는 것보다 낫다 */}
      <p className="mt-5 max-w-[19rem] text-[11.5px] leading-relaxed text-ink-muted">
        {wakeLockSupported()
          ? '뛰는 동안 화면이 자동으로 켜져 있어요. 직접 화면을 끄거나 다른 앱으로 가면 위치 기록이 멈출 수 있어요.'
          : '이 브라우저는 화면 자동 유지가 안 돼요. 화면이 꺼지면 위치 기록이 멈추니 켜 둔 채로 뛰어 주세요.'}
      </p>

      <button
        onClick={rec.startDemo}
        className="mt-6 inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-ink-muted active:scale-95"
      >
        <Zap size={13} /> GPS 없이 데모
      </button>
    </div>
  );
}

/**
 * km 구간 기록. 막대 길이는 그 구간에서 가장 느렸던 페이스 기준 상대값이라,
 * 숫자를 읽지 않아도 어느 km 에서 처졌는지 한눈에 보인다.
 */
function SplitList({ splits }: { splits: Split[] }) {
  const done = splits.filter((s) => !s.partial);
  if (!done.length) {
    return (
      <p className="mt-6 text-[11.5px] leading-relaxed text-ink-muted">
        1km 를 채우면 구간 기록이 여기에 쌓여요.
      </p>
    );
  }
  const slowest = Math.max(...done.map((s) => s.sec));
  const fastest = Math.min(...done.map((s) => s.sec));
  // 최근 구간이 위로 오게 — 화면이 좁으면 스크롤
  const rows = [...splits].reverse();

  return (
    <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
      <Label>SPLITS</Label>
      <ul className="mt-2 space-y-1.5">
        {rows.map((s) => {
          const width = s.partial
            ? Math.round(((s.partialKm ?? 0) / 1) * 100)
            : Math.round((s.sec / slowest) * 100);
          return (
            <li key={s.km} className="flex items-center gap-2.5">
              <span className="w-6 shrink-0 text-[11px] font-black tabular-nums text-ink-muted">
                {s.partial ? '—' : s.km}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-soft">
                <span
                  className={`block h-full rounded-full ${
                    s.partial ? 'bg-ink-line' : s.sec === fastest ? 'bg-volt' : 'bg-white/45'
                  }`}
                  style={{ width: `${Math.max(width, 4)}%` }}
                />
              </span>
              <span
                className={`w-14 shrink-0 text-right text-[12.5px] font-black tabular-nums ${
                  s.partial ? 'text-ink-muted' : s.sec === fastest ? 'text-volt' : 'text-white'
                }`}
              >
                {s.partial ? formatDistance(s.partialKm ?? 0) : formatPace(s.sec)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 대문자 마이크로 라벨 — 자간을 넓혀 숫자와 확실히 구분된다 */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-black uppercase tracking-[0.2em] text-ink-muted">
      {children}
    </span>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      <p
        className={`mt-1 text-[26px] font-black leading-none tabular-nums tracking-[-0.02em] ${
          accent ? 'text-volt' : 'text-white'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
