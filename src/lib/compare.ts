// ---------------------------------------------------------------------------
// 후보 코스끼리 비교해 '이 코스만의 장점' 한 마디를 붙인다.
//
// 후보 셋이 다 '5.0km · 상승 20m' 처럼 비슷하게 적혀 있으면 무엇을 고를지
// 알 수 없어서 결국 1번을 누르게 된다. 그래서 서로 비교해서 최상급을 찾는다.
//
// 중요한 건 '차이가 의미 있을 때만' 붙이는 것이다. 1m 차이로 '가장 평탄'
// 이라고 하면 안 붙이느니만 못하다 — 사용자는 그 말을 믿고 고르기 때문에
// 근거가 약하면 그냥 침묵하는 편이 정직하다.
//
// 화면(BuildScreen)에서 떼어 둔 이유는 이 판단을 눈이 아니라 검사로 확인하기
// 위해서다 (scripts/output-check.mjs).
// ---------------------------------------------------------------------------

export interface Comparable {
  /** 누적 상승(m) */
  ascentM: number;
  /** 목표 거리 근접도 0~1 (핀 모드처럼 목표가 없으면 전부 1) */
  distanceScore: number;
  /** 숲길 비율(%) — 아직 안 왔거나 못 구했으면 null */
  greenPct: number | null;
}

/** 이만큼은 차이가 나야 '가장 ~' 이라고 말한다 */
const MIN_ASCENT_GAP_M = 10;
const MIN_GREEN_GAP_PCT = 10;
const MIN_GREEN_PCT = 20;
const MIN_DISTANCE_GAP = 0.05;

export function superlatives(items: Comparable[]): (string | null)[] {
  const out: (string | null)[] = items.map(() => null);
  if (items.length < 2) return out;

  // 한 후보가 두 가지 최상급을 다 가져가면 두 번째는 버린다. 차점자에게
  // 넘기면 '가장 평탄'이 제일 평탄하지 않은 코스에 붙는 거짓말이 된다.
  const put = (i: number, label: string) => {
    if (i >= 0 && out[i] == null) out[i] = label;
  };

  // 숲길 — 전부 값이 와 있을 때만 비교한다. 일부만 도착한 상태에서 비교하면
  // '아직 안 온 후보'가 자동으로 지는 셈이라 결과가 거짓이 된다.
  const green = items.map((it) => it.greenPct);
  if (green.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) {
    const max = Math.max(...green);
    if (max >= MIN_GREEN_PCT && max - Math.min(...green) >= MIN_GREEN_GAP_PCT) {
      put(green.indexOf(max), '🌳 숲길 최다');
    }
  }

  const asc = items.map((it) => it.ascentM);
  if (Math.max(...asc) - Math.min(...asc) >= MIN_ASCENT_GAP_M) {
    put(asc.indexOf(Math.min(...asc)), '가장 평탄');
  }

  const dist = items.map((it) => it.distanceScore);
  if (Math.max(...dist) - Math.min(...dist) >= MIN_DISTANCE_GAP) {
    put(dist.indexOf(Math.max(...dist)), '목표에 가장 가까움');
  }

  return out;
}
