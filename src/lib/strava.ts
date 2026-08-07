// ---------------------------------------------------------------------------
// Strava 연동 (앱 측)
//
// 두 가지 경로를 지원한다:
//  1) Worker 미연결 — GPX 내보내기 + Strava 업로드 페이지 열기 (즉시 사용 가능)
//  2) Worker 연결   — 버튼 한 번으로 자동 업로드 (server/strava-worker 배포 필요)
// 토큰은 브라우저 localStorage 에 저장하고, 만료 시 Worker 를 통해 갱신한다.
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'run-app-strava-token-v1';

export interface StravaToken {
  access: string;
  refresh: string;
  expiresAt: number; // epoch seconds
  athlete?: string;
}

export function loadToken(): StravaToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (raw) return JSON.parse(raw) as StravaToken;
  } catch {
    /* 무시 */
  }
  return null;
}

function saveToken(t: StravaToken | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 무시 */
  }
}

const trim = (base: string) => base.replace(/\/+$/, '');

/** OAuth 복귀 시 URL 해시에서 토큰을 회수 (성공하면 해시를 지운다) */
export function captureTokenFromHash(): StravaToken | null {
  const h = location.hash.replace(/^#/, '');
  if (!h.includes('strava_access')) return null;
  const p = new URLSearchParams(h);
  const access = p.get('strava_access');
  if (!access) return null;
  const token: StravaToken = {
    access,
    refresh: p.get('strava_refresh') ?? '',
    expiresAt: Number(p.get('strava_expires') ?? 0),
    athlete: p.get('strava_athlete') || undefined,
  };
  saveToken(token);
  history.replaceState(null, '', location.pathname + location.search);
  return token;
}

/** 만료가 임박하면 갱신해서 유효한 액세스 토큰을 돌려준다 */
export async function ensureFresh(
  workerUrl: string,
  token: StravaToken,
): Promise<StravaToken> {
  const now = Math.floor(Date.now() / 1000);
  if (token.expiresAt > now + 60) return token;
  const res = await fetch(`${trim(workerUrl)}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: token.refresh }),
  });
  if (!res.ok) throw new Error('토큰 갱신에 실패했어요. 다시 연결해 주세요.');
  const t = await res.json();
  const next: StravaToken = {
    access: t.access_token,
    refresh: t.refresh_token ?? token.refresh,
    expiresAt: t.expires_at ?? 0,
    athlete: token.athlete,
  };
  saveToken(next);
  return next;
}

/** GPX 를 Strava 로 업로드 (Worker 중계) */
export async function uploadGpx(opts: {
  workerUrl: string;
  token: StravaToken;
  name: string;
  gpx: string;
}): Promise<{ uploadId: number }> {
  const token = await ensureFresh(opts.workerUrl, opts.token);
  const form = new FormData();
  form.append('file', new Blob([opts.gpx], { type: 'application/gpx+xml' }), 'run.gpx');
  form.append('filename', `${opts.name}.gpx`);
  form.append('name', opts.name);

  const res = await fetch(`${trim(opts.workerUrl)}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || body?.message || '업로드에 실패했어요.');
  }
  return { uploadId: body.id };
}

/** 수동 경로 — Strava 업로드 페이지 */
export const STRAVA_UPLOAD_PAGE = 'https://www.strava.com/upload/select';
