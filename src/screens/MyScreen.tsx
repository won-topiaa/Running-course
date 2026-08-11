import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cloud,
  Lock,
  Download,
  Flame,
  Footprints,
  MessageSquare,
  Play,
  Plus,
  Timer,
  Trash2,
  Upload,
} from 'lucide-react';
import { estimateTimeLabel, formatPace } from '../lib/format';
import { computeRunStats, earnedBadges, levelLabel } from '../lib/runStats';
import { exportBackupFile, importBackupFile } from '../lib/backup';
import {
  cloudBackupMeta,
  loadCloudSession,
  pullCloud,
  pushCloud,
  isReconciled,
  localRunCount,
  signIn,
  signOut,
  signUp,
  type CloudConfig,
  type CloudSession,
} from '../lib/cloud';
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
    if (raw) {
      // 형태를 확인하고 넣는다. 깨진 값이 그대로 들어오면 목록을 그리다
      // 터지고, 그 값은 남아 있으니 새로고침해도 계속 같은 자리에서 터진다.
      const v = JSON.parse(raw);
      if (Array.isArray(v)) {
        return v.filter(
          (x): x is Shoe =>
            !!x &&
            typeof x === 'object' &&
            typeof x.id === 'string' &&
            typeof x.name === 'string' &&
            typeof x.km === 'number' &&
            Number.isFinite(x.km),
        );
      }
    }
  } catch {
    /* 무시 */
  }
  return [];
}

export default function MyScreen({ api }: { api: AppApi }) {
  const pace = api.settings.paceSecPerKm;
  const setPace = (v: number) => api.setSettings({ ...api.settings, paceSecPerKm: v });
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
    <div className="mx-auto w-full max-w-md px-4 pb-28 pt-[calc(env(safe-area-inset-top,0px)+1.25rem)]">
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
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-2.5 text-[13px] font-semibold text-ink shadow-warm active:scale-95"
          >
            <Play size={15} fill="#fff" /> 첫 러닝 시작하기
          </button>
        </div>
      ) : (
        <>
          {/* 이번 주 목표 — 목표는 ± 로 조절 */}
          <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
            {/* ± 는 보이는 원이 20px 이라 실측에서 중심 ±10px 을 벗어나면 탭이
                무시됐다. before 로 눌리는 영역만 36px 로 넓힌다 (모양은 그대로). */}
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-espresso">이번 주 러닝</span>
              <span className="flex items-center gap-1.5 text-[12.5px] text-espresso-muted">
                <b className="text-coral-600">{stats.weekKm.toFixed(1)}km</b> /
                <button
                  onClick={() => setGoal(-5)}
                  className="relative grid h-5 w-5 place-items-center rounded-full bg-tint font-bold active:scale-90 before:absolute before:-inset-2 before:content-['']"
                  aria-label="목표 줄이기"
                >
                  −
                </button>
                {goal}km
                <button
                  onClick={() => setGoal(5)}
                  className="relative grid h-5 w-5 place-items-center rounded-full bg-tint font-bold active:scale-90 before:absolute before:-inset-2 before:content-['']"
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
                      className={`w-full rounded-md ${w.km > 0 ? 'bg-coral' : 'bg-line'}`}
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
              value={
                stats.totalKm >= 100 ? String(Math.round(stats.totalKm)) : stats.totalKm.toFixed(1)
              }
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
            aria-label="신발 이름"
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
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral px-3.5 py-2 text-[12.5px] font-semibold text-ink active:scale-95"
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
          aria-label="목표 페이스"
          aria-valuetext={`1km당 ${formatPace(pace)}`}
        />
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { label: '5K', km: 5 },
            { label: '10K', km: 10 },
            { label: '하프', km: 21.0975 },
          ].map((d) => (
            <div key={d.label} className="rounded-2xl bg-tint/70 py-2.5">
              <p className="text-[11px] text-espresso-soft">{d.label}</p>
              <p className="text-[14px] font-bold text-espresso">{estimateTimeLabel(d.km, pace)}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-espresso-soft">
          이 페이스는 코스별 예상 소요 시간에도 함께 반영돼요.
        </p>
      </div>

      {/* 의견 보내기 — 베타에서 가장 중요한 길. 계정·백업보다 위에 둔다. */}
      <FeedbackSection api={api} />

      {/* 계정 — 이메일 로그인으로 기록을 계정에 보관 */}
      <CloudSection api={api} />

      {/* 파일 백업 — 로그인 없이 쓰는 안전망 */}
      <SyncSection />
    </div>
  );
}

/**
 * 베타 의견 보내기.
 *
 * 베타의 목적은 '무엇을 고쳐야 하는지 사람들이 알려주게 만드는 것'인데,
 * 보낼 길이 없으면 아무리 잘 써 봐도 그 정보가 안 돌아온다. 구글폼으로 보낸다.
 *
 * 화면·브라우저 같은 정보는 자동으로 못 붙인다(폼은 우리 페이지가 아니다).
 * 대신 버그 제보에 필요한 값들을 한 번에 복사할 수 있게 해 두고, 붙여넣기는
 * 사용자 선택에 맡긴다 — 묻지도 않고 기기 정보를 실어 보내지 않기 위해서다.
 */
const FEEDBACK_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSfTRlHLhAgnDQtQi8KM1KzAnefW4umgr7-XdN-vGg0rFs8Vrg/viewform';

function FeedbackSection({ api }: { api: AppApi }) {
  const [copied, setCopied] = useState(false);

  const diagnostics = () => {
    const ua = navigator.userAgent;
    const lines = [
      `화면 ${window.innerWidth}×${window.innerHeight}`,
      `브라우저 ${ua.slice(0, 120)}`,
      `기록 ${api.savedRoutes.length}건`,
      `지도 ${api.settings.kakaoJsKey ? '카카오' : 'OSM'}`,
      `날씨 ${api.conditions?.source ?? '없음'}`,
      `설치형 ${window.matchMedia('(display-mode: standalone)').matches ? '예' : '아니오'}`,
    ];
    return lines.join('\n');
  };

  const copyInfo = async () => {
    try {
      await navigator.clipboard.writeText(diagnostics());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-4 rounded-3xl border border-coral/40 bg-coral-50 p-4 shadow-soft">
      <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-coral-600">
        <MessageSquare size={16} /> 베타 의견 보내기
      </h2>
      <p className="mt-1.5 text-[12px] leading-relaxed text-espresso-muted">
        불편한 점, 이상한 화면, 있었으면 하는 기능 — 무엇이든 편하게 알려주세요. 짧게 한 줄이어도
        큰 도움이 됩니다.
      </p>
      <button
        onClick={() => window.open(FEEDBACK_FORM_URL, '_blank', 'noopener,noreferrer')}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-coral py-3 text-[14px] font-bold text-ink active:scale-[0.98]"
      >
        <MessageSquare size={15} /> 의견 보내기
      </button>
      <button
        onClick={copyInfo}
        /* 글자만 있는 줄이라 실제 높이가 17px 였다. 손가락으로 누르기엔 작아
           세로 여백으로 44px 까지 넓힌다 — 보이는 모습은 그대로다. */
        className="mt-1 w-full py-3.5 text-center text-[11.5px] font-semibold text-espresso-soft underline decoration-line underline-offset-4"
      >
        {copied ? '복사했어요 — 폼에 붙여넣어 주세요' : '버그 제보용 기기 정보 복사'}
      </button>
    </div>
  );
}

/** 계정 · 클라우드 동기화 — 이메일 로그인. 기록이 계정에 저장돼 기기가 바뀌어도 유지된다. */
function CloudSection({ api }: { api: AppApi }) {
  const cfg: CloudConfig | null =
    api.settings.supabaseUrl && api.settings.supabaseAnonKey
      ? { url: api.settings.supabaseUrl, anonKey: api.settings.supabaseAnonKey }
      : null;

  const [session, setSession] = useState(loadCloudSession());
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [remoteAt, setRemoteAt] = useState<string | null | undefined>(undefined);
  // 계정 기록과 기기 기록이 둘 다 있어 방향을 못 정한 상태. 정할 때까지 자동 백업은 멈춘다.
  const [conflict, setConflict] = useState(() => !!session && !isReconciled(session.userId));

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 4000);
  };

  // 로그인 상태면 서버 백업 시각 조회
  const refreshMeta = async (c: CloudConfig) => {
    try {
      const meta = await cloudBackupMeta(c);
      setRemoteAt(meta.updatedAt);
    } catch {
      setRemoteAt(undefined);
    }
  };
  useEffect(() => {
    if (cfg && session) void refreshMeta(cfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 로그인/가입 직후, 계정과 이 기기 중 어느 쪽 데이터를 남길지 정한다.
   * 새 기기에서 로그인하자마자 빈 상태를 올려 계정 백업을 지우는 사고를 막는 핵심 분기다.
   */
  const reconcile = async (c: CloudConfig, s: CloudSession) => {
    setSession(s);
    const meta = await cloudBackupMeta(c);
    setRemoteAt(meta.updatedAt);

    if (!meta.updatedAt) {
      // 계정이 비어 있다 → 이 기기 걸로 시작
      await pushCloud(c, { force: true });
      await refreshMeta(c);
      setConflict(false);
      flash('이 기기 기록을 계정에 올렸어요. 이제 자동으로 백업돼요.');
      return;
    }
    if (localRunCount() === 0) {
      // 기기가 비어 있다 → 새 기기로 보고 계정 기록을 가져온다
      const n = await pullCloud(c);
      setConflict(false);
      flash(`계정에서 ${n}개 항목을 불러왔어요. 새로고침합니다…`);
      setTimeout(() => location.reload(), 1200);
      return;
    }
    // 양쪽 다 있다 → 사용자가 고를 때까지 아무것도 덮어쓰지 않는다
    setConflict(true);
    flash('계정에도 기록이 있어요. 어느 쪽을 남길지 골라 주세요.');
  };

  const doAuth = async (mode: 'in' | 'up') => {
    if (!cfg) return;
    setBusy(true);
    try {
      if (mode === 'in') {
        await reconcile(cfg, await signIn(cfg, email.trim(), pw));
      } else {
        const r = await signUp(cfg, email.trim(), pw);
        if (r.needsConfirm) {
          flash('확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.');
        } else if (r.session) {
          await reconcile(cfg, r.session);
        }
      }
      setPw('');
    } catch (e) {
      flash(e instanceof Error ? e.message : '요청에 실패했어요.');
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    if (!cfg) return;
    setBusy(true);
    try {
      const n = await pullCloud(cfg);
      setConflict(false);
      flash(`${n}개 항목을 복원했어요. 새로고침합니다…`);
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      flash(e instanceof Error ? e.message : '복원에 실패했어요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
      <h2 className="inline-flex items-center gap-1.5 text-[14px] font-bold text-espresso">
        <Lock size={16} className="text-coral" /> 계정
      </h2>

      {!cfg ? (
        <p className="mt-1 text-[12px] leading-relaxed text-espresso-muted">
          이메일 로그인은 Supabase 프로젝트 연결 후 켜져요 (
          <code className="text-[10.5px]">server/supabase/README.md</code> 참고 · 5분). 그 전에는
          아래 <b className="text-espresso">데이터 이동</b>으로 옮길 수 있어요.
        </p>
      ) : session ? (
        <>
          <div className="mt-2 flex items-center justify-between rounded-2xl bg-sage-50 px-3.5 py-3">
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold text-sage-600">
                {session.email}
              </span>
              <span className="text-[11px] text-espresso-muted">
                {conflict
                  ? '자동 백업 멈춤 — 아래에서 방향을 골라 주세요'
                  : '기록이 계정에 자동 백업되고 있어요'}
                {remoteAt &&
                  ` · 마지막 ${new Date(remoteAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })}`}
              </span>
            </span>
            <button
              onClick={() => {
                signOut();
                setSession(null);
                flash('로그아웃했어요. 데이터는 이 기기와 계정에 그대로 있어요.');
              }}
              className="shrink-0 rounded-full border border-line bg-paper px-3 py-1.5 text-[11.5px] font-semibold text-espresso-muted active:scale-95"
            >
              로그아웃
            </button>
          </div>
          {conflict && (
            <p className="mt-2 rounded-2xl border border-coral/40 bg-coral-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-espresso">
              계정과 이 기기에 <b>둘 다 기록이 있어요.</b> 한쪽이 다른 쪽을 덮어쓰기 때문에, 고르기
              전까지 자동 백업을 멈춰 뒀어요. 이 기기 기록이 최신이면 <b>이 기기 걸로 덮어쓰기</b>,
              계정 쪽이 최신이면 <b>계정에서 가져오기</b>.
            </p>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              onClick={async () => {
                if (!cfg) return;
                setBusy(true);
                try {
                  await pushCloud(cfg, { force: true });
                  await refreshMeta(cfg);
                  setConflict(false);
                  flash('지금 상태를 백업했어요.');
                } catch (e) {
                  flash(e instanceof Error ? e.message : '백업에 실패했어요.');
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="rounded-full bg-coral py-2.5 text-[12.5px] font-semibold text-ink active:scale-95 disabled:opacity-60"
            >
              {conflict ? '이 기기 걸로 덮어쓰기' : '지금 백업'}
            </button>
            <button
              onClick={doRestore}
              disabled={busy || remoteAt === null}
              className="rounded-full bg-espresso py-2.5 text-[12.5px] font-semibold text-ink active:scale-95 disabled:opacity-60"
            >
              {conflict ? '계정에서 가져오기' : '계정에서 복원'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[12px] leading-relaxed text-espresso-muted">
            로그인하면 기록·설정이 계정에 자동 백업돼요. 기기를 바꿔도, 브라우저를 지워도 로그인만
            하면 그대로예요.
          </p>
          <div className="mt-2.5 space-y-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              placeholder="이메일"
              aria-label="이메일"
              className="w-full rounded-full border border-line bg-cream px-4 py-2.5 text-[13px] text-espresso outline-none focus:border-coral"
            />
            <input
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="비밀번호 (6자 이상)"
              aria-label="비밀번호"
              className="w-full rounded-full border border-line bg-cream px-4 py-2.5 text-[13px] text-espresso outline-none focus:border-coral"
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              onClick={() => doAuth('in')}
              disabled={busy || !email.trim() || pw.length < 6}
              className="rounded-full bg-coral py-2.5 text-[12.5px] font-bold text-ink active:scale-95 disabled:opacity-60"
            >
              로그인
            </button>
            <button
              onClick={() => doAuth('up')}
              disabled={busy || !email.trim() || pw.length < 6}
              className="rounded-full border border-coral py-2.5 text-[12.5px] font-bold text-coral-600 active:scale-95 disabled:opacity-60"
            >
              회원가입
            </button>
          </div>
        </>
      )}

      {msg && (
        <p className="mt-2.5 rounded-2xl bg-sage-50 px-3 py-2 text-[12px] text-sage-600">{msg}</p>
      )}
    </div>
  );
}

/** 데이터 이동 — 파일 백업(항상 동작) + 동기화 코드(sync-worker 배포 시) */
function SyncSection() {
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
      <h2 className="inline-flex items-center gap-1.5 text-[14px] font-bold text-espresso">
        <Cloud size={16} className="text-coral" /> 파일 백업
      </h2>
      <p className="mt-1 text-[12px] leading-relaxed text-espresso-muted">
        로그인 없이 쓰는 안전망이에요. 기록·설정을 파일로 내려받아 두거나, 다른 기기에서 가져올 수
        있어요.
      </p>
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

      {msg && (
        <p className="mt-2.5 rounded-2xl bg-sage-50 px-3 py-2 text-[12px] text-sage-600">{msg}</p>
      )}
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
