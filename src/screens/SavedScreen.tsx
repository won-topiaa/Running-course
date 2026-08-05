import { Bookmark, Compass } from 'lucide-react';
import RouteFeedCard from '../components/RouteFeedCard';
import ScenePhoto from '../components/ScenePhoto';
import { FEED } from '../data/feed';
import { COURSES } from '../data/courses';
import { sceneForCourse } from '../lib/scene';
import { formatDistance } from '../lib/format';
import { ELEVATION_LABEL } from '../lib/types';
import type { AppApi } from '../ui/appApi';

export default function SavedScreen({ api }: { api: AppApi }) {
  const feedById = new Map(FEED.map((f) => [f.id, f]));
  const courseById = new Map(COURSES.map((c) => [c.id, c]));

  const savedFeed = api.savedIds.map((id) => feedById.get(id)).filter(Boolean);
  const savedCourses = api.savedIds
    .filter((id) => !feedById.has(id))
    .map((id) => courseById.get(id))
    .filter(Boolean);

  const empty = savedFeed.length === 0 && savedCourses.length === 0;

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-28 pt-5">
      <header className="mb-4">
        <h1 className="text-[22px] font-extrabold tracking-tightish text-espresso">저장한 코스</h1>
        <p className="mt-1 text-[13px] text-espresso-muted">
          마음에 든 코스를 모아두고 언제든 다시 뛰어보세요.
        </p>
      </header>

      {empty && (
        <div className="mt-10 flex flex-col items-center rounded-3xl border border-dashed border-line bg-paper/60 p-10 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-coral-50">
            <Bookmark size={26} className="text-coral" />
          </span>
          <p className="mt-4 text-[14px] font-semibold text-espresso">아직 저장한 코스가 없어요</p>
          <p className="mt-1 text-[12.5px] text-espresso-soft">하트를 눌러 코스를 저장해보세요.</p>
          <button
            onClick={() => api.nav('home')}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-2.5 text-[13px] font-semibold text-white shadow-warm active:scale-95"
          >
            <Compass size={15} /> 코스 둘러보기
          </button>
        </div>
      )}

      {savedCourses.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-3 text-[14px] font-bold text-espresso">추천에서 저장</h2>
          <div className="grid grid-cols-2 gap-3">
            {savedCourses.map(
              (c) =>
                c && (
                  <button
                    key={c.id}
                    onClick={() => api.openCourse(c.id)}
                    className="overflow-hidden rounded-3xl border border-line bg-paper text-left shadow-soft active:scale-[0.98]"
                  >
                    <ScenePhoto scene={sceneForCourse(c)} className="aspect-[4/3] w-full" />
                    <div className="p-3">
                      <h3 className="truncate text-[13px] font-bold text-espresso">{c.name}</h3>
                      <p className="mt-1 text-[11px] text-espresso-soft">
                        {formatDistance(c.distanceKm)} · {ELEVATION_LABEL[c.elevation.category]}
                      </p>
                    </div>
                  </button>
                ),
            )}
          </div>
        </section>
      )}

      {savedFeed.length > 0 && (
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-espresso">커뮤니티에서 저장</h2>
          <div className="space-y-4">
            {savedFeed.map((f) => f && <RouteFeedCard key={f.id} route={f} api={api} />)}
          </div>
        </section>
      )}
    </div>
  );
}
