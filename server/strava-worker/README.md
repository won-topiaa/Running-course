# Strava 자동 업로드 Worker

브라우저 앱은 `client_secret` 을 안전하게 보관할 수 없고, Strava API 는 브라우저에서
직접 호출할 수 없습니다(CORS). 이 Worker 가 OAuth 토큰 교환과 GPX 업로드를 중계합니다.

배포하지 않아도 앱은 **GPX 내보내기 → Strava 수동 업로드**로 동작합니다.
이 Worker 를 배포하면 앱에서 버튼 한 번으로 자동 업로드가 됩니다.

## 배포 (5분, 무료)

```bash
cd server/strava-worker

# 1) Strava API 앱 만들기 → https://www.strava.com/settings/api
#    Authorization Callback Domain 에 Worker 도메인을 넣습니다
#    (배포 후 나오는 <name>.<계정>.workers.dev)

# 2) 시크릿 등록
npx wrangler secret put STRAVA_CLIENT_ID
npx wrangler secret put STRAVA_CLIENT_SECRET

# 3) 허용 오리진 확인 (wrangler.toml 의 ALLOWED_ORIGINS)

# 4) 배포
npx wrangler deploy
```

배포되면 `https://runcourse-strava.<계정>.workers.dev` 주소가 나옵니다.
그 주소를 앱 **마이 페이지 → Strava 자동 업로드**에 붙여넣으면 연결됩니다.

## 라우트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/auth?redirect=<앱 URL>` | Strava 동의 화면으로 리다이렉트 |
| GET | `/callback` | 코드 교환 후 앱으로 복귀(`#strava_access=...`) |
| POST | `/refresh` | 리프레시 토큰으로 액세스 토큰 갱신 |
| POST | `/upload` | GPX 업로드 중계 |
| GET | `/status?id=` | 업로드 처리 상태 조회 |

## 보안 메모

- `client_secret` 은 Worker 시크릿에만 있고 브라우저로 내려가지 않습니다.
- `ALLOWED_ORIGINS` 로 리다이렉트 대상과 CORS 를 제한해 오픈 리다이렉트를 막습니다.
- 액세스/리프레시 토큰은 사용자의 브라우저(localStorage)에 저장됩니다. 공용 PC 에서는
  마이 페이지에서 연결 해제를 눌러 지우세요.
