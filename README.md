# 🏃 런코스 — 취향으로 찾고, 직접 만드는 러닝 코스

매번 똑같은 코스가 지겹지만 새 코스를 짜기는 번거로운 러너를 위한 앱입니다.
따뜻한 에디토리얼 감성의 모바일 우선 UI에서 **코스를 추천받고, 직접 만들고,
러너들과 공유**할 수 있습니다.

## 무엇을 할 수 있나요

### 🏠 홈 — 감성 피드 + 오늘의 러닝 컨디션
- **오늘의 러닝 컨디션**: 날씨·기온·**미세먼지(PM2.5)** 를 종합한 **러닝 적합도 점수**,
  복장 추천, 한 줄 코멘트 (Open-Meteo 실데이터, 실패 시 샘플 폴백)
- 러너들이 공유한 코스를 **사진 중심 에디토리얼 카드**로 탐색
- **감성 무드 태그**(#노을이예쁜 #신호등0개 #비온뒤흙냄새 …)로 필터, 검색
- 후기·러너 프로필·저장(하트)·함께 달리기

### 🧭 탐색 — 취향 가중치 추천
경사도·코스 취향·안전·편의시설·경관·거리 **6요소의 중요도**를 정하면
서울 코스를 점수화해 순위와 **추천 이유**를 보여줍니다.

### 🛣️ 코스 만들기 — 실제 지도 위에서 직접 설계 (핵심)
러너가 직접 코스를 짜는 두 가지 방식:
1. **핀으로 만들기** — 지도에 가고 싶은 지점을 핀으로 찍고 러닝 스타일을 고르면,
   여러 경로 후보를 생성해 스타일에 가장 맞는 코스를 추천
2. **거리로 만들기** — 시작점(내 위치)과 목표 거리를 정하면, 그 거리에 맞는
   **왕복 루프**를 여러 개 생성해 스타일 매칭이 높은 순으로 추천

두 모드 모두 **실제 도로 도보 경로 + 구간별 경사(고도)** 를 계산하고, 경로를
**경사 색상**(급내리막·내리막·평지·오르막·급오르막)으로 지도에 표시합니다.
러닝 스타일은 **평지 / 완만 / 오르막내리막(굴곡) / 경사 훈련** 중 선택.

### 🎽 실시간 러닝 기록
- 브라우저 GPS(`watchPosition`)로 **거리·시간·평균/현재 페이스**를 실시간 기록
- 라이브 트랙 지도(현재 위치를 따라가며 지나온 경로 표시), 일시정지/재개/종료
- 종료 후 **요약**(거리·시간·페이스·경사 고도)에서 바로 저장·공유·내보내기
- GPS를 쓸 수 없는 환경(데스크톱 등)에서는 **데모 재생**으로 체험 가능
- 홈의 "지금 바로 뛰기" 또는 만든 코스의 "이 코스로 뛰기"로 진입

### 💾 코스 저장 · 🔗 공유
- 만든 코스·기록한 러닝을 **내 코스로 저장** → 저장 탭에서 다시 열기
- **공유 링크**: 경로를 polyline 으로 압축해 URL 로 공유(백엔드 불필요). 링크로 들어오면
  코스가 그대로 열립니다. Web Share API / 클립보드 복사 지원

### 📤 GPX 내보내기 · Strava
- 어떤 코스/기록이든 **GPX 파일로 내보내기** → Strava·가민 커넥트 등에 업로드
- "Strava에 올리기": GPX 저장 + Strava 업로드 페이지 열기(지금 바로 동작)
- (선택) Strava Client ID 를 넣으면 OAuth 자동 업로드 배선 — *토큰 교환은 서버 콜백 필요*

### 🔖 저장 & 👤 마이
- 저장한 코스 모아보기(즐겨찾기 / 만든·기록한 코스)
- **러닝화 마일리지 트래커**(교체 시기 알림), 주간 거리·연속 러닝·코스 다양성
- **페이스 계산기**(5K·10K·하프 예상 기록) — 설정한 페이스는 코스별 예상 시간에도 반영
- 획득 배지, **외부 서비스 연동**(Mapbox · OpenRouteService · Strava 키)

## 러너 리서치 반영

국내외 러닝 앱/커뮤니티 자료를 분석해 자주 뛰는 러너가 실제로 원하는 요소를 담았습니다:
페이스·예상 시간, 구간 경사·고도, **날씨·미세먼지·복장 추천**, 급수·화장실·야간 조명 안전,
노면, 코스 다양성, **러닝화 마일리지**, 러닝 계산기, 크루·공유·함께 달리기 등.

## 외부 서비스 연동 (모두 선택 · 없어도 완전 동작)

모든 키는 선택 사항입니다. 없으면 앱은 오프라인 데모(합성 고도 + OpenStreetMap)로 완전히
동작하고, 키를 넣으면 실데이터로 전환됩니다. 연결 방법은 두 가지 — `.env`(`.env.example`
참고) 또는 앱 실행 후 **마이 페이지 → 외부 서비스 연동**에 붙여넣기.

| 서비스 | 역할 | 없을 때 | 발급 |
|---|---|---|---|
| **카카오맵** | 기본 지도(한국) | OpenStreetMap 폴백 | [developers.kakao.com](https://developers.kakao.com/console/app) |
| **OpenRouteService** | 코스 만들기의 실제 도로 경로·경사 | 오프라인 합성 경로 | [openrouteservice.org](https://openrouteservice.org/dev/#/signup) |
| **Mapbox** | 카카오 대신 쓸 지도(선택) | 미사용 | [account.mapbox.com](https://account.mapbox.com/access-tokens/) |
| **Strava** | 자동 업로드(선택) | GPX 수동 업로드 | [strava.com/settings/api](https://www.strava.com/settings/api) |

- **카카오맵**을 기본 지도로 씁니다(국내 대상). 지도 계층은 **스위처블** —
  카카오 JS SDK 를 불러올 수 있으면 카카오맵, 아니면 자동으로 Leaflet/OSM(또는 Mapbox)으로
  폴백합니다. 카카오는 자체 JS SDK 라 SDK 를 못 부르는 환경에서도 앱이 안 깨집니다.
  ⚠️ 카카오맵이 뜨려면 **개발자 콘솔 → Web 플랫폼**에 실행/배포 도메인을 등록해야 합니다
  (`http://localhost:5173`, 배포 주소 등).
- 도보 경로·고도는 카카오와 무관하게 **OpenRouteService**로 계산하고, 그 좌표를 지도 위에
  경사 색상 폴리라인으로 그립니다.
- **Strava 자동 업로드**는 OAuth `client_secret` 을 다루는 서버리스 콜백(예: Cloudflare
  Workers/Vercel Function)이 필요합니다. 프론트엔드는 authorize 단계까지 배선돼 있으며,
  지금 바로 쓸 수 있는 경로는 **GPX 내보내기 → Strava 업로드**입니다.

## 배포 (GitHub Pages)

`.github/workflows/deploy.yml` 이 푸시 시 자동으로 빌드→Pages 배포합니다.

1. 저장소 **Settings → Pages → Build and deployment → Source: GitHub Actions** 선택(최초 1회)
2. 이 브랜치(또는 main)로 push → Actions 가 빌드/배포 → `https://<owner>.github.io/<repo>/` 생성
3. 그 주소를 **카카오 개발자 콘솔 → Web 플랫폼 도메인**에 등록하면 카카오맵이 표시됩니다
   (예: `https://won-topiaa.github.io`)

> `vite.config.ts` 의 `base: './'` 로 하위 경로에서도 에셋이 정상 로드됩니다.
> 별도 배포 비밀키는 필요 없습니다(지도 키는 도메인 제한 공개 키).

## 기술 스택

- **React 18 + TypeScript + Vite**
- **Tailwind CSS** (따뜻한 에디토리얼 디자인 시스템) + **lucide-react** 아이콘
- **카카오맵 JS SDK**(기본) ↔ **Leaflet / react-leaflet**(폴백, OSM·Mapbox 타일) 스위처블 지도
- **OpenRouteService** (도보 경로 · 왕복 생성 · 지점별 고도) + 오프라인 폴백 provider
- **Open-Meteo** (날씨 · 대기질, 키 불필요)
- **Geolocation API** 실시간 기록 · **GPX 1.1** 내보내기 · Encoded Polyline 공유 링크
- 차트는 외부 의존성 없는 순수 SVG

## 실행 방법

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm run build    # 타입체크 + 프로덕션 빌드
npm run preview  # 빌드 결과 미리보기
```

## 프로젝트 구조

```
src/
├─ lib/                       # 도메인 로직 (UI와 무관)
│  ├─ types.ts                # 코스·선호·추천 타입
│  ├─ scoring.ts              # 취향 가중치 추천 엔진
│  ├─ geo.ts                  # 거리·방위·경로 생성 등 지오 계산
│  ├─ routing.ts              # ORS/오프라인 provider, 구간 경사 계산
│  ├─ routeStyle.ts           # 러닝 스타일 점수화 + 경사 색상 밴드
│  ├─ courseBuilder.ts        # 후보 경로 생성 → 스타일/거리 랭킹
│  ├─ weather.ts              # 날씨·미세먼지·러닝 적합도
│  ├─ format.ts               # 페이스·시간·거리 포맷
│  ├─ config.ts               # 설정(키·페이스·위치) 지속
│  ├─ scene.ts                # 코스 → 감성 씬 매핑
│  ├─ polyline.ts             # Encoded Polyline + 공유 링크 코덱
│  ├─ savedRoutes.ts          # 만든/기록한 코스 저장 + 공유 복원
│  ├─ gpx.ts                  # GPX 1.1 생성/다운로드
│  ├─ strava.ts               # Strava OAuth authorize URL
│  ├─ useRunRecorder.ts       # 실시간 GPS 기록 훅(+데모 폴백)
│  ├─ kakaoLoader.ts          # 카카오맵 SDK 동적 로더
│  ├─ useKakao.ts             # 카카오 로드 상태 훅(폴백 신호)
│  └─ routeColor.ts           # 경사 색상 폴리라인 그룹(지도 공용)
├─ data/
│  ├─ courses.ts              # 서울 실제 코스 큐레이션 (14곳)
│  ├─ feed.ts                 # 커뮤니티 공유 코스 샘플
│  └─ profile.ts              # 마이 페이지 샘플(마일리지 등)
├─ components/                # 지도 스위처(RouteMap/PathMap/LiveMap) + 카카오/Leaflet
│                             # 구현·차트·카드·시트(CourseDetail/RouteSheet)·기록·네비
├─ screens/                   # Home / Explore / Build / Saved / My
└─ App.tsx                    # 화면 라우팅 · 전역 상태 · 공유 링크 수신
```

## 참고

- 서울 코스의 GPS 경로 좌표는 실제 권역을 따라 단순화한 값이며, 6요소 속성/커뮤니티
  피드/마이 페이지 통계는 큐레이션·샘플 데이터입니다. 실제 서비스에서는 지자체 DEM·POI,
  실제 사용자 데이터로 대체됩니다.
- 향후: 카카오/네이버 지도 연동, 실시간 GPS 기록, 스트라바 연동 취향 학습, 크루/챌린지.
