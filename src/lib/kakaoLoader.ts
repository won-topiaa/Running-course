// ---------------------------------------------------------------------------
// 카카오맵 JavaScript SDK 동적 로더
// autoload=false 로 불러온 뒤 kakao.maps.load 콜백에서 resolve.
// 스크립트 차단/실패/타임아웃 시 reject → 호출측은 Leaflet 로 폴백한다.
//
// 실패를 60초 동안 기억한다. 안 그러면 지도가 있는 화면으로 옮길 때마다
// 타임아웃을 처음부터 다시 기다려서, SDK 가 안 되는 환경(도메인 미등록·차단)
// 에서는 화면 전환마다 수 초씩 멈춘 것처럼 보인다.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    kakao?: any;
  }
}

// 이 시간 안에 못 뜨면 Leaflet 로 넘어간다. 폴백도 완전한 지도이므로
// 오래 기다리는 것보다 빨리 보여주는 쪽이 낫다.
const TIMEOUT_MS = 3500;
// 실패 기억 시간 — 지나면 다음 지도 화면에서 조용히 한 번 더 시도한다
const RETRY_AFTER_MS = 60_000;

let cached: Promise<any> | null = null;
let failedAt = 0;

export function loadKakao(appkey: string): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  // maps.load 콜백까지 끝났으면 Map 클래스가 존재한다
  if (window.kakao?.maps?.Map) return Promise.resolve(window.kakao);
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) {
    return Promise.reject(new Error('kakao sdk recently failed'));
  }
  if (cached) return cached;

  cached = new Promise((resolve, reject) => {
    let settled = false;
    const ok = (k: any) => {
      if (settled) return;
      settled = true;
      failedAt = 0;
      resolve(k);
    };
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      failedAt = Date.now();
      cached = null;
      // 죽은 스크립트를 치워야 재시도가 load 이벤트만 기다리다 또 타임아웃되지 않는다
      document.getElementById('kakao-sdk')?.remove();
      reject(new Error(msg));
    };

    const finish = () => {
      if (window.kakao?.maps?.load) {
        window.kakao.maps.load(() => ok(window.kakao));
      } else {
        fail('kakao.maps unavailable');
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
      s.onerror = () => fail('kakao sdk load failed');
      document.head.appendChild(s);
    }

    setTimeout(() => fail('kakao sdk timeout'), TIMEOUT_MS);
  });

  return cached;
}
