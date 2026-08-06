// ---------------------------------------------------------------------------
// 런코스 서비스 워커 — 앱 셸 오프라인 캐시
//
// 전략
//  - 내비게이션(HTML): 네트워크 우선 → 실패 시 캐시 (새 배포를 바로 반영)
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 외부 도메인(지도 SDK·타일·API)은 그대로 통과
  if (url.origin !== self.location.origin) return;

  // HTML 내비게이션 — 네트워크 우선
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
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
