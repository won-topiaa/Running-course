import { Bookmark, Compass, Footprints, Route, TrendingUp } from 'lucide-react';
import ScenePhoto from '../components/ScenePhoto';
import { COURSES } from '../data/courses';
import { sceneForCourse } from '../lib/scene';
import { formatDistance, formatDuration } from '../lib/format';
import { toRouteResult, type SavedRoute } from '../lib/savedRoutes';
import { ELEVATION_LABEL } from '../lib/types';
import type { AppApi } from '../ui/appApi';

export default function SavedScreen({ api }: { api: AppApi }) {
  const courseById = new Map(COURSES.map((c) => [c.id, c]));
  const savedCourses = api.savedIds.map((id) => courseById.get(id)).filter(Boolean);

  const myRoutes = api.savedRoutes;
  const openRoute = (r: SavedRoute) =>
    api.viewRoute({
      name: r.name,
      route: toRouteResult(r),
      kind: r.kind,
      style: r.style,
      source: r.source,
      durationSec: r.durationSec,
      savedId: r.id,
    });

  const empty = savedCourses.length === 0 && myRoutes.length === 0;

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-28 pt-[calc(env(safe-area-inset-top,0px)+1.25rem)]">
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
            onClick={() => api.nav('explore')}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-2.5 text-[13px] font-semibold text-ink shadow-warm active:scale-95"
          >
            <Compass size={15} /> 추천 코스 보기
          </button>
        </div>
      )}

      {myRoutes.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-3 flex items-center gap-1.5 text-[14px] font-bold text-espresso">
            <Route size={16} className="text-coral" /> 내가 만든·기록한 코스
          </h2>
          <div className="space-y-2.5">
            {myRoutes.map((r) => (
              <button
                key={r.id}
                onClick={() => openRoute(r)}
                className="flex w-full items-center gap-3 rounded-3xl border border-line bg-paper p-3.5 text-left shadow-soft active:scale-[0.99]"
              >
                <span
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${
                    r.kind === 'recorded' ? 'bg-coral-50 text-coral' : 'bg-sage-50 text-sage-600'
                  }`}
                >
                  {r.kind === 'recorded' ? <Footprints size={20} /> : <Route size={20} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold text-espresso">{r.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-espresso-muted">
                    <span>{formatDistance(r.distanceKm)}</span>
                    <span className="inline-flex items-center gap-0.5">
                      {/* 고도를 못 받고 만든 코스는 0m 가 아니라 모르는 것이다 */}
                      <TrendingUp size={11} /> {r.elevKnown === false ? '—' : `${r.ascentM}m`}
                    </span>
                    {r.durationSec != null && <span>{formatDuration(r.durationSec)}</span>}
                    <span className="rounded-full bg-tint px-1.5 py-0.5 text-[10px] font-medium">
                      {r.kind === 'recorded' ? '기록' : '만든 코스'}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {savedCourses.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-3 text-[14px] font-bold text-espresso">추천에서 저장한 코스</h2>
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

    </div>
  );
}
