// ---------------------------------------------------------------------------
// 시간 제한이 걸린 fetch
//
// 모바일 네트워크는 '오류'를 주지 않고 그냥 멈추는 경우가 흔하다(지하·엘리베이터·
// 기지국 전환). 그때 fetch 는 영원히 기다리므로, 타임아웃이 없으면 코스 만들기
// 스피너가 끝나지 않고 사용자는 새로고침 말고 할 수 있는 게 없다.
// 라우팅·고도처럼 '실패하면 폴백이 있는' 호출은 전부 이걸 쓴다.
// ---------------------------------------------------------------------------

/** 경로/고도 API 기본 제한 — 넘으면 폴백(다른 provider·합성 고도)으로 넘어간다 */
export const DEFAULT_TIMEOUT_MS = 12_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}
