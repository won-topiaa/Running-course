import { useMemo } from 'react';
import { TrainFront } from 'lucide-react';
import {
  destinationsFrom,
  nearbyStations,
  formatStationDistance,
  linesAtStation,
  lineOf,
  type LineStation,
} from '../lib/subway';
import type { LatLng } from '../lib/types';

/**
 * 역에서 역으로 — 출발역과 도착역만 고르면 그 사이 경로는 앱이 잡는다.
 *
 * 고르는 순서를 출발 → 도착으로 묶어 한 화면에 둔다. 출발역은 현재 위치에서
 * 가까운 순으로 먼저 보여 주므로, 대개 첫 칩을 누르면 끝난다.
 */
export default function StationPicker({
  center,
  origin,
  destination,
  onOrigin,
  onDestination,
}: {
  /** 출발역 후보를 찾을 기준점 (보통 현재 위치) */
  center: LatLng;
  origin: LineStation | null;
  destination: LineStation | null;
  onOrigin: (s: LineStation | null) => void;
  onDestination: (s: LineStation | null) => void;
}) {
  const near = useMemo(() => nearbyStations(center, 4000, 8), [center]);
  const dests = useMemo(() => (origin ? destinationsFrom(origin) : []), [origin]);

  // 환승역이면 어느 노선으로 뛸지 고를 수 있어야 한다 —
  // 같은 '왕십리' 라도 2호선과 5호선은 완전히 다른 방향으로 간다.
  const transferLines = useMemo(
    () => (origin ? linesAtStation(origin.name) : []),
    [origin],
  );

  return (
    <div className="space-y-3">
      {/* 1) 출발역 */}
      <div>
        <p className="mb-1.5 text-[11.5px] font-semibold text-espresso-muted">
          출발역{' '}
          <span className="font-normal text-espresso-soft">
            {origin ? '· 눌러서 바꾸기' : '· 가까운 순'}
          </span>
        </p>
        {near.length === 0 ? (
          <p className="rounded-2xl bg-tint/60 px-3 py-2.5 text-[11.5px] leading-relaxed text-espresso-soft">
            근처 4km 안에 역이 없어요. 지도를 눌러 서울 쪽으로 옮기면 역이 나와요.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {near.map((s) => {
              const on = origin?.name === s.name;
              return (
                <button
                  key={`${s.line}-${s.name}`}
                  onClick={() => {
                    onOrigin(on ? null : s);
                    onDestination(null);
                  }}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[12px] font-semibold active:scale-95 ${
                    on
                      ? 'border-transparent bg-espresso text-cream'
                      : 'border-line text-espresso-muted'
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.name}
                  <span className="font-normal opacity-70">
                    {formatStationDistance(s.distanceM)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 2) 환승역이면 노선 고르기 */}
      {origin && transferLines.length > 1 && (
        <div>
          <p className="mb-1.5 text-[11.5px] font-semibold text-espresso-muted">
            어느 노선으로 <span className="font-normal text-espresso-soft">· 환승역이에요</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {transferLines.map((ln) => {
              const line = lineOf(ln);
              const st = line?.stations.find((s) => s.name === origin.name);
              if (!line || !st) return null;
              const on = origin.line === ln;
              return (
                <button
                  key={ln}
                  onClick={() => {
                    onOrigin({ ...st, line: line.line, lineName: line.name, color: line.color });
                    onDestination(null);
                  }}
                  className={`rounded-full border px-2.5 py-1.5 text-[12px] font-bold active:scale-95 ${
                    on ? 'border-transparent text-cream' : 'border-line text-espresso-muted'
                  }`}
                  style={on ? { backgroundColor: line.color } : undefined}
                >
                  {line.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 3) 도착역 */}
      {origin && (
        <div>
          <p className="mb-1.5 text-[11.5px] font-semibold text-espresso-muted">
            어디까지{' '}
            <span className="font-normal text-espresso-soft">
              · {origin.lineName} · 가까운 순
            </span>
          </p>
          {dests.length === 0 ? (
            <p className="rounded-2xl bg-tint/60 px-3 py-2.5 text-[11.5px] leading-relaxed text-espresso-soft">
              이 역에서 뛸 만한 거리(0.8~12km)에 같은 노선 역이 없어요.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {dests.map((s) => {
                const on = destination?.name === s.name;
                return (
                  <button
                    key={s.name}
                    onClick={() => onDestination(on ? null : s)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[12px] font-semibold active:scale-95 ${
                      on
                        ? 'border-transparent bg-espresso text-cream'
                        : 'border-line text-espresso-muted'
                    }`}
                  >
                    {s.name}
                    <span className="font-normal opacity-70">
                      {formatStationDistance(s.distanceM)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-espresso-soft">
            거리는 직선 기준이라 실제 코스는 조금 더 길어요. 길은 앱이 신호등·경사를 보고 골라요.
          </p>
        </div>
      )}

      {/* 4) 고른 결과 — 돌아오는 방법까지 말해 준다 */}
      {origin && destination && (
        <div className="flex items-start gap-2 rounded-2xl bg-sage-50/60 px-3 py-2.5">
          <TrainFront size={14} className="mt-0.5 shrink-0 text-sage-600" />
          <p className="text-[11.5px] leading-relaxed text-espresso-muted">
            <b className="text-espresso">
              {origin.name} → {destination.name}
            </b>{' '}
            · {origin.lineName}
            <br />
            도착하면 {destination.name}역에서 지하철로 돌아올 수 있어요. 힘들면 중간 역에서
            그만둬도 돼요.
          </p>
        </div>
      )}
    </div>
  );
}
