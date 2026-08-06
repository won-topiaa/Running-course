import { useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  Cloud,
  Download,
  Flame,
  Footprints,
  Map as MapIcon,
  Play,
  Plus,
  Timer,
  Trash2,
  Upload,
} from 'lucide-react';
import { estimateTimeLabel, formatPace } from '../lib/format';
import { computeRunStats, earnedBadges, levelLabel } from '../lib/runStats';
import {
  exportBackupFile,
  importBackupFile,
  makeSyncCode,
  pullSync,
  pushSync,
} from '../lib/backup';
import { connect as connectStrava, loadToken, saveToken } from '../lib/strava';
import type { Settings } from '../lib/config';
import type { AppApi } from '../ui/appApi';

// --- 러닝화 등록제: 등록일 이후의 실제 기록 거리로 마일리지를 누적 -------------
const SHOES_KEY = 'run-app-shoes-v1';
const SHOE_LIMIT_KM = 600; // 일반적인 러닝화 교체 권장 마일리지

interface Shoe {
  id: string;
  name: string;
  sinceMs: number;
}

function loadShoes(): Shoe[] {
  try {
    const raw = localStorage.getItem(SHOES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* 무시 */
  }
  return [];
}

export default function MyScreen({ api }: { api: AppApi }) {
  const pace = api.settings.paceSecPerKm;
  const setPace = (v: number) => api.setSettings({ ...api.settings, paceSecPerKm: v });
  const saveField = (field: keyof Settings, value: string) =>
    api.setSettings({ ...api.settings, [field]: value.trim() || null });

  // ── 실제 기록에서 계산한 통계 ──────────────────────────────
  const stats = useMemo(() => computeRunStats(api.savedRoutes), [api.savedRoutes]);
  const badges = useMemo(() => earnedBadges(api.savedRoutes, stats), [api.savedRoutes, stats]);
  const recordedRuns = useMemo(
    () => api.savedRoutes.filter((r) => r.kind === 'recorded'),
    [api.savedRoutes],
  );
  const goal = api.settings.weekGoalKm;
  const goalPct = Math.min(100, Math.round((stats.weekKm / goal) * 100));
  const maxWeek = Math.max(...stats.weekly.map((w) => w.km), 3);
  const setGoal = (delta: number) =>
    api.setSettings({
      ...api.settings,
      weekGoalKm: Math.max(5, Math.min(100, goal + delta)),
    });

  // ── 러닝화 ────────────────────────────────────────────────
  const [shoes, setShoes] = useState<Shoe[]>(loadShoes);
  const [shoeName, setShoeName] = useState('');
  const persistShoes = (next: Shoe[]) => {
    setShoes(next);
    try {
      localStorage.setItem(SHOES_KEY, JSON.stringify(next));
    } catch {
      /* 무시 */
    }
  };
  const shoeMileage = (s: Shoe) =>
    recordedRuns.filter((r) => r.createdAt >= s.sinceMs).reduce((sum, r) => sum + r.distanceKm, 0);

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-28 pt-5">
      {/* 프로필 — 실제 기록 기반 */}
      <div className="flex items-center gap-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-coral-50 text-3xl">
          🏃
        </span>
        <div>
          <h1 className="text-[19px] font-extrabold text-espresso">러너</h1>
          <p className="text-[12.5px] text-espresso-muted">
            {levelLabel(stats)}
            {stats.monthsTogether > 0 && ` · 함께한 지 ${stats.monthsTogether}개월`}
          </p>
        </div>
      </div>

      {stats.runCount === 0 ? (
        /* 기록이 없을 때 — 가짜 숫자 대신 정직한 빈 상태 */
        <div className="mt-4 flex flex-col items-center rounded-3xl border border-dashed border-line bg-paper/60 p-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-coral-50">
            <Footprints size={24} className="text-coral" />
          </span>
          <p className="mt-3 text-[14px] font-semibold text-espresso">아직 기록이 없어요</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-espresso-soft">
            첫 러닝을 마치면 여기에 진짜 통계가 쌓여요.
          </p>
          <button
            onClick={() => api.startRecord()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-2.5 text-[13px] font-semibold text-white shadow-warm active:scale-95"
          >
            <Play size={15} fill="#fff" /> 첫 러닝 시작하기
          </button>
        </div>
      ) : (
        <>
          {/* 이번 주 목표 — 목표는 ± 로 조절 */}
          <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-espresso">이번 주 러닝</span>
              <span className="flex items-center gap-1.5 text-[12.5px] text-espresso-muted">
                <b className="text-coral-600">{stats.weekKm.toFixed(1)}km</b> /
                <button
                  onClick={() => setGoal(-5)}
                  className="grid h-5 w-5 place-items-center rounded-full bg-tint font-bold active:scale-90"
                  aria-label="목표 줄이기"
                >
                  −
                </button>
                {goal}km
                <button
                  onClick={() => setGoal(5)}
                  className="grid h-5 w-5 place-items-center rounded-full bg-tint font-bold active:scale-90"
                  aria-label="목표 늘리기"
                >
                  +
                </button>
              </span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-tint">
              <div className="h-full rounded-full bg-coral" style={{ width: `${goalPct}%` }} />
            </div>
            <div className="mt-4 flex items-end justify-between gap-2" style={{ height: 74 }}>
              {stats.weekly.map((w) => (
                <div key={w.label} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className={`w-full rounded-md ${w.km > 0 ? 'bg-sage' : 'bg-line'}`}
                      style={{ height: `${Math.max(4, (w.km / maxWeek) * 56)}px` }}
                      title={`${w.km.toFixed(1)}km`}
                    />
                  </div>
                  <span className="text-[10.5px] text-espresso-soft">{w.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 스탯 타일 — 전부 실측 */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <StatTile
              icon={<Footprints size={16} className="text-coral" />}
              value={stats.totalKm >= 100 ? String(Math.round(stats.totalKm)) : stats.totalKm.toFixed(1)}
              unit="km"
              label="누적 거리"
            />
            <StatTile
              icon={<Flame size={16} className="text-coral" />}
              value={String(stats.streakDays)}
              unit="일"
              label="연속 러닝"
            />
            <StatTile
              icon={<Timer size={16} className="text-coral" />}
              value={String(stats.runCount)}
              unit="회"
              label="러닝 횟수"
            />
          </div>
        </>
      )}

      {/* 러닝화 마일리지 — 등록일 이후 실제 거리로 누적 */}
      <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
        <h2 className="text-[14px] font-bold text-espresso">👟 러닝화 마일리지</h2>
        <p className="mt-1 text-[11.5px] text-espresso-soft">
          신발을 등록하면 그 뒤의 기록 거리가 자동으로 쌓여요. 교체 권장 {SHOE_LIMIT_KM}km.
        </p>
        <div className="mt-3 space-y-3">
          {shoes.map((s) => {
            const km = shoeMileage(s);
            const pct = Math.min(100, Math.round((km / SHOE_LIMIT_KM) * 100));
            const warn = pct >= 80;
            return (
              <div key={s.id}>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="font-semibold text-espresso">👟 {s.name}</span>
                  <span className="flex items-center gap-2">
                    <span className={warn ? 'font-semibold text-coral-600' : 'text-espresso-muted'}>
                      {km.toFixed(0)} / {SHOE_LIMIT_KM}km
                    </span>
                    <button
                      onClick={() => persistShoes(shoes.filter((x) => x.id !== s.id))}
                      className="text-espresso-soft active:scale-90"
                      aria-label={`${s.name} 삭제`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-tint">
                  <div
                    className={`h-full rounded-full ${warn ? 'bg-coral' : 'bg-sage'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {warn && <p className="mt-1 text-[11px] text-coral-600">교체 시기가 다가와요.</p>}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={shoeName}
            onChange={(e) => setShoeName(e.target.value)}
            placeholder="신발 이름 (예: 페가수스 41)"
            className="min-w-0 flex-1 rounded-full border border-line bg-cream px-3.5 py-2 text-[12.5px] text-espresso outline-none focus:border-coral"
          />
          <button
            onClick={() => {
              const name = shoeName.trim();
              if (!name) return;
              persistShoes([
                ...shoes,
                { id: `s${Date.now().toString(36)}`, name, sinceMs: Date.now() },
              ]);
              setShoeName('');
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral px-3.5 py-2 text-[12.5px] font-semibold text-white active:scale-95"
          >
            <Plus size={14} /> 등록
          </button>
        </div>
      </div>

      {/* 배지 — 실제 달성만 */}
      <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
        <h2 className="text-[14px] font-bold text-espresso">획득 배지</h2>
        {badges.length === 0 ? (
          <p className="mt-2 text-[12px] text-espresso-soft">
            첫 러닝을 마치면 배지가 열리기 시작해요.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {badges.map((b) => (
              <span
                key={b.label}
                className="inline-flex items-center gap-1.5 rounded-full bg-tint px-3 py-2 text-[12px] font-medium text-espresso"
              >
                <span className="text-base">{b.emoji}</span> {b.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 페이스 계산기 */}
      <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <h2 className="inline-flex items-center gap-1.5 text-[14px] font-bold text-espresso">
            <Timer size={16} className="text-coral" /> 페이스 계산기
          </h2>
          <span className="text-[16px] font-extrabold text-coral-600">{formatPace(pace)}/km</span>
        </div>
        <input
          type="range"
          min={210}
          max={480}
          step={5}
          value={pace}
          onChange={(e) => setPace(Number(e.target.value))}
          className="coral mt-3 w-full"
        />
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { label: '5K', km: 5 },
            { label: '10K', km: 10 },
            { label: '하프', km: 21.0975 },
          ].map((d) => (
            <div key={d.label} className="rounded-2xl bg-tint/70 py-2.5">
              <p className="text-[11px] text-espresso-soft">{d.label}</p>
              <p className="text-[14px] font-bold text-espresso">
                {estimateTimeLabel(d.km, pace)}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-espresso-soft">
          이 페이스는 코스별 예상 소요 시간에도 함께 반영돼요.
        </p>
      </div>

      {/* 데이터 이동 — 기기가 바뀌어도 기록이 따라가게 */}
      <SyncSection api={api} />

      {/* 외부 서비스 연동 */}
      <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
        <h2 className="text-[14px] font-bold text-espresso">🔌 외부 서비스 연동</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-espresso-muted">
          키를 넣으면 실지도·실경로가 켜져요. 없어도 앱은 오프라인 데모로 동작합니다.
        </p>

        <div className="mt-3 space-y-3">
          <KeyRow
            icon={<MapIcon size={15} className="text-coral" />}
            title="카카오맵 (기본 지도)"
            desc="한국 지도. 개발자 콘솔에 배포 도메인을 등록해야 표시됩니다."
            placeholder="카카오 JavaScript 키"
            current={api.settings.kakaoJsKey}
            connected="카카오맵 연결됨"
            offline="OSM 폴백"
            link="https://developers.kakao.com/console/app"
            onSave={(v) => saveField('kakaoJsKey', v)}
          />
          <KeyRow
            icon={<MapIcon size={15} className="text-espresso-soft" />}
            title="Mapbox 지도 (대체)"
            desc="카카오 대신 쓰고 싶을 때. 없으면 OpenStreetMap."
            placeholder="pk.eyJ... 토큰"
            current={api.settings.mapboxToken}
            connected="Mapbox 연결됨"
            offline="미사용"
            link="https://account.mapbox.com/access-tokens/"
            onSave={(v) => saveField('mapboxToken', v)}
          />
          <KeyRow
            icon={<Activity size={15} className="text-coral" />}
            title="OpenRouteService 경로"
            desc="코스 만들기의 실제 도로 경로·경사."
            placeholder="ORS API 키"
            current={api.settings.orsKey}
            connected="실경로 연결됨"
            offline="오프라인 데모"
            link="https://openrouteservice.org/dev/#/signup"
            onSave={(v) => saveField('orsKey', v)}
          />
          <StravaRow api={api} />
        </div>
      </div>
    </div>
  );
}

/** 데이터 이동 — 파일 백업(항상 동작) + 동기화 코드(sync-worker 배포 시) */
function SyncSection({ api }: { api: AppApi }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [workerUrl, setWorkerUrl] = useState(api.settings.syncWorkerUrl ?? '');
  const [code, setCode] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const savedUrl = api.settings.syncWorkerUrl;

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 3200);
  };

  const onImportFile = async (f: File | null) => {
    if (!f) return;
    try {
      const n = await importBackupFile(f);
      flash(`${n}개 항목을 불러왔어요. 새로고침합니다…`);
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      flash(e instanceof Error ? e.message : '가져오기에 실패했어요.');
    }
  };

  const doPush = async () => {
    if (!savedUrl) return;
    setBusy(true);
    try {
      const c = code.trim() || makeSyncCode();
      await pushSync(savedUrl, c);
      setCode(c);
      flash(`올렸어요! 다른 기기에서 코드 "${c}" 로 가져오세요. (90일 보관)`);
    } catch (e) {
      flash(e instanceof Error ? e.message : '업로드에 실패했어요.');
    } finally {
      setBusy(false);
    }
  };

  const doPull = async () => {
    if (!savedUrl || !code.trim()) return;
    setBusy(true);
    try {
      const n = await pullSync(savedUrl, code.trim());
      flash(`${n}개 항목을 받았어요. 새로고침합니다…`);
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      flash(e instanceof Error ? e.message : '가져오기에 실패했어요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
      <h2 className="inline-flex items-center gap-1.5 text-[14px] font-bold text-espresso">
        <Cloud size={16} className="text-coral" /> 데이터 이동
      </h2>
      <p className="mt-1 text-[12px] leading-relaxed text-espresso-muted">
        기록·설정은 이 기기 안에만 저장돼요. 기기를 바꿀 땐 아래로 옮기세요.
      </p>

      {/* 1) 파일 — 서버 없이 항상 동작 */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => {
            exportBackupFile();
            flash('백업 파일을 내려받았어요.');
          }}
          className="flex items-center justify-center gap-1.5 rounded-full border border-line py-2.5 text-[12.5px] font-semibold text-espresso-muted active:scale-95"
        >
          <Download size={14} /> 파일로 내보내기
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center justify-center gap-1.5 rounded-full border border-line py-2.5 text-[12.5px] font-semibold text-espresso-muted active:scale-95"
        >
          <Upload size={14} /> 파일 가져오기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => onImportFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {/* 2) 동기화 코드 — sync-worker 배포 시 */}
      <div className="mt-3 rounded-2xl bg-tint/50 p-3">
        <p className="text-[12.5px] font-bold text-espresso">동기화 코드 (선택)</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-espresso-soft">
          <code className="text-[10.5px]">server/sync-worker</code>를 배포하면 파일 없이
          코드 하나로 기기 간 동기화가 돼요.
        </p>
        {!savedUrl ? (
          <div className="mt-2 flex gap-2">
            <input
              value={workerUrl}
              onChange={(e) => setWorkerUrl(e.target.value)}
              placeholder="https://...workers.dev"
              className="min-w-0 flex-1 rounded-full border border-line bg-paper px-3.5 py-2 text-[12.5px] text-espresso outline-none focus:border-coral"
            />
            <button
              onClick={() =>
                api.setSettings({ ...api.settings, syncWorkerUrl: workerUrl.trim() || null })
              }
              className="shrink-0 rounded-full bg-coral px-3.5 py-2 text-[12.5px] font-semibold text-white active:scale-95"
            >
              저장
            </button>
          </div>
        ) : (
          <>
            <div className="mt-2 flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="동기화 코드 (비우면 새로 생성)"
                className="min-w-0 flex-1 rounded-full border border-line bg-paper px-3.5 py-2 font-mono text-[12.5px] text-espresso outline-none focus:border-coral"
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={doPush}
                disabled={busy}
                className="rounded-full bg-coral py-2.5 text-[12.5px] font-semibold text-white active:scale-95 disabled:opacity-60"
              >
                이 기기 → 올리기
              </button>
              <button
                onClick={doPull}
                disabled={busy || !code.trim()}
                className="rounded-full bg-espresso py-2.5 text-[12.5px] font-semibold text-white active:scale-95 disabled:opacity-60"
              >
                코드로 가져오기
              </button>
            </div>
          </>
        )}
      </div>

      {msg && (
        <p className="mt-2.5 rounded-2xl bg-sage-50 px-3 py-2 text-[12px] text-sage-600">{msg}</p>
      )}
    </div>
  );
}

/** Strava 자동 업로드 — Worker 주소 저장 + OAuth 연결/해제 */
function StravaRow({ api }: { api: AppApi }) {
  const [url, setUrl] = useState(api.settings.stravaWorkerUrl ?? '');
  const [token, setToken] = useState(loadToken());
  const saved = api.settings.stravaWorkerUrl;

  const save = () => api.setSettings({ ...api.settings, stravaWorkerUrl: url.trim() || null });
  const disconnect = () => {
    saveToken(null);
    setToken(null);
  };

  return (
    <div className="rounded-2xl bg-tint/50 p-3">
      <div className="flex items-center gap-1.5 text-[13px] font-bold text-espresso">
        <Activity size={15} style={{ color: '#FC4C02' }} /> Strava 자동 업로드 (선택)
      </div>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-espresso-soft">
        연결 안 해도 <b className="text-espresso-muted">GPX 내보내기</b>로 업로드할 수 있어요.
        자동 업로드를 쓰려면 <code className="text-[10.5px]">server/strava-worker</code>를 배포하고
        주소를 넣으세요.
      </p>

      {token ? (
        <div className="mt-2 flex items-center justify-between rounded-xl bg-paper px-3 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-sage-600">
            <Check size={14} /> 연결됨{token.athlete ? ` · ${token.athlete}님` : ''}
          </span>
          <button
            onClick={disconnect}
            className="rounded-full border border-line px-3 py-1.5 text-[11.5px] font-semibold text-espresso-muted active:scale-95"
          >
            연결 해제
          </button>
        </div>
      ) : (
        <>
          <div className="mt-2 flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://...workers.dev"
              className="min-w-0 flex-1 rounded-full border border-line bg-paper px-3.5 py-2 text-[12.5px] text-espresso outline-none focus:border-coral"
            />
            <button
              onClick={save}
              className="shrink-0 rounded-full bg-coral px-3.5 py-2 text-[12.5px] font-semibold text-white active:scale-95"
            >
              저장
            </button>
          </div>
          {saved && (
            <button
              onClick={() => connectStrava(saved)}
              className="mt-2 w-full rounded-full bg-[#FC4C02] py-2.5 text-[12.5px] font-bold text-white active:scale-[0.98]"
            >
              Strava 계정 연결하기
            </button>
          )}
        </>
      )}

      <div className="mt-2 flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold ${
            token ? 'text-sage-600' : 'text-espresso-soft'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${token ? 'bg-sage' : 'bg-espresso-soft/50'}`} />
          {token ? '자동 업로드 켜짐' : 'GPX 수동 업로드'}
        </span>
        <a
          href="https://www.strava.com/settings/api"
          target="_blank"
          rel="noreferrer"
          className="text-[11.5px] font-medium text-coral-600 underline"
        >
          Strava API 설정 →
        </a>
      </div>
    </div>
  );
}

function KeyRow({
  icon,
  title,
  desc,
  placeholder,
  current,
  connected,
  offline,
  link,
  onSave,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  placeholder: string;
  current: string | null;
  connected: string;
  offline: string;
  link: string;
  onSave: (v: string) => void;
}) {
  const [val, setVal] = useState(current ?? '');
  const [done, setDone] = useState(false);
  const save = () => {
    onSave(val);
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  };
  return (
    <div className="rounded-2xl bg-tint/50 p-3">
      <div className="flex items-center gap-1.5 text-[13px] font-bold text-espresso">
        {icon} {title}
      </div>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-espresso-soft">{desc}</p>
      <div className="mt-2 flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-full border border-line bg-paper px-3.5 py-2 text-[12.5px] text-espresso outline-none focus:border-coral"
        />
        <button
          onClick={save}
          className="shrink-0 rounded-full bg-coral px-3.5 py-2 text-[12.5px] font-semibold text-white active:scale-95"
        >
          {done ? <Check size={15} /> : '저장'}
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold ${
            current ? 'text-sage-600' : 'text-espresso-soft'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${current ? 'bg-sage' : 'bg-espresso-soft/50'}`} />
          {current ? connected : offline}
        </span>
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="text-[11.5px] font-medium text-coral-600 underline"
        >
          키 발급 →
        </a>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  value,
  unit,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <div className="rounded-3xl border border-line bg-paper p-3.5 text-center shadow-soft">
      <div className="mx-auto mb-1 grid h-8 w-8 place-items-center rounded-full bg-coral-50">
        {icon}
      </div>
      <p className="text-[18px] font-extrabold leading-none text-espresso">
        {value}
        <span className="text-[11px] font-semibold text-espresso-soft"> {unit}</span>
      </p>
      <p className="mt-1 text-[11px] text-espresso-soft">{label}</p>
    </div>
  );
}
