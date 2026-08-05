import type { Screen } from '../components/BottomNav';
import type { Settings } from '../lib/config';
import type { RunConditions } from '../lib/weather';

/** 화면 컴포넌트에 전달되는 공용 앱 API */
export interface AppApi {
  nav: (s: Screen) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  conditions: RunConditions | null;
  savedIds: string[];
  isSaved: (id: string) => boolean;
  toggleSaved: (id: string) => void;
  /** 큐레이션 코스 상세 시트 열기 */
  openCourse: (courseId: string) => void;
}
