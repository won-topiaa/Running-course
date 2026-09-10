// ---------------------------------------------------------------------------
// '내 위치' 한 번 잡기
//
// getCurrentPosition 을 그냥 부르면 안 되는 이유가 두 가지 있다.
//
// 1) 첫 응답은 거의 늘 거칠다. enableHighAccuracy 를 켜도 브라우저는 위성이
//    잡히기 전에 우선 기지국·와이파이·IP 로 추정한 좌표를 돌려준다. 그 오차는
//    실내에서 수백 m, IP 기반이면 수 km 다. getCurrentPosition 은 그 첫 응답을
//    주고 끝내므로, 사용자는 자기가 있는 곳에서 몇 km 떨어진 핀을 보게 된다.
//    watchPosition 으로 받아 두면 위성이 잡히는 대로 더 정확한 좌표가 이어서
//    들어온다 — 좋아질 때까지 잠깐 기다렸다가 가장 나은 것을 쓴다.
//
// 2) maximumAge 를 크게 두면 그 거친 좌표가 캐시에서 즉시 나온다. 버튼은
//    빠릿하게 반응하는데 위치는 틀린, 가장 나쁜 조합이다. 사용자가 '내 위치'를
//    누른 건 '지금 내가 있는 곳' 을 원한 것이므로 캐시를 쓰지 않는다.
//
// 기록 화면(gpsFilter)은 오차 50m 를 넘는 측위를 버린다. 여기서도 같은 기준을
// '충분히 좋음' 으로 삼되, 시간 안에 거기 못 닿으면 그때까지 중 가장 나은 것을
// 돌려주고 precise:false 로 알린다 — 아무것도 안 주는 것보다는 낫고, 화면은
// 그 사실을 사용자에게 말할 수 있다.
// ---------------------------------------------------------------------------

import type { LatLng } from './types';

/** 이 정도면 더 안 기다리고 바로 쓴다 (gpsFilter 의 MAX_ACCURACY_M 과 같은 기준) */
export const GOOD_ENOUGH_M = 50;
/** 이보다 나쁘면 화면이 '대략 위치' 라고 일러 준다 */
export const COARSE_M = 200;
/** 이 시간 안에 GOOD_ENOUGH_M 에 못 닿으면 그때까지 중 최선을 쓴다 */
export const MAX_WAIT_MS = 12_000;

export interface LocateResult {
  coords: LatLng;
  /** 오차 반경(m). 브라우저가 안 주면 null */
  accuracyM: number | null;
  /** GOOD_ENOUGH_M 안에 들어왔나. false 면 '그때까지 중 최선' 이다 */
  precise: boolean;
}

export type LocateErrorKind = 'unsupported' | 'denied' | 'timeout' | 'unavailable';

export class LocateError extends Error {
  constructor(readonly kind: LocateErrorKind) {
    super(kind);
    this.name = 'LocateError';
  }
}

/** 화면에 그대로 띄울 수 있는 안내 문구 */
export function locateErrorMessage(kind: LocateErrorKind): string {
  switch (kind) {
    case 'unsupported':
      return '이 기기에서 위치를 쓸 수 없어요. 지도를 눌러 시작점을 정해주세요.';
    case 'denied':
      return '위치 권한이 꺼져 있어요. 브라우저 주소창의 위치 아이콘에서 허용하거나, 지도를 눌러 시작점을 정해주세요.';
    case 'timeout':
      return '위치를 찾는 데 시간이 오래 걸려요. 실외에서 다시 시도하거나, 지도를 눌러 시작점을 정해주세요.';
    case 'unavailable':
      return '위치를 확인할 수 없어요. 지도를 눌러 시작점을 정해주세요.';
  }
}

/** 잡은 위치가 얼마나 거친지 — 화면에 덧붙일 말 (충분히 정확하면 null) */
export function coarseNotice(r: LocateResult): string | null {
  if (r.precise) return null;
  const acc = r.accuracyM;
  if (acc == null) return '대략적인 위치예요. 정확하지 않으면 지도를 눌러 옮겨주세요.';
  return `대략적인 위치예요 (오차 ±${formatAccuracy(acc)}). 정확하지 않으면 지도를 눌러 옮겨주세요.`;
}

function formatAccuracy(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)}km`;
  return `${Math.round(m)}m`;
}

/** 테스트에서 가짜 구현을 끼울 수 있도록 필요한 만큼만 추린 타입 */
export interface GeolocationLike {
  watchPosition(
    ok: (pos: GeolocationPosition) => void,
    err: (e: GeolocationPositionError) => void,
    opts?: PositionOptions,
  ): number;
  clearWatch(id: number): void;
}

export interface LocateOptions {
  goodEnoughM?: number;
  maxWaitMs?: number;
  geolocation?: GeolocationLike | null;
  /** setTimeout 주입 (테스트용) */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

/**
 * 위치를 한 번 잡는다. 정확도가 좋아지는 동안 잠깐 기다렸다가 가장 나은 것을 준다.
 *
 * 반환된 cancel() 을 부르면 watch 를 끊고 약속은 영원히 미결로 남는다 —
 * 화면이 사라진 뒤 setState 가 불리지 않게 호출측이 쓰는 문이다.
 */
export function locateOnce(opts: LocateOptions = {}): {
  promise: Promise<LocateResult>;
  cancel: () => void;
} {
  const {
    goodEnoughM = GOOD_ENOUGH_M,
    maxWaitMs = MAX_WAIT_MS,
    geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : null,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  } = opts;

  let cancelled = false;
  let watchId: number | null = null;
  let timerId: unknown = null;
  let best: LocateResult | null = null;
  let settled = false;

  const cancel = () => {
    cancelled = true;
    cleanup();
  };

  function cleanup() {
    if (watchId != null && geolocation) {
      try {
        geolocation.clearWatch(watchId);
      } catch {
        /* 이미 끊겼으면 그만이다 */
      }
      watchId = null;
    }
    if (timerId != null) {
      clearTimer(timerId);
      timerId = null;
    }
  }

  const promise = new Promise<LocateResult>((resolve, reject) => {
    if (!geolocation) {
      reject(new LocateError('unsupported'));
      return;
    }

    const finish = (r: LocateResult) => {
      if (settled || cancelled) return;
      settled = true;
      cleanup();
      resolve(r);
    };
    const fail = (kind: LocateErrorKind) => {
      if (settled || cancelled) return;
      settled = true;
      cleanup();
      reject(new LocateError(kind));
    };

    // 시간이 다 되면 그때까지 중 가장 나은 것으로 끝낸다. 하나도 못 받았으면
    // 그건 타임아웃이다 — 위치가 없는 것과 거친 것은 다른 이야기다.
    timerId = setTimer(() => {
      if (best) finish(best);
      else fail('timeout');
    }, maxWaitMs);

    try {
      watchId = geolocation.watchPosition(
        (pos) => {
          if (settled || cancelled) return;
          const accRaw = pos.coords.accuracy;
          const accuracyM = Number.isFinite(accRaw) ? accRaw : null;
          const cand: LocateResult = {
            coords: [pos.coords.latitude, pos.coords.longitude],
            accuracyM,
            precise: accuracyM != null && accuracyM <= goodEnoughM,
          };

          // 오차를 모르는 측위는 비교할 수가 없다 — 아무것도 없을 때만 담아 둔다.
          if (best == null) best = cand;
          else if (
            accuracyM != null &&
            (best.accuracyM == null || accuracyM < best.accuracyM)
          ) {
            best = cand;
          }

          // 충분히 좋아졌으면 더 기다릴 이유가 없다
          if (cand.precise) finish(cand);
        },
        (e) => {
          if (settled || cancelled) return;
          // 권한 거부는 기다려도 안 풀린다 — 즉시 끝낸다.
          if (e.code === 1 /* PERMISSION_DENIED */) {
            fail('denied');
            return;
          }
          // 그 밖의 오류는 이미 받아 둔 게 있으면 그걸 쓴다. watchPosition 은
          // 위성을 놓친 순간에도 한 번씩 오류를 뱉는데, 그때마다 포기하면
          // 조금만 기다리면 들어올 좋은 측위를 버리게 된다.
          if (best) finish(best);
          else if (e.code === 3 /* TIMEOUT */) fail('timeout');
          else fail('unavailable');
        },
        { enableHighAccuracy: true, timeout: maxWaitMs, maximumAge: 0 },
      );
    } catch {
      fail('unavailable');
    }
  });

  return { promise, cancel };
}
