// ---------------------------------------------------------------------------
// 최후의 안전망
//
// PWA 는 홈화면에 설치돼 있어서, 렌더 중에 한 번 터지면 사용자가 볼 수 있는 건
// 흰 화면뿐이다. 주소창도 개발자도구도 없고, 원인이 저장된 데이터라면 새로고침
// 해도 같은 자리에서 또 터진다 — 앱을 지우는 것 말고 할 수 있는 게 없다.
// 그래서 최소한 (1) 무슨 일이 났는지 알려주고 (2) 기록을 파일로 빼낼 길을 주고
// (3) 다시 시도할 수단을 준다.
// ---------------------------------------------------------------------------

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { exportBackupFile } from '../lib/backup';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 콘솔에 남겨 둔다 — 사용자가 개발자에게 전달할 수 있는 유일한 단서다
    console.error('[런코스] 화면 오류', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-full flex-col items-center justify-center bg-cream px-6 py-10 text-center">
        <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-espresso-soft">
          Something broke
        </p>
        <h1 className="mt-2 text-[22px] font-extrabold text-espresso">화면을 그리다 멈췄어요</h1>
        <p className="mt-2 max-w-[20rem] text-[13px] leading-relaxed text-espresso-muted">
          저장된 기록은 지워지지 않았어요. 다시 시도해도 같은 화면이 나오면, 아래에서 기록을 파일로
          내려받아 두고 앱을 새로 열어 주세요.
        </p>

        <button
          onClick={() => this.setState({ error: null })}
          className="mt-6 w-full max-w-[16rem] rounded-full bg-coral py-3.5 text-[14px] font-bold text-ink active:scale-[0.98]"
        >
          다시 시도
        </button>
        <button
          onClick={() => location.reload()}
          className="mt-2.5 w-full max-w-[16rem] rounded-full border border-line py-3.5 text-[13px] font-semibold text-espresso-muted active:scale-[0.98]"
        >
          앱 새로고침
        </button>
        <button
          onClick={() => {
            try {
              exportBackupFile();
            } catch {
              /* 내려받기까지 실패하면 더 해줄 게 없다 */
            }
          }}
          className="mt-2.5 text-[12.5px] font-semibold text-espresso-soft underline decoration-line underline-offset-4"
        >
          기록 백업 파일 내려받기
        </button>

        <pre className="mt-6 max-h-32 w-full max-w-[22rem] overflow-auto rounded-2xl bg-tint p-3 text-left text-[10.5px] leading-relaxed text-espresso-soft">
          {String(error?.message || error)}
        </pre>
      </div>
    );
  }
}
