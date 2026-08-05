import { Clock, Footprints, Heart, MapPin, Users } from 'lucide-react';
import type { FeedRoute } from '../data/feed';
import type { AppApi } from '../ui/appApi';
import ScenePhoto from './ScenePhoto';

interface Props {
  route: FeedRoute;
  api: AppApi;
}

export default function RouteFeedCard({ route, api }: Props) {
  const saved = api.isSaved(route.id);

  const open = () => {
    if (route.courseId) api.openCourse(route.courseId);
  };

  return (
    <article className="animate-fadeUp overflow-hidden rounded-3xl border border-line bg-paper shadow-soft">
      {/* 사진 */}
      <button onClick={open} className="block w-full text-left">
        <ScenePhoto scene={route.scene} className="aspect-[4/3] w-full">
          <div className="flex h-full flex-col justify-between p-4">
            <div className="flex justify-end">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  api.toggleSaved(route.id);
                }}
                aria-label="코스 저장"
                className="grid h-10 w-10 place-items-center rounded-full bg-white/85 shadow-soft backdrop-blur transition active:scale-90"
              >
                <Heart
                  className={saved ? 'text-coral' : 'text-espresso-muted'}
                  fill={saved ? '#FF7A59' : 'none'}
                  strokeWidth={2.2}
                  size={20}
                />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {route.moodTags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-medium text-espresso backdrop-blur"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </ScenePhoto>
      </button>

      {/* 본문 */}
      <div className="p-4">
        <button onClick={open} className="text-left">
          <h3 className="text-[17px] font-bold leading-snug tracking-tightish text-espresso">
            {route.title}
          </h3>
          <p className="mt-1 flex items-center gap-1 text-[12.5px] text-espresso-muted">
            <MapPin size={13} /> {route.area}
          </p>
        </button>

        {/* 정보 태그 */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Tag icon={<Footprints size={13} />}>{route.distanceKm}km</Tag>
          <Tag icon={<Clock size={13} />}>{route.timeMin}분</Tag>
          <Tag>{route.surface}</Tag>
        </div>

        {/* 러너 & 후기 */}
        <div className="mt-3 rounded-2xl bg-tint/70 p-3">
          <div className="flex items-center gap-2">
            <span
              className="grid h-7 w-7 place-items-center rounded-full text-sm"
              style={{ background: route.runner.color }}
            >
              {route.runner.emoji}
            </span>
            <span className="text-[12.5px] font-semibold text-espresso">
              {route.runner.name}
            </span>
            <span className="text-[11px] text-espresso-soft">님의 코스</span>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-espresso-muted">
            “{route.review}”
          </p>
        </div>

        {/* 액션 */}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => api.toggleSaved(route.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-[13px] font-semibold transition active:scale-[0.98] ${
              saved
                ? 'bg-coral-50 text-coral-600'
                : 'border border-line bg-paper text-espresso-muted'
            }`}
          >
            <Heart size={15} fill={saved ? '#FF7A59' : 'none'} />
            {saved ? '저장됨' : '저장'}
            <span className="text-espresso-soft">· {route.saves + (saved ? 1 : 0)}</span>
          </button>
          <button className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-coral py-2.5 text-[13px] font-semibold text-white shadow-warm transition active:scale-[0.98]">
            <Users size={15} /> 함께 달리기
          </button>
        </div>
      </div>
    </article>
  );
}

function Tag({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sage-50 px-2.5 py-1 text-[11.5px] font-medium text-sage-600">
      {icon}
      {children}
    </span>
  );
}
