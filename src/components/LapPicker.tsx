// ---------------------------------------------------------------------------
// 바퀴 수 고르기
//
// "좋은 코스를 찾으면 여러 번 뛰고 싶다" 는 베타 피드백에서 나왔다.
// 새 코스를 찾는 게 아니라 이미 마음에 든 경로를 그대로 반복하는 것이므로,
// 라우터를 다시 부르지 않고 좌표를 이어 붙인다(routing.repeatRoute).
//
// 시작점으로 돌아오는 경로에만 보인다. 편도를 반복하면 끝점에서 시작점으로
// 순간이동하는 선이 생기고, 그 직선거리가 총거리에 얹히며, 음성은 있지도
// 않은 길을 안내한다 — 그건 기능이 아니라 오류다.
// ---------------------------------------------------------------------------

import { Minus, Plus, RotateCw } from 'lucide-react';
import { formatDistance } from '../lib/format';

/** 바퀴 수 상한 — 이 이상은 '한 바퀴를 더 긴 코스로' 만드는 게 낫다 */
export const MAX_LAPS = 10;

export default function LapPicker({
  laps,
  onChange,
  lapKm,
  className = '',
}: {
  laps: number;
  onChange: (n: number) => void;
  /** 한 바퀴 거리(km) */
  lapKm: number;
  className?: string;
}) {
  const set = (n: number) => onChange(Math.max(1, Math.min(MAX_LAPS, n)));
  return (
    <div
      className={`flex items-center justify-between rounded-2xl border border-line bg-cream px-3 py-2.5 ${className}`}
    >
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-espresso">
        <RotateCw size={14} className="text-coral" /> 바퀴 수
      </span>
      <div className="flex items-center gap-2">
        {/* 합계를 늘 함께 보여준다 — 사용자가 정하려는 건 바퀴 수가 아니라
            오늘 뛸 거리다. 곱셈을 머리로 시키지 않는다. */}
        <span className="text-[12px] tabular-nums text-espresso-muted">
          {laps > 1 ? `${formatDistance(lapKm)} × ${laps} =` : ''}{' '}
          <b className="text-[13.5px] text-espresso">{formatDistance(lapKm * laps)}</b>
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => set(laps - 1)}
            disabled={laps <= 1}
            aria-label="바퀴 수 줄이기"
            className="grid h-8 w-8 place-items-center rounded-full border border-line bg-paper text-espresso active:scale-90 disabled:opacity-35"
          >
            <Minus size={14} />
          </button>
          <span className="w-6 text-center text-[15px] font-black tabular-nums text-espresso">
            {laps}
          </span>
          <button
            onClick={() => set(laps + 1)}
            disabled={laps >= MAX_LAPS}
            aria-label="바퀴 수 늘리기"
            className="grid h-8 w-8 place-items-center rounded-full border border-line bg-paper text-espresso active:scale-90 disabled:opacity-35"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
