import { Bookmark, Compass, Play, Route, User } from 'lucide-react';

/** 화면 탭. 'record' 는 화면이 아니라 기록 오버레이를 여는 액션이다. */
export type Screen = 'build' | 'explore' | 'saved' | 'my';

interface Props {
  active: Screen;
  onChange: (s: Screen) => void;
  onRecord: () => void;
  savedCount: number;
}

const LEFT: { id: Screen; label: string; icon: typeof Route }[] = [
  { id: 'build', label: '만들기', icon: Route },
  { id: 'explore', label: '추천', icon: Compass },
];
const RIGHT: { id: Screen; label: string; icon: typeof Route }[] = [
  { id: 'saved', label: '내 코스', icon: Bookmark },
  { id: 'my', label: '마이', icon: User },
];

export default function BottomNav({ active, onChange, onRecord, savedCount }: Props) {
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-[1000] flex justify-center pb-[env(safe-area-inset-bottom)]">
      <div className="pointer-events-auto mx-3 mb-3 flex w-full max-w-md items-center justify-around rounded-full border border-line bg-paper/85 px-2 py-1.5 shadow-card backdrop-blur-md">
        {LEFT.map((t) => (
          <Tab key={t.id} {...t} active={active === t.id} onClick={() => onChange(t.id)} />
        ))}

        {/* 중앙 강조 — 매일 쓰는 행동(뛰기) */}
        <button onClick={onRecord} className="flex flex-col items-center" aria-label="뛰기">
          <span className="grid h-12 w-12 -translate-y-3 place-items-center rounded-full bg-coral shadow-warm transition-transform active:scale-95">
            <Play className="h-5 w-5 text-ink" fill="currentColor" strokeWidth={2.2} />
          </span>
          <span className="-mt-1 text-[10px] font-semibold text-coral-600">뛰기</span>
        </button>

        {RIGHT.map((t) => (
          <Tab
            key={t.id}
            {...t}
            active={active === t.id}
            onClick={() => onChange(t.id)}
            badge={t.id === 'saved' ? savedCount : 0}
          />
        ))}
      </div>
    </nav>
  );
}

function Tab({
  label,
  icon: Icon,
  active,
  onClick,
  badge = 0,
}: {
  id: Screen;
  label: string;
  icon: typeof Route;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5"
      aria-label={label}
    >
      <Icon
        className={`h-[22px] w-[22px] transition-colors ${active ? 'text-coral' : 'text-espresso-soft'}`}
        strokeWidth={active ? 2.4 : 2}
      />
      <span
        className={`text-[10px] transition-colors ${
          active ? 'font-semibold text-espresso' : 'text-espresso-soft'
        }`}
      >
        {label}
      </span>
      {badge > 0 && (
        <span className="absolute right-1/2 top-0 translate-x-3 rounded-full bg-coral px-1.5 text-[9px] font-bold text-ink">
          {badge}
        </span>
      )}
    </button>
  );
}
