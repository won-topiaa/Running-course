import { useEffect, useState } from 'react';
import { Share, Smartphone, X } from 'lucide-react';

const DISMISS_KEY = 'run-app-install-dismissed-v1';

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true
  );
}

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * 홈화면 설치 안내.
 * - Android/Chrome: beforeinstallprompt 를 잡아 원터치 설치
 * - iOS Safari: 해당 이벤트가 없어 공유 → "홈 화면에 추가" 안내를 보여준다
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* 무시 */
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    // iOS 는 이벤트가 없으므로 잠시 뒤 안내만 노출
    let t: ReturnType<typeof setTimeout> | null = null;
    if (isIOS()) t = setTimeout(() => setShow(true), 2500);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* 무시 */
    }
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* 무시 */
    }
    dismiss();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[76px] z-[1200] flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-3xl border border-line bg-paper/95 p-3.5 shadow-card backdrop-blur">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-coral-50">
          <Smartphone size={19} className="text-coral" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-espresso">홈 화면에 추가하기</p>
          {deferred ? (
            <p className="text-[11.5px] leading-snug text-espresso-muted">
              앱처럼 열고 오프라인에서도 볼 수 있어요.
            </p>
          ) : (
            <p className="flex items-center gap-1 text-[11.5px] leading-snug text-espresso-muted">
              공유 <Share size={11} className="inline" /> → “홈 화면에 추가”를 누르세요.
            </p>
          )}
        </div>
        {deferred && (
          <button
            onClick={install}
            className="shrink-0 rounded-full bg-coral px-3.5 py-2 text-[12.5px] font-semibold text-ink shadow-warm active:scale-95"
          >
            설치
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label="닫기"
          className="shrink-0 rounded-full p-1.5 text-espresso-soft active:scale-90"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
