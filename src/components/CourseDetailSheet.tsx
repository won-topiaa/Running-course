import { useEffect } from 'react';
import {
  Heart,
  Lightbulb,
  MapPin,
  Moon,
  ShieldCheck,
  Timer,
  TrendingUp,
  X,
} from 'lucide-react';
import GradeElevationChart from './GradeElevationChart';
import KakaoLinkRow from './KakaoLinkRow';
import PathMap from './PathMap';
import ScenePhoto from './ScenePhoto';
import { sceneForCourse } from '../lib/scene';
import { estimateTimeLabel, formatDistance } from '../lib/format';
import {
  COURSE_TYPE_EMOJI,
  COURSE_TYPE_LABEL,
  ELEVATION_LABEL,
  LOOP_TYPE_LABEL,
  type Course,
} from '../lib/types';
import type { AppApi } from '../ui/appApi';

const AMENITIES: { key: keyof Course['amenities']; label: string; icon: string }[] = [
  { key: 'waterFountain', label: '식수대', icon: '🚰' },
  { key: 'restroom', label: '화장실', icon: '🚻' },
  { key: 'convenienceStore', label: '편의점', icon: '🏪' },
  { key: 'parking', label: '주차', icon: '🅿️' },
  { key: 'subwayAccess', label: '지하철', icon: '🚇' },
];

export default function CourseDetailSheet({
  course,
  api,
  onClose,
}: {
  course: Course;
  api: AppApi;
  onClose: () => void;
}) {
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
      <div className="relative z-10 max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-4xl bg-cream shadow-card sm:rounded-4xl">
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

          <p className="mt-3 text-[13.5px] leading-relaxed text-espresso-muted">
            {course.summary}
          </p>

          {/* 지도 */}
          <div className="mt-4 h-52 overflow-hidden rounded-3xl border border-line">
            <PathMap
              path={course.path}
              kakaoKey={api.settings.kakaoJsKey}
              mapboxToken={api.settings.mapboxToken}
            />
          </div>

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
              <span key={t} className="rounded-full bg-sage-50 px-3 py-1.5 text-[12px] font-medium text-sage-600">
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
                    className={course.amenities[a.key] ? 'text-espresso' : 'text-espresso-soft/50 line-through'}
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
                saved ? 'bg-coral-50 text-coral-600' : 'border border-line bg-paper text-espresso-muted'
              }`}
            >
              <Heart size={16} fill={saved ? 'currentColor' : 'none'} /> {saved ? '저장됨' : '저장'}
            </button>
            <button className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-full bg-coral py-3 text-[13.5px] font-semibold text-ink shadow-warm active:scale-[0.98]">
              이 코스로 뛰기
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
