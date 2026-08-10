// ---------------------------------------------------------------------------
// 표시용 '지금 페이스' — 최근 창(window)의 실제 누적 거리 ÷ 시간
//
// 순간 도플러 속도를 그대로 뒤집어 보여주면(1000/speed) 실기기 수준의 잡음
// (±0.45m/s)에서 일정하게 달려도 화면이 4'34"~6'57" 를 오간다 — 합성 검증에서
// 전체 틱의 18% 가 실제와 10% 넘게 어긋났다. 직선이어도 그렇다.
//
// 러닝 워치·앱이 쓰는 방식은 '최근 N초 동안 실제로 쌓인 거리 ÷ 시간'이다.
// 총거리와 같은 자(도플러 적분)로 재므로 잡음이 창 길이만큼 상쇄되고,
// 화면 상단의 거리·평균 페이스와도 항상 앞뒤가 맞는다.
//
// 시간축은 벽시계가 아니라 '활성 시간'(일시정지 제외)을 쓴다 — 일시정지
// 동안에는 거리도 활성 시간도 멈추므로, 재개 직후에도 창이 자연스럽게 이어진다.
// 순수 함수로 떼어 둔 것은 브라우저 없이 검증하기 위해서다.
// ---------------------------------------------------------------------------

/** 창 길이. 길수록 안정적이고 짧을수록 반응이 빠르다 — 20초가 워치들의 관례권. */
const WINDOW_MS = 20_000;
/** 이만큼은 쌓여야 숫자를 내보낸다. 3~4틱으로 낸 값은 잡음이다. */
const MIN_SPAN_MS = 8_000;

export function createPaceWindow(windowMs = WINDOW_MS, minSpanMs = MIN_SPAN_MS) {
  let samples: { t: number; d: number }[] = [];
  return {
    reset() {
      samples = [];
    },
    /**
     * 새 표본(활성 ms, 누적 거리 m)을 넣고 현재 페이스(초/km)를 돌려준다.
     * 아직 창이 안 찼거나 그 사이 이동이 없으면 null.
     */
    push(activeMs: number, distM: number): number | null {
      // 시간이 뒤로 가면(세션 리셋 직후 등 비정상) 옛 표본과 섞어 계산하지
      // 않는다 — 음수 창이 되어 엉뚱한 숫자가 나온다. 새로 시작한다.
      const last = samples[samples.length - 1];
      if (last && activeMs < last.t) samples = [];
      samples.push({ t: activeMs, d: distM });
      // 창 밖 표본은 버리되, 경계에 걸친 마지막 하나는 남긴다 — 다 버리면
      // 창이 실제보다 짧아져 페이스가 다시 출렁인다.
      const cutoff = activeMs - windowMs;
      while (samples.length > 2 && samples[1].t <= cutoff) samples.shift();
      const first = samples[0];
      const spanMs = activeMs - first.t;
      if (spanMs < minSpanMs) return null;
      const dist = distM - first.d;
      if (dist <= 0) return null; // 창 내내 멈춰 있었다 — 숫자 대신 '--'
      return spanMs / 1000 / (dist / 1000);
    },
  };
}
