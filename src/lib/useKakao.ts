import { useEffect, useState } from 'react';
import { loadKakao } from './kakaoLoader';

export type KakaoStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/**
 * 카카오맵 SDK 로드 상태. key 가 없거나 로드 실패 시 Leaflet 로 폴백하도록 신호를 준다.
 *
 * SDK 가 이미 초기화돼 있으면(다른 화면에서 로드 완료) 첫 렌더부터 'ready' 로
 * 시작한다. effect 를 기다리면 화면을 옮길 때마다 로딩 플레이스홀더가 한 프레임
 * 깜빡인다.
 */
export function useKakao(key: string | null): { kakao: any; status: KakaoStatus } {
  const alreadyReady = !!(key && typeof window !== 'undefined' && window.kakao?.maps?.Map);
  const [status, setStatus] = useState<KakaoStatus>(
    alreadyReady ? 'ready' : key ? 'loading' : 'idle',
  );
  const [kakao, setKakao] = useState<any>(alreadyReady ? window.kakao : null);

  useEffect(() => {
    if (!key) {
      setStatus('idle');
      return;
    }
    if (window.kakao?.maps?.Map) {
      setKakao(window.kakao);
      setStatus('ready');
      return;
    }
    let alive = true;
    setStatus('loading');
    loadKakao(key)
      .then((k) => {
        if (!alive) return;
        setKakao(k);
        setStatus('ready');
      })
      .catch(() => alive && setStatus('unavailable'));
    return () => {
      alive = false;
    };
  }, [key]);

  return { kakao, status };
}
