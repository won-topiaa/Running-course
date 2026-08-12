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

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Pause, Play, Square, Volume2, VolumeX, X, Zap } from 'lucide-react';
import LiveMap from './LiveMap';
import RouteSheet from './RouteSheet';
import { savedFromView } from '../lib/savedRoutes';
import { elevationsForPath } from '../lib/elevation';
import { clearInProgress, loadInProgress, saveInProgress } from '../lib/runRecovery';
import { useRunRecorder } from '../lib/useRunRecorder';
import { wakeLockSupported } from '../lib/wakeLock';
import { buildResult } from '../lib/routing';
import { formatClock, formatDistance, formatPace } from '../lib/format';
import { coloredSegments } from '../lib/routeColor';
import {
  advanceProgress,
  cumulativeMeters,
  ratioFromCum,
  remainingFromCum,
} from '../lib/routeProgress';
import { kmSplits, type Split } from '../lib/splits';
import type { RouteResult } from '../lib/routing';
import type { LatLng } from '../lib/types';
import {
  initVoiceNav,
  tickVoiceNav,
  toggleVoice,
  stopVoiceNav,
  type VoiceNavState,
} from '../lib/voiceNav';
import type { AppApi, RouteView } from '../ui/appApi';

/**
 * 기록한 트랙의 실제 지형 고도.
 *
 * 휴대폰이 주는 GPS 고도(coords.altitude)는 ±수십 m 씩 튄다. 그대로 누적하면
 * 상승 고도가 통째로 거짓이 된다 — 실측 기록에 0.39km 를 뛰고 '총 오르막 144m,
 * 최대 경사 35%(상한)'가 찍혔다. 계획 경로가 쓰는 것과 같은 지형 고도(DEM)로
 * 바꿔 단다. 종료를 누른 사용자를 오래 붙잡을 수 없으니 잠깐만 기다리고,
 * 안 오면 원래 값을 그대로 둔다(기록이 사라지는 것보다 낫다).
 */
async function realElevations(coords: LatLng[]): Promise<number[] | null> {
  try {
    const got = await Promise.race([
      elevationsForPath(coords),
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]);
    return got && got.length === coords.length && got.every(Number.isFinite) ? got : null;
  } catch {
    return null;
  }
}

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
  // 종료할 때 받아 온 실제 지형 고도 (GPS 고도 대신 쓴다)
  const [demElev, setDemElev] = useState<number[] | null>(null);
  const [saving, setSaving] = useState(false);
  // 지난번에 저장 못 하고 끊긴 기록 (화면 꺼짐·앱 종료 등)
  const [recovered, setRecovered] = useState(() => loadInProgress());

  // ── 진행 중 기록 안전망 ────────────────────────────────────
  // 웹앱은 화면이 꺼지면 브라우저가 탭을 얼리고, 메모리가 부족하면 종료한다
  // (네이티브처럼 백그라운드에서 GPS 를 계속 받을 권한이 웹에는 없다).
  // 그 순간 기록이 통째로 사라지지 않도록 주기적으로, 그리고 화면이 가려지는
  // 바로 그 순간에 저장해 둔다 — 탭이 죽기 직전 남길 수 있는 마지막 기회다.
  const recRef = useRef(rec);
  recRef.current = rec;
  useEffect(() => {
    if (rec.status !== 'recording' || rec.demo) return;
    const snapshot = (force = false) => {
      const r = recRef.current;
      saveInProgress(
        {
        name,
        coords: r.coords,
        elevations: r.elevations,
        times: r.times,
        activeTimes: r.activeTimes,
        cumDist: r.cumDist,
          distanceKm: r.distanceKm,
          elapsedSec: r.elapsedSec,
        },
        { force },
      );
    };
    // 화면이 가려지는 순간은 무조건 쓴다 — 그 뒤에 기회가 없을 수 있다
    const onHide = () => {
      if (document.visibilityState === 'hidden') snapshot(true);
    };
    const onPageHide = () => snapshot(true);
    const t = setInterval(() => snapshot(), 10_000);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [rec.status, rec.demo, name]);

  // 계획 경로를 어디까지 지났는지 (뒤로 가지 않는 인덱스).
  // 렌더 도중에 ref 를 고치면 StrictMode 의 이중 호출·중단된 렌더에서 값이
  // 어긋날 수 있어, 좌표가 새로 들어왔을 때 effect 에서만 옮긴다.
  const [idx, setIdx] = useState(0);
  const cur = rec.coords.length ? rec.coords[rec.coords.length - 1] : null;
  useEffect(() => {
    if (!planned || !cur) return;
    setIdx((prev) => advanceProgress(planned.route.coords, cur, prev));
  }, [planned, cur]);

  // 경로는 뛰는 동안 안 바뀐다 — 누적 거리를 한 번만 만들어 두고, 매 측위마다
  // 하던 전체 경로 재순회(15km 면 측위 1회당 삼각함수 수천 번)를 없앤다.
  const plannedCum = useMemo(
    () => (planned ? cumulativeMeters(planned.route.coords) : null),
    [planned],
  );

  // ── 음성 턴바이턴 내비게이션 ────────────────────────────────
  const [voiceNav, setVoiceNav] = useState<VoiceNavState | null>(null);
  useEffect(() => {
    if (!planned || !plannedCum) return;
    setVoiceNav(initVoiceNav(planned.route.coords, plannedCum));
    return () => stopVoiceNav();
  }, [planned, plannedCum]);

  useEffect(() => {
    if (!voiceNav || !plannedCum || !planned) return;
    const totalM = plannedCum[plannedCum.length - 1] ?? 0;
    const next = tickVoiceNav(voiceNav, idx, plannedCum, rec.distanceKm, totalM, cur, planned?.route.coords);
    if (next !== voiceNav) setVoiceNav(next);
  }, [idx, rec.distanceKm]);

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
      remainM: plannedCum ? remainingFromCum(plannedCum, idx) : 0,
      ratio: plannedCum ? ratioFromCum(plannedCum, idx) : 0,
    };
  }, [planned, plannedCum, idx]);

  // km 구간 기록 — 활성 시간 기준이라 신호 대기로 멈춘 시간이 섞이지 않는다
  const splits = useMemo(
    () => kmSplits(rec.coords, rec.activeTimes, true, rec.cumDist),
    [rec.coords, rec.activeTimes, rec.cumDist],
  );

  /**
   * 기록 좌표로 RouteResult 를 만들되 거리는 기록기 값을 쓴다.
   * 좌표를 다시 합산하면 GPS 필터가 걸러낸 구간(정지 중 지터, 일시정지하고
   * 이동한 거리)이 되살아나서, 뛰는 동안 본 거리와 저장된 거리가 달라진다.
   */
  const buildRecorded = (elevOverride?: number[] | null): RouteResult => {
    const dem = elevOverride ?? demElev;
    const elev = dem ?? rec.elevations;
    const r = buildResult(rec.coords, elev, 'offline', [rec.coords[0]]);
    const withDist = rec.distanceKm > 0 ? { ...r, distanceKm: rec.distanceKm } : r;
    // 기기가 고도를 안 주고 지형 고도(DEM)도 못 받았으면, elevations 는 첫
    // 점의 지어낸 값이 끝까지 이어진 배열이다. '상승 0m' 라고 단정하지 않고
    // 모른다고 표시한다 — 저장·공유·GPX 가 이 표시를 따라간다.
    return dem == null && !rec.altitudeKnown ? { ...withDist, elevationKnown: false } : withDist;
  };

  // 기록 종료 → 요약 시트
  if (rec.status === 'finished' && rec.coords.length > 1) {
    const route = buildRecorded();
    const view: RouteView = {
      name,
      route,
      kind: 'recorded',
      source: 'gps',
      durationSec: rec.elapsedSec,
      times: rec.times,
      activeTimes: rec.activeTimes,
      cumDist: rec.cumDist,
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

  /**
   * 좌표가 2개도 안 쌓인 채 끝난 경우.
   * 예전엔 이 조건에서 아무 안내 없이 START 화면으로 되돌아갔다 — 사용자는
   * 종료를 눌렀는데 기록이 사라진 것처럼 보인다. GPS 가 자리를 잡기 전이거나
   * 실제로 거의 안 움직인 것이므로, 그렇다고 말해준다.
   */
  if (rec.status === 'finished' && rec.coords.length <= 1) {
    return (
      <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-ink px-8 text-center text-white">
        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-ink-muted">No data</p>
        <h2 className="mt-2 text-[21px] font-black">기록할 만큼 뛰지 않았어요</h2>
        <p className="mt-2.5 max-w-[19rem] text-[12.5px] leading-relaxed text-ink-muted">
          움직인 거리가 GPS 오차보다 작아서 저장하지 않았어요. 하늘이 보이는 곳에서 잠시 기다렸다가
          시작하면 더 잘 잡혀요.
        </p>
        <button
          onClick={() => rec.reset()}
          className="mt-7 w-full max-w-[15rem] rounded-full bg-volt py-3.5 text-[14px] font-black text-ink active:scale-[0.98]"
        >
          다시 시작
        </button>
        <button
          onClick={() => {
            rec.reset();
            onClose();
          }}
          className="mt-2.5 w-full max-w-[15rem] rounded-full border border-ink-line py-3.5 text-[13px] font-semibold text-ink-muted active:scale-[0.98]"
        >
          닫기
        </button>
      </div>
    );
  }

  const live = rec.status === 'recording' || rec.status === 'paused';
  // START 를 눌렀지만 아직 쓸 만한 위치를 한 번도 못 잡은 상태.
  // 권한 거부·실내·GPS 지연 어느 쪽이든 여기로 모인다. 이때 라이브 화면으로
  // 넘겨 0.00km 에 세워두면 데모로 빠져나갈 길이 사라지므로, 시작 화면을
  // 유지하며 '잡는 중'을 보여주고 데모 대안을 계속 노출한다.
  const acquiring = rec.status === 'recording' && rec.coords.length === 0;

  /**
   * 끊긴 기록을 내 코스에 저장한다 (요약을 열지 않고 한 번에 — 이미 지난 일이다).
   *
   * 정상 종료와 똑같이 지형 고도(DEM)를 입힌다. 안 그러면 복구된 기록만
   * 휴대폰 GPS 고도를 쓰게 되어, 앞서 잡았던 '0.39km 에 총 오르막 144m'
   * 문제가 이 경로에서만 되살아난다.
   */
  const recoverRun = async () => {
    const r = recovered;
    if (!r || saving) return;
    setSaving(true);
    const dem = await realElevations(r.coords);
    const route = buildResult(r.coords, dem ?? r.elevations, 'offline', [r.coords[0]]);
    api.addSavedRoute(
      savedFromView({
        name: r.name,
        route: r.distanceKm > 0 ? { ...route, distanceKm: r.distanceKm } : route,
        kind: 'recorded',
        source: 'gps',
        durationSec: r.elapsedSec,
      }),
    );
    clearInProgress();
    setRecovered(null);
    setSaving(false);
    api.nav('saved');
    onClose();
  };

  const finish = async () => {
    if (saving) return;
    setSaving(true);
    // 먼저 기록을 멈춰 좌표를 얼린다. 이걸 안 하면 아래 고도 조회를 기다리는
    // 몇 초 동안 새 측위가 계속 들어와, 조회해 둔 고도 배열과 좌표 개수가
    // 어긋나고(뒤쪽 고도가 마지막 값으로 채워진다) 화면의 거리도 계속 올라간다.
    // pause 는 활성 시간을 여기서 확정하고, 뒤따르는 stop 이 다시 더하지 않는다.
    rec.pause();
    try {
      // GPS 고도 대신 실제 지형 고도로 바꿔 단다 (못 받으면 그대로 진행)
      let dem: number[] | null = null;
      if (!rec.demo && rec.coords.length > 1) {
        dem = await realElevations(rec.coords);
        if (dem) setDemElev(dem);
      }
      // 데모가 아니면 자동으로 내 코스에 저장 — 마이 통계가 여기서 나온다
      if (!rec.demo && rec.coords.length > 1 && !autoSaved.current) {
        const route = buildRecorded(dem);
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
    } finally {
      // 무슨 일이 있어도 기록은 끝내고 요약으로 넘어간다. 여기서 멈추면
      // 방금 뛴 기록을 손에 쥔 채 화면이 굳는다.
      clearInProgress(); // 정상 종료했으니 안전망은 비운다
      rec.stop();
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-ink text-white">
      {/* 지도 — 코스를 따라 뛸 때는 넓게, 자유 러닝일 때는 숫자에 자리를 내준다 */}
      {/* 지도가 남는 세로를 전부 가져간다.
          예전엔 지도 높이를 46%/38% 로 못박아 뒀는데, 구간 기록이 아직
          없을 때(=대부분의 러닝 초반) 아래 패널의 절반이 빈 채로 화면을
          차지했다 — 뛰면서 정작 보고 싶은 건 지도인데. 패널을 내용만큼만
          쓰게 하고 나머지를 지도에 준다. 구간 기록이 쌓이면 그만큼만
          패널이 자라고 지도가 줄어든다. */}
      <div className={`relative min-h-0 flex-1`}>
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
        {planned && voiceNav?.supported && live && !acquiring && (
          <button
            onClick={() => setVoiceNav((v) => v ? toggleVoice(v) : v)}
            className={`absolute z-[1000] grid h-11 w-11 place-items-center rounded-full backdrop-blur active:scale-90 ${
              rec.demo
                ? 'right-4 top-[calc(env(safe-area-inset-top,0px)+3.5rem)]'
                : 'right-4 top-[calc(env(safe-area-inset-top,0px)+0.75rem)]'
            } ${voiceNav.enabled ? 'bg-volt/90 text-ink' : 'bg-ink/80 text-white'}`}
            aria-label={voiceNav.enabled ? '음성 안내 끄기' : '음성 안내 켜기'}
          >
            {voiceNav.enabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
        )}
      </div>

      {/* 지표 · 컨트롤 */}
      <div className={`flex flex-col px-5 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-1 ${live && !acquiring ? 'shrink-0' : 'flex-1'}`}>
        {!live || acquiring ? (
          <StartPanel
            rec={rec}
            planned={planned}
            acquiring={acquiring}
            onStart={rec.start}
            recovered={recovered}
            onRecover={recoverRun}
            busy={saving}
            onDiscard={() => {
              clearInProgress();
              setRecovered(null);
            }}
          />
        ) : (
          <>
            {/* 거리 — 이 화면의 주인공 */}
            <div className="flex flex-col pt-1">
              {/* 라벨을 뺐다 — 옆의 'KM' 이 이미 무슨 숫자인지 말한다.
                  뛰는 중에는 한 줄이라도 지도에 내주는 편이 낫다. */}
              <div className="flex items-baseline gap-2">
                <span className="font-black leading-[0.85] tracking-[-0.045em] tabular-nums text-[clamp(52px,17vw,80px)]">
                  {rec.distanceKm.toFixed(2)}
                </span>
                <span className="text-[20px] font-black tracking-[0.06em] text-ink-muted">KM</span>
              </div>

              {planned && (
                <div className="mt-3">
                  <div className="mb-1.5 flex items-baseline justify-between">
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

              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-ink-line pt-3">
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
                지도에 그리는 위치는 잠시 멈추지만, 거리·페이스는 위성 속도로 계속 잽니다.
              </p>
            )}

            {/* 화면은 켜져 있는데 측위가 아예 안 들어오는 상태.
                weakSignal 은 '측위가 왔는데 오차가 크다'라 이 경우를 못 잡고,
                gapSec 은 화면이 꺼졌다 켜질 때만 센다 — 그 사이 시계만 돌아
                평균 페이스가 조용히 부풀려지므로 여기서 말해준다.
                25초는 다리 밑·터널에서 흔한 5~15초 끊김에는 안 뜨는 값이다. */}
            {rec.status === 'recording' && !rec.demo && rec.noFixSec >= 25 && (
              <p className="mt-4 rounded-2xl border border-amber/50 bg-amber-100 px-3 py-2.5 text-[11.5px] leading-relaxed text-white/80">
                <b className="text-amber-600">
                  위치 신호가 {formatClock(rec.noFixSec)}째 안 잡혀요.
                </b>{' '}
                그동안 거리가 안 쌓여요 — 배터리 절약 모드가 켜져 있거나 실내는 아닌지 확인해
                주세요.
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
            <div className="flex items-center gap-3 pt-4">
              {rec.status === 'recording' ? (
                <button
                  onClick={rec.pause}
                  className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-full border-2 border-ink-line text-white active:scale-95"
                  aria-label="일시정지"
                >
                  <Pause size={26} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={rec.resume}
                  className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-full bg-volt text-ink shadow-[0_0_28px_rgba(216,255,62,0.35)] active:scale-95"
                  aria-label="재개"
                >
                  <Play size={26} fill="currentColor" />
                </button>
              )}
              <button
                onClick={finish}
                disabled={saving}
                className="flex h-[58px] flex-1 items-center justify-center gap-2 rounded-full bg-white text-[15px] font-black uppercase tracking-[0.08em] text-ink active:scale-[0.98] disabled:opacity-70"
              >
                <Square size={17} fill="currentColor" /> {saving ? '저장 중…' : '종료 · 저장'}
              </button>
            </div>

            <p className="mt-2 h-4 text-center text-[11px] font-bold uppercase tracking-[0.14em]">
              {rec.status === 'paused' ? (
                <span className="text-volt">PAUSED</span>
              ) : rec.autoPaused ? (
                /* 서 있는 게 확인돼 시계를 멈춘 상태. 알려주지 않으면 시간이
                   안 가는 걸 고장으로 오해한다(신호 대기에서 매번 겪는다). */
                <span className="text-volt">멈춤 감지 — 시간·거리 정지 중</span>
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
  acquiring = false,
  onStart,
  recovered,
  onRecover,
  onDiscard,
  busy = false,
}: {
  rec: ReturnType<typeof useRunRecorder>;
  planned?: { name: string; route: RouteResult } | null;
  /** START 를 눌렀지만 아직 위치를 못 잡은 중 — 스피너 + 취소로 바꾼다 */
  acquiring?: boolean;
  onStart: () => void;
  /** 지난번에 저장 못 하고 끊긴 기록 (화면 꺼짐·앱 종료) */
  recovered: { name: string; distanceKm: number; elapsedSec: number } | null;
  onRecover: () => void;
  onDiscard: () => void;
  /** 복구 저장 진행 중 (지형 고도를 받아 오는 동안) */
  busy?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      {/* 저장 못 하고 끊긴 기록 — 화면이 꺼진 채 앱이 종료되면 여기로 온다.
          그냥 두면 뛴 기록이 통째로 사라지므로 되살릴 기회를 준다. */}
      {recovered && !acquiring && (
        <div className="mb-6 w-full max-w-[19rem] rounded-2xl border border-volt/40 bg-ink-soft p-3.5 text-left">
          <p className="text-[12.5px] font-bold text-volt">저장 안 된 기록이 있어요</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            {recovered.name} · {formatDistance(recovered.distanceKm)} ·{' '}
            {formatClock(recovered.elapsedSec)}
            <br />
            화면이 꺼진 사이 앱이 종료된 것 같아요.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={onRecover}
              disabled={busy}
              className="flex-1 rounded-full bg-volt py-2 text-[12.5px] font-bold text-ink active:scale-95 disabled:opacity-70"
            >
              {busy ? '저장 중…' : '내 코스에 저장'}
            </button>
            <button
              onClick={onDiscard}
              className="rounded-full border border-ink-line px-3 py-2 text-[12px] font-semibold text-ink-muted active:scale-95"
            >
              버리기
            </button>
          </div>
        </div>
      )}
      <Label>{planned ? 'FOLLOW COURSE' : 'FREE RUN'}</Label>
      <h2 className="mt-1.5 max-w-[19rem] text-[19px] font-black leading-snug">
        {planned ? planned.name : '지금 바로 뛰기'}
      </h2>
      <p className="mt-1.5 max-w-[19rem] text-[12.5px] leading-relaxed text-ink-muted">
        {planned
          ? `점선을 따라 ${formatDistance(planned.route.distanceKm)}. 지나간 구간은 경사 색으로 채워져요.`
          : '위치를 추적해 거리·시간·페이스를 실시간으로 기록해요.'}
      </p>

      {!acquiring && (rec.error === 'no-geo' || rec.error === 'denied') && (
        <p className="mt-3 max-w-[19rem] rounded-2xl bg-ink-soft px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-muted">
          {rec.error === 'no-geo' ? '이 기기에서 위치를 쓸 수 없어요.' : '위치 권한이 거부됐어요.'}{' '}
          아래 데모로 체험해보세요.
        </p>
      )}

      {acquiring ? (
        <>
          <div className="mt-7 grid h-[132px] w-[132px] place-items-center rounded-full border-2 border-volt/40 text-volt">
            <Loader2 size={34} className="animate-spin" />
          </div>
          <p className="mt-5 max-w-[19rem] text-[12.5px] leading-relaxed text-ink-muted">
            위치를 잡는 중이에요. 위치 권한을 허용해야 기록돼요 — 하늘이 보이는 곳이면 몇 초면
            잡혀요. 안 잡히면 아래 데모로 체험할 수 있어요.
          </p>
          <button
            onClick={rec.reset}
            className="mt-4 text-[12px] font-bold uppercase tracking-[0.12em] text-ink-muted underline underline-offset-4 active:scale-95"
          >
            취소
          </button>
        </>
      ) : (
        <button
          onClick={() => {
            clearInProgress(); // 새로 시작하면 지난 복구본은 치운다
            onStart();
          }}
          className="mt-7 grid h-[132px] w-[132px] place-items-center rounded-full bg-volt text-ink shadow-[0_0_50px_rgba(216,255,62,0.3)] active:scale-95"
        >
          <span className="text-[19px] font-black uppercase tracking-[0.06em]">START</span>
        </button>
      )}

      {/* 뛰기 전에 알려준다 — 다 뛰고 나서 기록이 비었다는 걸 아는 것보다 낫다 */}
      <p className="mt-5 max-w-[19rem] text-[11.5px] leading-relaxed text-ink-muted">
        {wakeLockSupported()
          ? '뛰는 동안 화면을 계속 켜 둡니다. 직접 화면을 끄면 브라우저가 위치 추적을 멈추지만, 그때까지의 기록은 자동으로 보관돼요.'
          : '이 브라우저는 화면 자동 유지가 안 돼요. 화면이 꺼지면 위치 기록이 멈추니 켜 둔 채로 뛰어 주세요. 그때까지의 기록은 자동으로 보관됩니다.'}
      </p>

      <button
        onClick={() => rec.startDemo(planned?.route.coords)}
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
  // 아직 한 구간도 못 채웠으면 아무것도 그리지 않는다. '곧 생긴다'는 안내가
  // 뛰는 내내 한 줄을 차지할 이유가 없다 — 그 자리는 지도에 준다.
  if (!done.length) return null;
  const slowest = Math.max(...done.map((s) => s.sec));
  const fastest = Math.min(...done.map((s) => s.sec));
  // 최근 구간이 위로 오게 — 화면이 좁으면 스크롤
  const rows = [...splits].reverse();

  return (
    <div className="mt-3 max-h-[20vh] overflow-y-auto">
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
