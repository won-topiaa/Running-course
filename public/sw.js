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

const CACHE = 'runcourse-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => undefined) // 일부 실패해도 설치는 진행
      .then(() => self.skipWaiting()),
  );
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
        .catch(() => cached);
      return cached || network;
    }),
  );
});
