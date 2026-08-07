// ---------------------------------------------------------------------------
// 클라우드 계정 동기화 — Supabase (이메일 로그인 + Postgres 백업)
//
// SDK 없이 REST 로 직접 붙는다 (번들 가볍게, 의존성 없음):
//   - 인증:   GoTrue   {url}/auth/v1/*   (회원가입 / 로그인 / 토큰 갱신)
//   - 저장:   PostgREST {url}/rest/v1/backups  (사용자당 1행, RLS 로 본인만 접근)
//
// anon key 는 공개용으로 설계된 키다(카카오 JS 키처럼). 데이터 보호는 RLS 가 담당한다.
// 테이블 스키마는 server/supabase/README.md 참고.
// ---------------------------------------------------------------------------

import { applyBackup, collectBackup } from './backup';

const SESSION_KEY = 'run-app-cloud-session-v1';
// 이 기기가 "계정 데이터와 기기 데이터 중 무엇을 남길지" 한 번 정리했는지 표시한다.
// 값은 정리를 마친 userId. 이게 없으면 자동 백업은 멈춰 있는다 — 새 기기에서
// 로그인하자마자 빈 상태가 계정 백업을 덮어쓰는 사고를 막는 잠금장치다.
const SYNCED_KEY = 'run-app-cloud-synced-v1';
const ROUTES_KEY = 'run-app-routes-v1';

export interface CloudConfig {
  url: string; //     https://xxxx.supabase.co
  anonKey: string;
}

export interface CloudSession {
  access: string;
  refresh: string;
  expiresAt: number; // epoch seconds
  userId: string;
  email: string;
}

/**
 * 프로젝트 루트 URL 로 정규화한다.
 * Supabase 대시보드는 Data API 주소를 `https://xxx.supabase.co/rest/v1/` 형태로 보여주므로
 * 사용자가 그대로 붙여넣는 경우가 많다. 뒤에 붙은 API 경로와 슬래시를 걷어낸다.
 */
const trim = (u: string) =>
  u
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(rest|auth|storage|realtime)\/v1$/, '');

/** 이 기기가 해당 계정과 데이터 방향을 정리했는가 */
export function isReconciled(userId: string): boolean {
  try {
    return localStorage.getItem(SYNCED_KEY) === userId;
  } catch {
    return false;
  }
}

function markReconciled(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(SYNCED_KEY, userId);
    else localStorage.removeItem(SYNCED_KEY);
  } catch {
    /* 무시 */
  }
}

/** 이 기기에 쌓인 러닝 기록 수 — 비었으면 "새 기기"로 보고 계정 쪽을 가져온다 */
export function localRunCount(): number {
  try {
    const raw = localStorage.getItem(ROUTES_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

export function loadCloudSession(): CloudSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw) as CloudSession;
  } catch {
    /* 무시 */
  }
  return null;
}

function saveCloudSession(s: CloudSession | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 무시 */
  }
}

function authHeaders(cfg: CloudConfig): Record<string, string> {
  return { apikey: cfg.anonKey, 'Content-Type': 'application/json' };
}

async function authError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  const raw: string =
    body?.error_description || body?.msg || body?.message || body?.error || `오류 (${res.status})`;
  // 자주 만나는 영어 메시지만 우리말로
  if (/invalid login credentials/i.test(raw)) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (/already registered/i.test(raw)) return '이미 가입된 이메일이에요. 로그인해 주세요.';
  if (/at least 6 characters/i.test(raw)) return '비밀번호는 6자 이상이어야 해요.';
  // Supabase 는 example.com 같은 일회성·예약 도메인을 거절한다
  if (/email_address_invalid|is invalid/i.test(raw) || /valid email/i.test(raw)) {
    return '이 이메일 주소는 쓸 수 없어요. 실제로 받을 수 있는 주소를 넣어 주세요.';
  }
  if (/email not confirmed/i.test(raw)) {
    return '메일함에서 확인 링크를 먼저 눌러 주세요.';
  }
  if (/rate limit/i.test(raw)) return '요청이 잦아요. 잠시 후 다시 시도해 주세요.';
  return raw;
}

function toSession(t: any): CloudSession {
  return {
    access: t.access_token,
    refresh: t.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (t.expires_in ?? 3600),
    userId: t.user?.id ?? '',
    email: t.user?.email ?? '',
  };
}

/** 회원가입. 이메일 확인이 켜진 프로젝트면 세션 없이 needsConfirm 을 돌려준다. */
export async function signUp(
  cfg: CloudConfig,
  email: string,
  password: string,
): Promise<{ session: CloudSession | null; needsConfirm: boolean }> {
  const res = await fetch(`${trim(cfg.url)}/auth/v1/signup`, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await authError(res));
  const body = await res.json();
  if (body?.access_token) {
    const s = toSession(body);
    saveCloudSession(s);
    return { session: s, needsConfirm: false };
  }
  return { session: null, needsConfirm: true };
}

export async function signIn(
  cfg: CloudConfig,
  email: string,
  password: string,
): Promise<CloudSession> {
  const res = await fetch(`${trim(cfg.url)}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await authError(res));
  const s = toSession(await res.json());
  saveCloudSession(s);
  return s;
}

export function signOut(): void {
  saveCloudSession(null);
  markReconciled(null);
}

/** 만료 임박 시 리프레시. 갱신 실패면 세션을 지우고 null (재로그인 필요). */
export async function ensureCloudFresh(cfg: CloudConfig): Promise<CloudSession | null> {
  const s = loadCloudSession();
  if (!s) return null;
  if (s.expiresAt > Math.floor(Date.now() / 1000) + 60) return s;
  const res = await fetch(`${trim(cfg.url)}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify({ refresh_token: s.refresh }),
  });
  if (!res.ok) {
    saveCloudSession(null);
    return null;
  }
  const next = toSession(await res.json());
  if (!next.email) next.email = s.email;
  if (!next.userId) next.userId = s.userId;
  saveCloudSession(next);
  return next;
}

/** PostgREST 오류를 사람이 읽을 수 있는 문장으로 */
async function restError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}) as any);
  const msg: string = body?.message || body?.hint || '';
  // 테이블을 아직 안 만든 경우가 가장 흔하다
  if (res.status === 404 || /relation .* does not exist|schema cache/i.test(msg)) {
    return 'backups 테이블이 없어요. Supabase SQL Editor 에서 설정 SQL 을 먼저 실행해 주세요.';
  }
  if (res.status === 401 || res.status === 403) {
    return '접근 권한이 없어요. 로그인 상태와 RLS 정책을 확인해 주세요.';
  }
  return msg ? `${fallback}: ${msg}` : `${fallback} (${res.status})`;
}

/**
 * 이 기기의 데이터를 계정에 백업 (사용자당 1행 upsert).
 *
 * `force` 없이 부르면 정리(reconcile)를 마친 기기에서만 올린다. 자동 백업이 이 경로를
 * 쓰기 때문에, 로그인 직후의 빈 기기가 계정 백업을 지워버리는 일이 생기지 않는다.
 * 사용자가 "이 기기 걸로 덮어쓰기"를 직접 누른 경우에만 force 로 통과시킨다.
 */
export async function pushCloud(cfg: CloudConfig, opts?: { force?: boolean }): Promise<void> {
  const s = await ensureCloudFresh(cfg);
  if (!s) throw new Error('로그인이 풀렸어요. 다시 로그인해 주세요.');
  if (!opts?.force && !isReconciled(s.userId)) {
    throw new Error('계정 기록과 이 기기 기록 중 무엇을 남길지 먼저 골라 주세요.');
  }
  const res = await fetch(`${trim(cfg.url)}/rest/v1/backups`, {
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      Authorization: `Bearer ${s.access}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([
      { user_id: s.userId, data: collectBackup(), updated_at: new Date().toISOString() },
    ]),
  });
  if (!res.ok) throw new Error(await restError(res, '백업 실패'));
  markReconciled(s.userId);
}

export interface CloudBackupMeta {
  updatedAt: string | null; // ISO — null 이면 서버에 백업 없음
}

export async function cloudBackupMeta(cfg: CloudConfig): Promise<CloudBackupMeta> {
  const s = await ensureCloudFresh(cfg);
  if (!s) throw new Error('로그인이 필요해요.');
  const res = await fetch(
    `${trim(cfg.url)}/rest/v1/backups?select=updated_at&user_id=eq.${s.userId}`,
    { headers: { ...authHeaders(cfg), Authorization: `Bearer ${s.access}` } },
  );
  if (!res.ok) throw new Error(await restError(res, '조회 실패'));
  const rows = await res.json();
  return { updatedAt: rows?.[0]?.updated_at ?? null };
}

/** 계정 백업을 이 기기에 복원. 적용한 항목 수 반환. */
export async function pullCloud(cfg: CloudConfig): Promise<number> {
  const s = await ensureCloudFresh(cfg);
  if (!s) throw new Error('로그인이 필요해요.');
  const res = await fetch(
    `${trim(cfg.url)}/rest/v1/backups?select=data&user_id=eq.${s.userId}`,
    { headers: { ...authHeaders(cfg), Authorization: `Bearer ${s.access}` } },
  );
  if (!res.ok) throw new Error(await restError(res, '가져오기 실패'));
  const rows = await res.json();
  if (!rows?.[0]?.data) throw new Error('이 계정에 저장된 백업이 아직 없어요.');
  const n = applyBackup(rows[0].data);
  markReconciled(s.userId);
  return n;
}
