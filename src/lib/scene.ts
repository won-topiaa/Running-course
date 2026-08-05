import type { Scene } from '../data/feed';
import type { Course } from './types';

/** 큐레이션 코스를 감성 씬(그라디언트 사진)으로 매핑 */
export function sceneForCourse(course: Course): Scene {
  if (course.scenery.nightView >= 4 && course.courseTypes.includes('city'))
    return 'sunset';
  if (course.courseTypes.includes('waterfront')) return 'river';
  if (course.courseTypes.includes('trail') || course.scenery.greenery >= 5)
    return 'forest';
  if (course.courseTypes.includes('green')) return 'autumn';
  if (course.courseTypes.includes('city')) return 'city';
  return 'dawn';
}
