// ---------------------------------------------------------------------------
// 카카오맵 JavaScript SDK 동적 로더
// autoload=false 로 불러온 뒤 kakao.maps.load 콜백에서 resolve.
// 스크립트 차단/실패/타임아웃 시 reject → 호출측은 Leaflet 로 폴백한다.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    kakao?: any;
  }
}

let cached: Promise<any> | null = null;

export function loadKakao(appkey: string): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.kakao?.maps) return Promise.resolve(window.kakao);
  if (cached) return cached;

  cached = new Promise((resolve, reject) => {
    const finish = () => {
      if (window.kakao?.maps?.load) {
        window.kakao.maps.load(() => resolve(window.kakao));
      } else {
        cached = null;
        reject(new Error('kakao.maps unavailable'));
      }
    };

    const existing = document.getElementById('kakao-sdk') as HTMLScriptElement | null;
    if (existing) {
      if (window.kakao?.maps) finish();
      else existing.addEventListener('load', finish, { once: true });
    } else {
      const s = document.createElement('script');
      s.id = 'kakao-sdk';
      s.async = true;
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appkey}&autoload=false&libraries=services`;
      s.onload = finish;
      s.onerror = () => {
        cached = null;
        reject(new Error('kakao sdk load failed'));
      };
      document.head.appendChild(s);
    }

    // 차단 환경 대비 타임아웃 (이미 resolve/reject 되면 무시됨)
    setTimeout(() => reject(new Error('kakao sdk timeout')), 8000);
  });

  return cached;
}
