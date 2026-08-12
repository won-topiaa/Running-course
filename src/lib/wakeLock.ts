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
  let acquiring = false;

  let retryTimer: ReturnType<typeof setInterval> | null = null;

  const acquire = async () => {
    if (!wanted || !wakeLockSupported() || sentinel || acquiring) return;
    acquiring = true;
    try {
      sentinel = await (navigator as any).wakeLock.request('screen');
      sentinel?.addEventListener?.('release', () => {
        sentinel = null;
        // 시스템이 락을 뺏는 경우가 있다(알림 표시, 절전 모드 진입, 잠깐의
        // 백그라운드 등). 예전엔 여기서 표시만 지우고 다시 안 잡아서, 한 번
        // 뺏기면 러닝 내내 화면이 꺼지는 상태로 남았다. 화면이 보이는 중이면
        // 바로 다시 잡는다.
        if (wanted && document.visibilityState === 'visible') void acquire();
      });
    } catch {
      sentinel = null;
    } finally {
      acquiring = false;
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
      // release 이벤트가 안 오는 브라우저도 있어, 주기적으로도 확인한다.
      // 이미 잡혀 있으면 acquire 가 즉시 반환하므로 비용은 없다.
      retryTimer = setInterval(() => void acquire(), 15_000);
      await acquire();
    },
    async disable() {
      wanted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
      }
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
