# 이메일 로그인 동기화 (Supabase)

이메일 로그인으로 기록·설정을 계정에 보관합니다. 기기를 바꿔도, 브라우저 데이터를
지워도 **로그인만 하면 그대로**입니다. Supabase 무료 플랜으로 충분합니다.

## 설정 (5분, 무료)

1. **프로젝트 만들기** — https://supabase.com → Start your project → New project
   (이름 아무거나, 리전 Seoul `ap-northeast-2` 권장)

2. **테이블 만들기** — 좌측 **SQL Editor** → 아래 전체를 붙여넣고 Run:

   ```sql
   -- 사용자당 1행: 앱 데이터 전체를 JSON 으로 보관
   create table public.backups (
     user_id uuid primary key references auth.users(id) on delete cascade,
     data jsonb not null,
     updated_at timestamptz not null default now()
   );

   -- 본인 행만 읽고 쓸 수 있게 (Row Level Security)
   alter table public.backups enable row level security;
   create policy "own row" on public.backups
     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```

3. **(권장) 이메일 확인 끄기** — Authentication → Sign In / Up → Email →
   **Confirm email 끄기**. 켜두면 가입 시 확인 메일 링크를 눌러야 로그인됩니다
   (앱이 안내는 해주지만, 개인 프로젝트에선 꺼두는 게 간단합니다).

4. **키 두 개 복사** — Settings → API:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public** key

   두 값을 앱 **마이 페이지 → 계정** 아래에 넣거나(개발 중), 소유자라면
   `src/lib/config.ts` 의 기본값으로 내장하면 모든 사용자에게 켜집니다.
   anon key 는 **공개용 클라이언트 키**입니다 — 데이터 보호는 RLS 가 합니다.

## 동작 방식

- 로그인하면 현재 기기 데이터를 계정에 한 번 올리고, 이후 **변경될 때마다 자동 백업**
- 새 기기에서 로그인 → **계정에서 복원** 버튼으로 그대로 가져오기
- 비밀번호를 잊으면 Supabase 의 비밀번호 재설정 메일로 복구 (동기화 코드와 달리
  잃어버려도 복구 가능한 게 이 방식의 핵심 장점)

## 저장되는 것 / 안 되는 것

- 저장: 러닝 기록(경로·거리·시간), 설정, 러닝화, 즐겨찾기
- 이메일은 Supabase 인증에만 쓰이고 앱 데이터에 따로 저장하지 않습니다
