/**
 * 런코스 — Strava 연동 Worker (Cloudflare Workers)
 *
 * 브라우저 전용 앱은 client_secret 을 가질 수 없고, Strava API 는 브라우저에서
 * 직접 호출할 수 없다(CORS). 이 Worker 가 그 사이를 중계한다.
 *
 * 라우트
 *   GET  /auth?redirect=<앱 URL>   → Strava 동의 화면으로 리다이렉트
 *   GET  /callback?code=..&state=. → 토큰 교환 후 앱으로 되돌려보냄(#strava=...)
 *   POST /refresh                  → 리프레시 토큰으로 액세스 토큰 갱신
 *   POST /upload                   → GPX 업로드 중계 (Authorization: Bearer <token>)
 *   GET  /status?id=<uploadId>     → 업로드 처리 상태 조회
 *
 * 필요한 시크릿 (wrangler secret put)
 *   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
 * 선택 환경변수
 *   ALLOWED_ORIGINS  쉼표로 구분한 허용 오리진 (미설정 시 모두 허용)
 */

const STRAVA_OAUTH = 'https://www.strava.com/oauth/token';
const STRAVA_AUTHORIZE = 'https://www.strava.com/oauth/authorize';
const STRAVA_API = 'https://www.strava.com/api/v3';
const SCOPE = 'activity:write,activity:read';

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = allowed.length === 0 || allowed.includes(origin) ? origin || '*' : '';
  return {
    'Access-Control-Allow-Origin': allow || 'null',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** state 로 넘긴 앱 URL 이 허용 목록에 있는지 확인 (오픈 리다이렉트 방지) */
function safeRedirect(target, env) {
  if (!target) return null;
  let url;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(url.origin)) return null;
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
  return url.toString();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // 1) 동의 화면으로 보내기
    if (url.pathname === '/auth') {
      const back = safeRedirect(url.searchParams.get('redirect'), env);
      if (!back) return json({ error: 'invalid redirect' }, 400, cors);
      const params = new URLSearchParams({
        client_id: env.STRAVA_CLIENT_ID,
        response_type: 'code',
        redirect_uri: `${url.origin}/callback`,
        approval_prompt: 'auto',
        scope: SCOPE,
        state: back,
      });
      return Response.redirect(`${STRAVA_AUTHORIZE}?${params}`, 302);
    }

    // 2) 콜백 — 코드 교환 후 앱으로 복귀
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const back = safeRedirect(url.searchParams.get('state'), env);
      if (!code || !back) return json({ error: 'missing code/state' }, 400, cors);

      const res = await fetch(STRAVA_OAUTH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.STRAVA_CLIENT_ID,
          client_secret: env.STRAVA_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
        }),
      });
      if (!res.ok) return json({ error: 'token exchange failed' }, 502, cors);
      const t = await res.json();

      const hash = new URLSearchParams({
        strava_access: t.access_token || '',
        strava_refresh: t.refresh_token || '',
        strava_expires: String(t.expires_at || 0),
        strava_athlete: t.athlete?.firstname || '',
      });
      return Response.redirect(`${back}#${hash}`, 302);
    }

    // 3) 토큰 갱신
    if (url.pathname === '/refresh' && request.method === 'POST') {
      const { refresh_token } = await request.json().catch(() => ({}));
      if (!refresh_token) return json({ error: 'missing refresh_token' }, 400, cors);
      const res = await fetch(STRAVA_OAUTH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.STRAVA_CLIENT_ID,
          client_secret: env.STRAVA_CLIENT_SECRET,
          refresh_token,
          grant_type: 'refresh_token',
        }),
      });
      const t = await res.json();
      return json(t, res.ok ? 200 : 502, cors);
    }

    // 4) GPX 업로드 중계
    if (url.pathname === '/upload' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      if (!auth.startsWith('Bearer ')) return json({ error: 'missing token' }, 401, cors);

      const inForm = await request.formData();
      const file = inForm.get('file');
      if (!file) return json({ error: 'missing file' }, 400, cors);

      const out = new FormData();
      out.append('file', file, inForm.get('filename') || 'run.gpx');
      out.append('data_type', 'gpx');
      out.append('name', inForm.get('name') || '런코스 러닝');
      out.append('description', inForm.get('description') || '런코스에서 기록한 러닝');
      out.append('activity_type', 'run');

      const res = await fetch(`${STRAVA_API}/uploads`, {
        method: 'POST',
        headers: { Authorization: auth },
        body: out,
      });
      const body = await res.json().catch(() => ({}));
      return json(body, res.status, cors);
    }

    // 5) 업로드 상태 조회 (Strava 는 비동기 처리)
    if (url.pathname === '/status') {
      const auth = request.headers.get('Authorization') || '';
      const id = url.searchParams.get('id');
      if (!auth.startsWith('Bearer ') || !id) {
        return json({ error: 'missing token/id' }, 400, cors);
      }
      const res = await fetch(`${STRAVA_API}/uploads/${id}`, {
        headers: { Authorization: auth },
      });
      const body = await res.json().catch(() => ({}));
      return json(body, res.status, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  },
};
