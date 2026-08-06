import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
// base: './' — 상대 경로로 빌드해 GitHub Pages 프로젝트 사이트(하위 경로)와
// 로컬/프리뷰 어디서든 에셋이 정상 로드되도록 한다.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
