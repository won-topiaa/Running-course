/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ---------------------------------------------------------------
        // NRC 톤 — 어두운 바탕 위에 볼트 강조색 하나.
        // 시맨틱 이름(cream=바탕, paper=카드, espresso=본문)은 그대로 두고
        // 값만 뒤집었다. 화면 코드가 "무엇인지"로 색을 부르고 있어서,
        // 톤을 바꿔도 클래스명을 갈아엎을 필요가 없다.
        // ---------------------------------------------------------------
        cream: '#0B0B0C', //  페이지 바탕
        paper: '#141417', //  카드 표면
        tint: '#1E1E23', //   은은한 채움 (칩·입력창)
        line: '#2A2A2F', //   경계선
        espresso: {
          DEFAULT: '#FFFFFF', //  본문
          muted: '#A3A3AC', //    보조 설명
          soft: '#8E8E98', //     3차 라벨. 검정 위에서 4.5:1 을 넘기려면
          //                      이보다 어두우면 안 된다 (WCAG AA 소형 텍스트)
        },
        // 주요 액션 = 볼트. 어두운 바탕에서는 '진한 쪽'이 아니라 '밝은 쪽'이
        // 강조이므로 600 을 더 밝게, 50/100 은 어두운 틴트로 뒤집었다.
        coral: {
          DEFAULT: '#D8FF3E',
          600: '#E4FF7C',
          100: '#333D12',
          50: '#22290B',
        },
        // 경고(주의) 상태 — 폭염·자외선 안내.
        // 이게 없으면 Tailwind 기본 amber 로 떨어지는데, 기본 amber-50 은
        // 거의 흰색(#FFFBEB)이라 어두운 화면 맨 위에 흰 판때기가 생긴다.
        // 실측: 러닝 점수 73점(주의)인 날 날씨 줄 전체가 하얗게 떴다.
        // 다른 색과 같은 규칙 — 50/100 은 어두운 틴트, 600/700 은 밝은 글자.
        amber: {
          DEFAULT: '#F5C451',
          700: '#F7D68C', //  어두운 바탕 위 본문
          600: '#F7D68C',
          100: '#3A2E10',
          50: '#2A2109',
        },
        // 성공·연결됨 상태
        sage: {
          DEFAULT: '#7FD1A6',
          600: '#A5E6C2',
          100: '#163022',
          50: '#12261B',
        },
        ink: {
          DEFAULT: '#0B0B0C',
          soft: '#17171A',
          line: '#2A2A2F',
          muted: '#8A8A93',
        },
        volt: {
          DEFAULT: '#D8FF3E',
          600: '#B8E01F',
        },
      },
      fontFamily: {
        sans: [
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'Apple SD Gothic Neo',
          'Segoe UI',
          'Malgun Gothic',
          'system-ui',
          'sans-serif',
        ],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        soft: '0 1px 0 rgba(255,255,255,0.04) inset, 0 2px 12px rgba(0,0,0,0.5)',
        warm: '0 0 32px rgba(216,255,62,0.28)',
        card: '0 8px 28px rgba(0,0,0,0.6)',
      },
      letterSpacing: {
        tightish: '-0.01em',
      },
    },
  },
  plugins: [],
};
