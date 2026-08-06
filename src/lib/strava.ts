// ---------------------------------------------------------------------------
// Strava 연동
//
// Strava 업로드는 OAuth2 가 필요하다:
//   1) 사용자를 authorize URL 로 보내 권한 동의 → redirect 로 code 수신
//   2) code + client_secret 로 토큰 교환   ← client_secret 노출 불가라 서버 필요
//   3) 액세스 토큰으로 /uploads 에 GPX 업로드
//
// 이 앱은 정적(프론트엔드 전용)이라 (1)의 authorize 단계까지 배선하고,
// (2)(3)은 서버리스 콜백(예: Cloudflare Workers/Vercel Function)이 필요함을 안내한다.
// 지금 바로 동작하는 경로는 "GPX 내보내기 → Strava 수동 업로드" 이다.
// ---------------------------------------------------------------------------

export const STRAVA_SCOPE = 'activity:write,read';

export function stravaAuthUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    approval_prompt: 'auto',
    scope: STRAVA_SCOPE,
  });
  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

/** 현재 페이지를 OAuth redirect 대상으로 사용 */
export function defaultRedirectUri(): string {
  return `${location.origin}${location.pathname}`;
}

export function hasStravaCode(): string | null {
  return new URLSearchParams(location.search).get('code');
}
