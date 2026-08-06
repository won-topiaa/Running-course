# 기기 동기화 Worker

로그인 없이 **동기화 코드** 하나로 기록·설정을 기기 간에 옮기는 초경량 서버입니다
(Cloudflare Workers + KV, 무료).

배포하지 않아도 앱의 **파일 내보내기/가져오기**로 데이터 이동은 됩니다.
이 Worker 를 배포하면 파일 주고받기 없이 코드 입력만으로 동기화됩니다.

## 배포 (5분, 무료)

```bash
cd server/sync-worker
npx wrangler kv namespace create SYNC     # 출력된 id 를 wrangler.toml 에 기입
npx wrangler deploy
```

배포되면 `https://runcourse-sync.<계정>.workers.dev` 주소가 나옵니다.
그 주소를 앱 **마이 페이지 → 기기 동기화**에 붙여넣으면 켜집니다.

## 동작

| 메서드 | 경로 | 설명 |
|---|---|---|
| PUT | `/sync/:code` | JSON 백업 저장 (90일 보관, 최대 2MB) |
| GET | `/sync/:code` | 저장된 백업 반환 |

## 보안 메모

- 코드가 곧 열쇠입니다. 10자 무작위(약 8×10¹⁴ 경우의 수)라 추측은 사실상 불가능하지만,
  **코드를 아는 사람은 누구나 내려받을 수 있으니 비밀번호처럼 다루세요.**
- 90일 지나면 자동 삭제됩니다. 계정·비밀번호·개인식별정보는 저장하지 않습니다.
