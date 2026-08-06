import type { Screen } from '../components/BottomNav';
import type { Settings } from '../lib/config';
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
  /** 이미 저장된 항목이면 id */
  savedId?: string;
}

/** 화면 컴포넌트에 전달되는 공용 앱 API */
export interface AppApi {
  nav: (s: Screen) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  conditions: RunConditions | null;
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
  startRecord: () => void;
  viewRoute: (v: RouteView) => void;
}
