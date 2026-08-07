/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FDFBF7',
        paper: '#FFFFFF',
        tint: '#F7F2EA',
        line: '#F0EAE1',
        espresso: {
          DEFAULT: '#2C2725',
          muted: '#6B615B',
          soft: '#9B9088',
        },
        coral: {
          DEFAULT: '#FF7A59',
          600: '#F2603E',
          100: '#FFE7DF',
          50: '#FFF3EE',
        },
        sage: {
          DEFAULT: '#7A9A8B',
          600: '#5F8073',
          100: '#E7EEEA',
          50: '#F1F5F2',
        },
        // 러닝 중 화면 전용 팔레트. 계획·탐색 화면의 따뜻한 톤과 일부러 분리했다.
        // 뛰는 동안에는 팔을 흔들며 흘깃 보게 되므로 대비가 최우선이고,
        // 어두운 바탕은 야간 러닝에서 눈부심이 없고 OLED 배터리도 아낀다.
        ink: {
          DEFAULT: '#0B0B0C',
          soft: '#17171A',
          line: '#2A2A2F',
          muted: '#8A8A93',
        },
        volt: {
          DEFAULT: '#D8FF3E', // 나이키 볼트 계열 — 화면에서 유일한 강조색
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
        soft: '0 2px 10px rgba(44,39,37,0.06), 0 1px 3px rgba(44,39,37,0.04)',
        warm: '0 10px 30px rgba(255,122,89,0.14)',
        card: '0 6px 20px rgba(44,39,37,0.07)',
      },
      letterSpacing: {
        tightish: '-0.01em',
      },
    },
  },
  plugins: [],
};
