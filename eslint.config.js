// ---------------------------------------------------------------------------
// ESLint 설정 (flat config)
//
// 이 저장소는 tsc 를 strict + noUnusedLocals + noUnusedParameters 로 돌리고,
// 그 위에 검증 스크립트들이 데이터·로직·화면을 따로 검사한다. 그래서 ESLint
// 에게는 "다른 둘이 원리상 못 보는 것" 만 맡긴다 — 같은 문제를 두 도구가 다른
// 문구로 두 번 보고하기 시작하면 사람은 결국 둘 다 안 읽는다.
//
// ESLint 가 실제로 맡는 자리
//   · 훅 규칙 — 의존성 배열, 조건부 호출. 예전엔 코드에 exhaustive-deps 를 끄는
//     주석이 네 군데 있었는데 정작 설정 파일이 없어서 그 주석들이 아무 일도
//     하지 않았다. 이제 억제가 실제 억제고, 안 쓰는 억제는 오류로 잡힌다.
//   · 떠 있는 프라미스 — await 도 catch 도 없이 던져 두는 비동기 호출. 이 앱은
//     라우팅·고도·날씨·백업을 전부 비동기로 부르므로 조용히 사라지는 실패가
//     가장 아픈 버그다.
//   · 템플릿 문자열에 객체가 섞여 '[object Object]' 가 화면에 찍히는 것.
//
// 규칙을 끌 때는 반드시 이유를 적는다. 이유 없는 off 는 다음 사람이 되살릴
// 수도 지울 수도 없다.
// ---------------------------------------------------------------------------

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

/**
 * 타입이 없는 외부 경계 — 여기서는 any 가 회피가 아니라 사실 기술이다.
 * 카카오맵 SDK 는 타입 정의를 배포하지 않고, beforeinstallprompt·WakeLock 은
 * lib.dom 에 없으며, 외부 API 응답 JSON 은 원래 모양을 모른다.
 * 이 목록에 파일을 더할 때는 "정말로 타입이 존재하지 않는가" 를 먼저 묻는다.
 */
const UNTYPED_BOUNDARY = [
  'src/components/KakaoLiveMap.tsx',
  'src/components/KakaoRouteMap.tsx',
  'src/components/KakaoPathMap.tsx',
  'src/lib/kakaoLoader.ts',
  'src/lib/useKakao.ts',
  'src/components/InstallPrompt.tsx',
  'src/lib/wakeLock.ts',
  'src/lib/leafletPatch.ts',
  'src/lib/cloud.ts',
  'src/lib/routing.ts',
];

export default tseslint.config(
  {
    // 빌드 산출물·의존성은 우리 코드가 아니다
    ignores: ['dist/**', 'node_modules/**', '*.tsbuildinfo'],
  },

  // ── 앱 소스 (src) ─────────────────────────────────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      // Vite 의 빠른 새로고침은 파일이 컴포넌트만 내보낼 때 동작한다.
      // 상수를 함께 내보내는 파일이 있어 경고로 둔다.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // ── tsc 담당이라 여기서 또 말하지 않는다 (base 규칙까지 같이 꺼야 한다)
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-undef': 'off',

      // ── ESLint 가 맡는 몫
      // 의도적으로 흘려보낼 때는 코드베이스가 이미 쓰는 void 접두사를 인정한다.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-explicit-any': 'error',

      // catch 로 받은 값을 그대로 되던지는 건 원인을 보존하는 올바른 패턴이다.
      // (그 값이 Error 가 아닐 수 있다는 건 잡는 쪽에서 이미 다루고 있다)
      '@typescript-eslint/only-throw-error': ['error', { allowRethrowing: true }],

      // JSX 속성의 async 핸들러는 리액트에서 관용적이다. 이 저장소의 async
      // onClick 들은 전부 자기 안에서 try/catch 로 실패를 처리하는 걸 확인했다.
      // 속성 밖(= void 를 기대하는 자리에 프라미스를 넘기는 진짜 실수)은 계속 잡는다.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      // Promise 를 반환하는 인터페이스(RoutingProvider)를 동기로 구현할 때
      // async 를 붙이는 건 정상이다. await 가 없다고 문제인 건 아니다.
      '@typescript-eslint/require-await': 'off',

      // 타입 없는 SDK 응답을 다루느라 any 가 흘러다니는 자리들. any 자체는
      // 위에서 막고, 거기서 파생되는 잡음까지 이중으로 보고하진 않는다.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // ── 리액트 컴파일러 대비 규칙 중 이 코드베이스와 충돌하는 둘
      //
      // 이 앱은 React 18 이고 컴파일러를 쓰지 않는다. 아래 두 규칙은 컴파일러가
      // 요구하는 더 엄격한 계약이라, 켜 두면 의도적으로 쓴 패턴 29곳이 전부
      // 오류가 된다 — 제출을 앞두고 그만한 구조 변경을 하는 건 얻는 것보다
      // 잃을 위험이 크다. React 19 + 컴파일러로 옮길 때 다시 켤 자리다.
      //
      // refs: `const cbRef = useRef(cb); cbRef.current = cb;` — 최신 prop 을 ref 에
      //   담아 effect 의존성을 줄이는 패턴. 지도·기록 화면이 이걸로 재구독을 피한다.
      // set-state-in-effect: 외부 값(설정·측위·카카오 SDK 준비 상태)을 리액트
      //   상태로 동기화하는 effect 들. 규칙 설명이 인정하는 바로 그 용도다.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      // 나머지 컴파일러 규칙(set-state-in-render·purity·immutability 등)은 지금
      // 하나도 안 걸린다. 켜 둔 채로 두면 공짜로 지켜 준다.
    },
  },

  // 타입이 없는 외부 경계 — 위 UNTYPED_BOUNDARY 주석 참고
  {
    files: UNTYPED_BOUNDARY,
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // ── 검증·수집 스크립트 (Node ESM) ────────────────────────────────────────
  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      // 'latest' 여야 한다 — fitness-check 가 import attributes
      // (`import(..., { with: { type: 'json' } })`) 를 쓴다. 2022 로 두면
      // 그 파일이 통째로 파싱에 실패해 검사 대상에서 조용히 빠진다.
      ecmaVersion: 'latest',
      sourceType: 'module',
      // 이 스크립트들은 Node 에서 돌지만 page.evaluate() 안쪽은 브라우저에서
      // 실행된다. 한 파일에 두 세계가 섞여 있어 전역도 둘 다 필요하다.
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // 검증 스크립트는 결과를 콘솔로 말하는 게 본업이다
      'no-console': 'off',
    },
  },

  // ── 서비스 워커 ──────────────────────────────────────────────────────────
  {
    files: ['public/sw.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.serviceworker, ...globals.browser },
    },
  },

  // ── vite.config.ts ───────────────────────────────────────────────────────
  {
    files: ['vite.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
  },

  // 억제 주석이 실제로 뭔가를 막고 있는지 전 범위에서 확인한다 —
  // 고쳐 놓고 남은 disable 은 다음 사람에게 '여기 문제가 있다' 고 거짓말한다.
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
);
