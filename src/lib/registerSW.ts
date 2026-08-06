// 서비스 워커 등록 — 프로덕션 빌드에서만 (개발 중에는 HMR 방해하지 않도록 해제)
export function registerSW(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // base 가 './' 이므로 문서 기준 상대 경로로 등록 → 하위 경로 배포에서도 스코프가 맞는다
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 등록 실패해도 앱은 정상 동작 */
    });
  });
}
