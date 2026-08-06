/**
 * 런코스 — 기기 동기화 Worker (Cloudflare Workers + KV)
 *
 * 로그인 없이 '동기화 코드' 하나로 데이터를 올리고 내려받는 초경량 서버.
 *   PUT /sync/:code  본문(JSON 백업)을 저장 (90일 보관, 최대 2MB)
 *   GET /sync/:code  저장된 백업을 반환
 *
 * 보안 모델: 코드가 곧 열쇠다. 10자 무작위 코드(31^10 ≈ 8×10^14)라 추측이 사실상
 * 불가능하지만, 코드를 아는 사람은 누구나 읽을 수 있으므로 코드는 비밀번호처럼 다룰 것.
 *
 * 배포:
 *   npx wrangler kv namespace create SYNC   # 나온 id 를 wrangler.toml 에 기입
 *   npx wrangler deploy
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const TTL_SECONDS = 90 * 24 * 60 * 60; // 90일
const CODE_RE = /^[a-z0-9]{8,32}$/;

function cors(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = allowed.length === 0 || allowed.includes(origin) ? origin || '*' : 'null';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export default {
  async fetch(request, env) {
    const headers = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const m = new URL(request.url).pathname.match(/^\/sync\/([^/]+)$/);
    if (!m) return json({ error: 'not found' }, 404, headers);
    const code = m[1];
    if (!CODE_RE.test(code)) return json({ error: 'invalid code' }, 400, headers);

    if (request.method === 'PUT') {
      const body = await request.text();
      if (body.length > MAX_BYTES) return json({ error: 'too large (2MB)' }, 413, headers);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return json({ error: 'invalid json' }, 400, headers);
      }
      if (parsed?.app !== 'runcourse') return json({ error: 'not a runcourse backup' }, 400, headers);
      await env.SYNC.put(code, body, { expirationTtl: TTL_SECONDS });
      return json({ ok: true }, 200, headers);
    }

    if (request.method === 'GET') {
      const stored = await env.SYNC.get(code);
      if (stored == null) return json({ error: 'not found' }, 404, headers);
      return new Response(stored, {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    return json({ error: 'method not allowed' }, 405, headers);
  },
};
