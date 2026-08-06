// ---------------------------------------------------------------------------
// Screen Wake Lock — 러닝 기록 중 화면이 꺼지지 않게 유지
// 지원하지 않는 브라우저(iOS Safari 구버전 등)에서는 조용히 무시된다.
// 탭이 백그라운드로 갔다 오면 락이 해제되므로 재획득이 필요하다.
// ---------------------------------------------------------------------------

// WakeLockSentinel 타입이 없는 TS lib 환경도 있어 느슨하게 둔다
type Sentinel = any | null;

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

/**
 * 화면 유지 락을 관리하는 핸들을 만든다.
 * enable() 로 켜고 disable() 로 끄며, 탭 복귀 시 자동으로 다시 잡는다.
 */
export function createWakeLock() {
  let sentinel: Sentinel = null;
  let wanted = false;

  const acquire = async () => {
    if (!wanted || !wakeLockSupported() || sentinel) return;
    try {
      sentinel = await (navigator as any).wakeLock.request('screen');
      sentinel?.addEventListener?.('release', () => {
        sentinel = null;
      });
    } catch {
      // 사용자 제스처 없이 요청하거나 배터리 절약 모드면 실패할 수 있다 — 무시
      sentinel = null;
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') void acquire();
  };

  return {
    async enable() {
      if (wanted) return;
      wanted = true;
      document.addEventListener('visibilitychange', onVisibility);
      await acquire();
    },
    async disable() {
      wanted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      const s = sentinel;
      sentinel = null;
      try {
        await s?.release();
      } catch {
        /* 무시 */
      }
    },
    get active() {
      return !!sentinel;
    },
  };
}
