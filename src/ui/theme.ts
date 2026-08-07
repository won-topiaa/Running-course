// ---------------------------------------------------------------------------
// 색 상수 한 곳 모음
//
// Tailwind 클래스로 칠할 수 없는 곳(Leaflet/카카오 폴리라인, SVG stroke,
// 마커 HTML)이 앱 곳곳에 있다. 그 값들이 파일마다 흩어져 있으면 톤을 바꿀 때
// 반드시 몇 개를 놓친다 — 실제로 그렇게 됐다. 여기서만 고치면 전부 따라온다.
// tailwind.config.js 의 팔레트와 짝을 맞춰 유지할 것.
// ---------------------------------------------------------------------------

/** 주요 강조색 — 경로·현재 위치·주요 액션 */
export const VOLT = '#D8FF3E';
/** 성공·도착 */
export const MINT = '#7FD1A6';
/** 바탕 */
export const INK = '#0B0B0C';
/** 경계선 */
export const INK_LINE = '#2A2A2F';
/** 어두운 지도 위에서도 읽히는 보조선 (예정 경로 점선) */
export const MUTED = '#8A8A93';
/** 경로 둘레 테두리 — 어떤 타일 위에서도 경로를 분리해준다 */
export const HALO = '#FFFFFF';

/** 러닝 컨디션 등급색 (경고는 의미색이라 볼트로 바꾸지 않는다) */
export const GRADE = {
  good: MINT,
  moderate: '#E3B857',
  bad: '#FF8A5B',
  verybad: '#FF6B6B',
} as const;
