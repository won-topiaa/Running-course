// ---------------------------------------------------------------------------
// 런코스 서비스 워커 — 앱 셸 오프라인 캐시
//
// 전략
//  - 내비게이션(HTML): 네트워크 우선이되 2초까지만 — 캐시가 있으면 그걸 먼저
//    보여주고 네트워크 응답은 백그라운드에서 캐시를 갱신한다. 제한 없이
//    기다리면 느린 회선에서 캐시된 앱을 두고도 매번 하염없이 기다리게 된다.
//  - 같은 오리진 정적 자산(해시 파일명): 캐시 우선 + 백그라운드 갱신
//  - 외부 API(지도 타일·ORS·날씨): 캐시하지 않음 (항상 네트워크)
// 빌드마다 CACHE 버전을 올리지 않아도 해시 파일명 덕분에 안전하다.
// ---------------------------------------------------------------------------

const CACHE = 'runcourse-v2';
const SHELL = ['./manifest.webmanifest', './icon-192.png'];

// 설치 시점에 index.html 이 참조하는 해시 자산(js·css)까지 함께 캐시한다.
// 이게 없으면 첫 방문 때 메인 청크가 서비스워커의 통제가 시작되기 전에
// 로드돼 캐시에 안 담기고, 그 상태로 오프라인이 되면 재로드 시 그 청크를
// 못 찾아 앱이 아예 안 뜬다(빈 화면). index.html 을 한 번 받아 자산 경로를
// 뽑아 미리 담아 두면, 첫 방문 직후부터 오프라인이 가능해진다.
async function precache() {
  const cache = await caches.open(CACHE);
  let assets = [];
  try {
    const res = await fetch('./index.html', { cache: 'no-cache' });
    if (res.ok) {
      await cache.put('./index.html', res.clone());
      await cache.put('./', res.clone());
      const html = await res.text();
      assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
    }
  } catch {
    /* 오프라인 설치 등 — 아래에서 담을 수 있는 것만 담는다 */
  }
  // 개별 실패가 설치 전체를 막지 않도록 하나씩 담는다
  await Promise.all([...SHELL, ...assets].map((u) => cache.add(u).catch(() => undefined)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 캐시가 있을 때 네트워크를 기다려주는 최대 시간.
// GitHub Pages 는 정상이면 수백 ms 안에 응답한다 — 이걸 넘기면 회선이 느린
// 것이므로 캐시로 먼저 열고, 새 버전은 다음 방문에 반영된다.
const NAV_TIMEOUT_MS = 2000;

/**
 * 반환: { response, background }
 * background(캐시 갱신)는 호출측이 event.waitUntil 로 붙잡는다.
 * 주의 — waitUntil 은 fetch 핸들러의 동기 구간에서 불러야 한다. await 뒤에
 * 부르면 이벤트 디스패치가 끝난 상태라 InvalidStateError 로 핸들러 전체가
 * 죽고, 브라우저는 SW 를 건너뛰고 네트워크로 재요청한다(두 배로 느려진다).
 */
function serveNavigation(req) {
  const fresh = fetch(req);
  const background = fresh
    .then(async (res) => {
      if (res && res.ok) {
        const cache = await caches.open(CACHE);
        await cache.put('./index.html', res.clone());
      }
    })
    .catch(() => undefined);

  const response = (async () => {
    const cache = await caches.open(CACHE);
    const cached = (await cache.match('./index.html')) || (await cache.match('./'));
    // 첫 방문(캐시 없음)은 네트워크가 유일한 소스
    if (!cached) return fresh;
    const winner = await Promise.race([
      fresh.then((res) => (res && res.ok ? res : null)).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS)),
    ]);
    // 네트워크가 이기면 clone 을 돌려준다 — 본문은 background 쪽에서도 읽는다
    return winner ? winner.clone() : cached;
  })();

  return { response, background };
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 외부 도메인(지도 SDK·타일·API)은 그대로 통과
  if (url.origin !== self.location.origin) return;

  // HTML 내비게이션 — 네트워크 우선 + 시간 제한
  if (req.mode === 'navigate') {
    const nav = serveNavigation(req);
    event.respondWith(nav.response);
    event.waitUntil(nav.background);
    return;
  }

  // 정적 자산 — 캐시 우선, 없으면 네트워크 후 캐시
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        // 오프라인이고 캐시에도 없으면 돌려줄 게 없다. undefined 를 그대로
        // respondWith 에 넘기면 '값을 Response 로 못 바꾼다'며 핸들러가 터지므로,
        // 평범한 네트워크 오류로 응답해 호출측 catch 로 정상적으로 흘려보낸다.
        .catch(() => cached || Response.error());
      return cached || network;
    }),
  );
});
