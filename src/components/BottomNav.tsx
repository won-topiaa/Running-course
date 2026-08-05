import { Bookmark, Compass, Home, Route, User } from 'lucide-react';

export type Screen = 'home' | 'explore' | 'build' | 'saved' | 'my';

const ITEMS: { id: Screen; label: string; icon: typeof Home }[] = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'explore', label: '탐색', icon: Compass },
  { id: 'build', label: '만들기', icon: Route },
  { id: 'saved', label: '저장', icon: Bookmark },
  { id: 'my', label: '마이', icon: User },
];

interface Props {
  active: Screen;
  onChange: (s: Screen) => void;
  savedCount: number;
}

export default function BottomNav({ active, onChange, savedCount }: Props) {
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-[1000] flex justify-center pb-[env(safe-area-inset-bottom)]">
      <div className="pointer-events-auto mx-3 mb-3 flex w-full max-w-md items-center justify-around rounded-full border border-line bg-paper/85 px-2 py-1.5 shadow-card backdrop-blur-md">
        {ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          const isCenter = id === 'build';
          if (isCenter) {
            return (
              <button
                key={id}
                onClick={() => onChange(id)}
                className="flex flex-col items-center"
                aria-label={label}
              >
                <span
                  className={`grid h-12 w-12 -translate-y-3 place-items-center rounded-full shadow-warm transition-transform active:scale-95 ${
                    isActive ? 'bg-coral-600' : 'bg-coral'
                  }`}
                >
                  <Icon className="h-6 w-6 text-white" strokeWidth={2.2} />
                </span>
                <span
                  className={`-mt-1 text-[10px] font-medium ${
                    isActive ? 'text-coral-600' : 'text-espresso-muted'
                  }`}
                >
                  {label}
                </span>
              </button>
            );
          }
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5"
              aria-label={label}
            >
              <Icon
                className={`h-[22px] w-[22px] transition-colors ${
                  isActive ? 'text-coral' : 'text-espresso-soft'
                }`}
                strokeWidth={isActive ? 2.4 : 2}
              />
              <span
                className={`text-[10px] transition-colors ${
                  isActive ? 'font-semibold text-espresso' : 'text-espresso-soft'
                }`}
              >
                {label}
              </span>
              {id === 'saved' && savedCount > 0 && (
                <span className="absolute right-1/2 top-0 translate-x-3 rounded-full bg-coral px-1.5 text-[9px] font-bold text-white">
                  {savedCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
