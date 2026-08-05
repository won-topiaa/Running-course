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
