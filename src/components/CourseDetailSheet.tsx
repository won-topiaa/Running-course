import { useEffect, useState } from 'react';
import { Heart, Lightbulb, MapPin, Moon, ShieldCheck, Timer, TrendingUp, X } from 'lucide-react';
import GradeElevationChart from './GradeElevationChart';
import KakaoLinkRow from './KakaoLinkRow';
import PathMap from './PathMap';
import ScenePhoto from './ScenePhoto';
import { COURSES } from '../data/courses';
import { sceneForCourse } from '../lib/scene';
import { estimateTimeLabel, formatDistance } from '../lib/format';
import {
  COURSE_TYPE_EMOJI,
  COURSE_TYPE_LABEL,
  ELEVATION_LABEL,
  LOOP_TYPE_LABEL,
  type Course,
} from '../lib/types';
import {
  fallbackProvider,
  makeProvider,
  type RouteResult,
  type RoutingProvider,
} from '../lib/routing';
import type { AppApi } from '../ui/appApi';

const AMENITIES: { key: keyof Course['amenities']; label: string; icon: string }[] = [
  { key: 'waterFountain', label: '식수대', icon: '🚰' },
  { key: 'restroom', label: '화장실', icon: '🚻' },
  { key: 'convenienceStore', label: '편의점', icon: '🏪' },
  { key: 'parking', label: '주차', icon: '🅿️' },
  { key: 'subwayAccess', label: '지하철', icon: '🚇' },
];

// 코스별 실제 보행 경로 캐시 — 시트를 다시 열어도 재요청하지 않는다
const realRouteCache = new Map<string, RouteResult>();

/**
 * courseId 를 받아 여기서 찾는다. App 이 COURSES 를 직접 쓰면 큐레이션
 * 데이터셋이 첫 로딩 번들에 통째로 들어간다 — 정작 첫 화면에는 안 쓰는데.
 */
export default function CourseDetailSheet({
  courseId,
  api,
  onClose,
}: {
  courseId: string;
  api: AppApi;
  onClose: () => void;
}) {
  const course = COURSES.find((c) => c.id === courseId);
  if (!course) return null;
  return <Sheet course={course} api={api} onClose={onClose} />;
}

function Sheet({ course, api, onClose }: { course: Course; api: AppApi; onClose: () => void }) {
  // 큐레이션 데이터의 path 는 손으로 딴 대략 폴리곤이라 지도에 그대로 그리면
  // 도로와 무관한 다각형이 나온다. 열 때마다 실제 보행 경로로 스냅해 보여주고,
  // 실패하면 지도를 아예 숨긴다 — 가짜 도형을 보여주는 것보다 없는 게 낫다.
  const [real, setReal] = useState<RouteResult | null>(() => realRouteCache.get(course.id) ?? null);
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    if (realRouteCache.has(course.id)) {
      setReal(realRouteCache.get(course.id)!);
      return;
    }
    let alive = true;
    (async () => {
      const pts = course.loopType === 'loop' ? [...course.path, course.path[0]] : course.path;
      let provider: RoutingProvider | null = makeProvider(api.settings.orsKey);
      while (provider && provider.realRoads) {
        try {
          const r = await provider.route(pts);
          if (!alive) return;
          realRouteCache.set(course.id, r);
          setReal(r);
          return;
        } catch {
          provider = fallbackProvider(provider); // ORS → OSRM. 직선 데모는 안 쓴다.
        }
      }
      if (alive) setMapFailed(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const saved = api.isSaved(course.id);
  const n = course.elevation.profile.length;
  const segLen = (course.distanceKm * 1000) / (n - 1);
  const lengthsM = Array.from({ length: n - 1 }, () => segLen);
  const paceTime = estimateTimeLabel(course.distanceKm, api.settings.paceSecPerKm);

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[calc(100vh-env(safe-area-inset-top,0px)-1.5rem)] w-full max-w-md overflow-y-auto rounded-t-4xl bg-cream shadow-card sm:max-h-[92vh] sm:rounded-4xl">
        {/* 헤더 이미지 */}
        <ScenePhoto scene={sceneForCourse(course)} className="h-44 w-full">
          <div className="flex h-full flex-col justify-between p-4">
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-full bg-ink/70 text-white shadow-soft backdrop-blur active:scale-90"
                aria-label="닫기"
              >
                <X size={18} />
              </button>
            </div>
            <div>
              <h2 className="text-[21px] font-extrabold leading-tight text-white drop-shadow">
                {course.name}
              </h2>
              <p className="mt-0.5 flex items-center gap-1 text-[12.5px] font-medium text-white/90 drop-shadow">
                <MapPin size={13} /> {course.area}
              </p>
            </div>
          </div>
        </ScenePhoto>

        <div className="p-4">
          {/* 요약 스탯 */}
          <div className="flex flex-wrap gap-2">
            <Pill>{formatDistance(course.distanceKm)}</Pill>
            <Pill>{ELEVATION_LABEL[course.elevation.category]}</Pill>
            <Pill>{LOOP_TYPE_LABEL[course.loopType]}</Pill>
            <Pill icon={<Timer size={12} />}>약 {paceTime}</Pill>
          </div>

          <p className="mt-3 text-[13.5px] leading-relaxed text-espresso-muted">{course.summary}</p>

          {/* 지도 — 실제 보행 경로를 받아왔을 때만 보여준다 */}
          {!mapFailed &&
            (real ? (
              <div className="mt-4 h-52 overflow-hidden rounded-3xl border border-line">
                <PathMap
                  path={real.coords}
                  kakaoKey={api.settings.kakaoJsKey}
                  mapboxToken={api.settings.mapboxToken}
                />
              </div>
            ) : (
              <div className="mt-4 h-52 animate-pulse rounded-3xl border border-line bg-tint/60" />
            ))}

          {/* 고도 */}
          <div className="mt-4 rounded-3xl border border-line bg-paper p-4 shadow-soft">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-espresso">
              <TrendingUp size={15} className="text-coral" /> 고도 · 경사
            </div>
            <GradeElevationChart
              elevations={course.elevation.profile}
              lengthsM={lengthsM}
              distanceKm={course.distanceKm}
              ascentM={course.elevation.gainM}
            />
          </div>

          {/* 취향 태그 */}
          <div className="mt-4 flex flex-wrap gap-2">
            {course.courseTypes.map((t) => (
              <span
                key={t}
                className="rounded-full bg-sage-50 px-3 py-1.5 text-[12px] font-medium text-sage-600"
              >
                {COURSE_TYPE_EMOJI[t]} {COURSE_TYPE_LABEL[t]}
              </span>
            ))}
          </div>

          {/* 안전 · 편의 */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <InfoBox icon={<ShieldCheck size={15} className="text-sage-600" />} title="안전 · 조명">
              가로등 {course.safety.lighting}/5 · {course.safety.cctv ? 'CCTV 있음' : 'CCTV 적음'}
              <br />
              {course.safety.nightFriendly ? (
                <span className="inline-flex items-center gap-1 text-sage-600">
                  <Moon size={11} /> 야간 러닝 적합
                </span>
              ) : (
                <span className="text-espresso-soft">야간엔 조명 약함</span>
              )}
            </InfoBox>
            <InfoBox icon={<span className="text-sm">🚰</span>} title="편의시설">
              <div className="flex flex-wrap gap-1">
                {AMENITIES.map((a) => (
                  <span
                    key={a.key}
                    className={
                      course.amenities[a.key]
                        ? 'text-espresso'
                        : 'text-espresso-soft/50 line-through'
                    }
                  >
                    {a.icon}
                  </span>
                ))}
              </div>
            </InfoBox>
          </div>

          {/* 경관 */}
          <div className="mt-3 rounded-3xl border border-line bg-paper p-4 text-[12.5px] text-espresso-muted shadow-soft">
            <span className="font-bold text-espresso">경관 </span>
            {course.scenery.tags.join(' · ')}
          </div>

          {/* 카카오맵 링크 */}
          <KakaoLinkRow name={course.name} point={course.path[0]} className="mt-4" />

          {/* 팁 */}
          <div className="mt-3 flex gap-2 rounded-3xl bg-coral-50 p-4">
            <Lightbulb size={16} className="mt-0.5 shrink-0 text-coral-600" />
            <p className="text-[12.5px] leading-relaxed text-espresso-muted">{course.tips}</p>
          </div>

          {/* 액션 */}
          <div className="mt-4 flex gap-2 pb-2">
            <button
              onClick={() => api.toggleSaved(course.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 text-[13.5px] font-semibold transition active:scale-[0.98] ${
                saved
                  ? 'bg-coral-50 text-coral-600'
                  : 'border border-line bg-paper text-espresso-muted'
              }`}
            >
              <Heart size={16} fill={saved ? 'currentColor' : 'none'} /> {saved ? '저장됨' : '저장'}
            </button>
            <button
              onClick={() => {
                // 실제 경로가 있으면 따라 뛰기, 아직/실패면 그 자리 자유 러닝으로 시작
                if (real) api.startRecord({ name: course.name, route: real });
                else api.startRecord();
                onClose();
              }}
              className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-full bg-coral py-3 text-[13.5px] font-semibold text-ink shadow-warm active:scale-[0.98]"
            >
              {real ? '이 코스 따라 뛰기' : '이 코스로 뛰기'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Pill({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-tint px-3 py-1.5 text-[12px] font-semibold text-espresso">
      {icon}
      {children}
    </span>
  );
}

function InfoBox({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-line bg-paper p-3.5 shadow-soft">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-espresso">
        {icon} {title}
      </div>
      <div className="text-[12px] leading-relaxed text-espresso-muted">{children}</div>
    </div>
  );
}
