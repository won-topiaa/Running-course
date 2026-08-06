import { useEffect, useState } from 'react';
import { loadKakao } from './kakaoLoader';

export type KakaoStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/** 카카오맵 SDK 로드 상태. key 가 없거나 로드 실패 시 Leaflet 로 폴백하도록 신호를 준다. */
export function useKakao(key: string | null): { kakao: any; status: KakaoStatus } {
  const [status, setStatus] = useState<KakaoStatus>(key ? 'loading' : 'idle');
  const [kakao, setKakao] = useState<any>(null);

  useEffect(() => {
    if (!key) {
      setStatus('idle');
      return;
    }
    let alive = true;
    setStatus(window.kakao?.maps ? 'ready' : 'loading');
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
