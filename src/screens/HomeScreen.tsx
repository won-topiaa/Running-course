import { useMemo, useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import ConditionsCard from '../components/ConditionsCard';
import RouteFeedCard from '../components/RouteFeedCard';
import { FEED, MOOD_TAGS } from '../data/feed';
import type { AppApi } from '../ui/appApi';

export default function HomeScreen({ api }: { api: AppApi }) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
  }, []);

  const feed = useMemo(() => {
    return FEED.filter((r) => {
      if (tag && !r.moodTags.includes(tag)) return false;
      if (query.trim()) {
        const q = query.trim();
        const hay = `${r.title} ${r.area} ${r.moodTags.join(' ')}`;
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [query, tag]);

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-28 pt-5">
      {/* 헤더 */}
      <header className="mb-4">
        <p className="text-[12.5px] font-medium text-espresso-soft">{today}</p>
        <h1 className="mt-0.5 text-[26px] font-extrabold leading-tight tracking-tightish text-espresso">
          오늘 달릴 길을
          <br />
          찾아보세요 <span className="text-coral">🌿</span>
        </h1>
      </header>

      {/* 오늘의 러닝 컨디션 */}
      <ConditionsCard c={api.conditions} />

      {/* 검색 */}
      <div className="mt-4 flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-3 shadow-soft">
        <Search size={18} className="text-espresso-soft" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="동네, 코스, 감성 태그로 검색"
          className="w-full bg-transparent text-[14px] text-espresso outline-none placeholder:text-espresso-soft"
        />
      </div>

      {/* 무드 태그 필터 */}
      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={tag === null} onClick={() => setTag(null)}>
          <Sparkles size={13} /> 전체
        </Chip>
        {MOOD_TAGS.map((t) => (
          <Chip key={t} active={tag === t} onClick={() => setTag(tag === t ? null : t)}>
            {t}
          </Chip>
        ))}
      </div>

      {/* 피드 */}
      <div className="mt-4 flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-espresso">
          {tag ? `${tag} 코스` : '러너들이 공유한 코스'}
        </h2>
        <span className="text-[12px] text-espresso-soft">{feed.length}개</span>
      </div>

      <div className="mt-3 space-y-4">
        {feed.map((r) => (
          <RouteFeedCard key={r.id} route={r} api={api} />
        ))}
        {feed.length === 0 && (
          <p className="rounded-3xl border border-dashed border-line bg-paper/60 p-8 text-center text-[13px] text-espresso-soft">
            조건에 맞는 코스가 아직 없어요.
            <br />
            다른 태그로 찾아볼까요?
          </p>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3.5 py-2 text-[12.5px] font-medium transition active:scale-95 ${
        active
          ? 'bg-coral text-white shadow-warm'
          : 'border border-line bg-paper text-espresso-muted'
      }`}
    >
      {children}
    </button>
  );
}
