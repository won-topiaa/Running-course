import type { Screen } from '../components/BottomNav';
import type { Settings } from '../lib/config';
import type { FitnessState } from '../lib/useFitness';
import type { RouteResult } from '../lib/routing';
import type { RunStyle } from '../lib/routeStyle';
import type { SavedRoute } from '../lib/savedRoutes';
import type { RunConditions } from '../lib/weather';

/** RouteSheet 로 볼 경로(만든/기록한/공유된) */
export interface RouteView {
  name: string;
  route: RouteResult;
  kind: 'built' | 'recorded' | 'shared';
  style?: RunStyle;
  source: string;
  durationSec?: number;
  /** 기록한 러닝의 좌표별 시각(epoch ms) — GPX 시각용 */
  times?: number[];
  /** 좌표별 누적 활성 ms(일시정지 제외) — 구간 기록용 */
  activeTimes?: number[];
  /** 좌표별 누적 거리(m) — 총거리와 같은 방식(도플러 적분)으로 잰 값. 구간 기록용 */
  cumDist?: number[];
  /** 이미 저장된 항목이면 id */
  savedId?: string;
  /** 앱이 안내한 12분 테스트로 뛴 기록인지 */
  isCooperTest?: boolean;
}

/** 화면 컴포넌트에 전달되는 공용 앱 API */
export interface AppApi {
  nav: (s: Screen) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  conditions: RunConditions | null;
  /**
   * 체력 상태 — 별도 기능이 아니라 앱 전역의 기본 값이다.
   * 처방이 있으면 추천 순서에 언제나 반영된다(모르면 그 축만 빠진다).
   */
  fitness: FitnessState;
  // 즐겨찾기(하트) — 커뮤니티/큐레이션 코스
  savedIds: string[];
  isSaved: (id: string) => boolean;
  toggleSaved: (id: string) => void;
  openCourse: (courseId: string) => void;
  // 내가 만든/기록한 코스
  savedRoutes: SavedRoute[];
  addSavedRoute: (r: SavedRoute) => void;
  removeSavedRoute: (id: string) => void;
  // 실시간 기록 / 경로 보기
  /**
   * planned 를 주면 그 경로를 따라 뛰는 모드로 시작한다.
   * cooperTest 를 주면 12분 심폐 검사 모드로 연다 (경로 없이).
   */
  startRecord: (
    planned?: { name: string; route: RouteResult } | null,
    opts?: { cooperTest?: boolean },
  ) => void;
  viewRoute: (v: RouteView) => void;
}
