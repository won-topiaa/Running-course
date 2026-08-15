// ---------------------------------------------------------------------------
// 러닝 기록으로 VO₂max 추정
//
// 왜 필요한가: 체력 처방의 주축인 VO₂max 는 원래 체력인증센터에서 재는 값인데,
// 대부분의 사용자는 센터에 가 본 적이 없다. 그러면 이 기능은 소수만 쓰는
// 기능이 된다. 앱은 이미 GPS 로 거리·시간을 재고 있으므로, 그 기록에서
// 추정해 모두가 출발선에 설 수 있게 한다.
//
// ── 쓰는 공식 (둘 다 공개된 검증 공식) ─────────────────────────────────────
//
// 1) Daniels & Gilbert VDOT (Daniels' Running Formula)
//    러닝 코칭의 표준. 거리·시간 한 쌍에서 VO₂max 상당값을 낸다.
//      VO₂(v)   = -4.60 + 0.182258·v + 0.000104·v²        (v = m/분)
//      %VO₂max(t)= 0.8 + 0.1894393·e^(-0.012778·t)
//                     + 0.2989558·e^(-0.1932605·t)        (t = 분)
//      VDOT = VO₂(v) / %VO₂max(t)
//    검산: 5km 20:00 → 49.8 (Daniels 표와 일치)
//
// 2) Cooper 12분 달리기 (Cooper, 1968)
//    12분간 최대로 달린 거리로 낸다. 현장 검사의 고전.
//      VO₂max = (거리m - 504.9) / 44.73
//    검산: 12분 2400m → 42.4
//
// ── 정확도의 진짜 문제 ─────────────────────────────────────────────────────
// 두 공식 모두 '최대에 가까운 노력' 을 전제한다. 편하게 뛴 조깅을 넣으면
// 실제보다 훨씬 낮은 값이 나온다. 우리는 그 노력이 최대였는지 알 수 없다.
//
// 그래서 이렇게 다룬다:
//   · 기록 중 '가장 빠른 노력' 을 고른다 (최대에 가장 가까울 확률이 높다)
//   · 그래도 최대라는 보장이 없으므로 최소 추정치로 말한다 — "적어도 이 정도"
//   · 기록 수가 적을수록 신뢰도를 낮춰 표시한다
//   · 12분 테스트를 직접 하면 Cooper 로 제대로 잰다(그건 설계상 최대 노력이다)
//
// 실측값(체력인증센터)이 있으면 언제나 그쪽이 이긴다. 추정은 실측을 대신하는
// 게 아니라, 실측이 없는 사람을 위한 출발점이다.
// ---------------------------------------------------------------------------

/** 추정 방법 */
export type Vo2maxMethod = 'cooper' | 'daniels';

export interface Vo2maxEstimate {
  /** 추정 VO₂max (ml/kg/min) */
  value: number;
  method: Vo2maxMethod;
  /** 근거가 된 러닝 */
  basis: { distanceKm: number; durationSec: number; at: number };
  /**
   * 신뢰도. 최대 노력에 가까울수록·기록이 많을수록 높다.
   * 'high' 는 12분 테스트처럼 설계상 최대 노력일 때만 준다.
   */
  confidence: 'high' | 'medium' | 'low';
  /** 화면에 그대로 쓰는 근거 문장 */
  note: string;
}

/** Daniels & Gilbert: 속도(m/분)에서의 산소 소비량 */
export function danielsVo2At(metersPerMin: number): number {
  return -4.6 + 0.182258 * metersPerMin + 0.000104 * metersPerMin * metersPerMin;
}

/** Daniels & Gilbert: t분 동안 유지 가능한 VO₂max 비율 */
export function danielsPercentAt(minutes: number): number {
  return (
    0.8 +
    0.1894393 * Math.exp(-0.012778 * minutes) +
    0.2989558 * Math.exp(-0.1932605 * minutes)
  );
}

/**
 * 거리·시간 한 쌍에서 VDOT(=VO₂max 상당값).
 * 공식이 의미를 갖는 범위를 벗어나면 null 이다 — 억지로 숫자를 내지 않는다.
 */
export function danielsVdot(distanceKm: number, durationSec: number): number | null {
  if (!(distanceKm > 0) || !(durationSec > 0)) return null;
  const minutes = durationSec / 60;
  // 3분 미만·4시간 초과는 이 공식이 다루는 구간이 아니다
  if (minutes < 3 || minutes > 240) return null;
  const v = (distanceKm * 1000) / minutes;
  // 사람이 달리는 속도 범위 (100~500 m/분 ≈ 6~30 km/h)
  if (v < 100 || v > 500) return null;
  const vo2 = danielsVo2At(v);
  const pct = danielsPercentAt(minutes);
  if (!(pct > 0)) return null;
  const vdot = vo2 / pct;
  return Number.isFinite(vdot) ? Math.round(vdot * 10) / 10 : null;
}

/** Cooper 12분 달리기 — 12분간 달린 거리(m)로 VO₂max */
export function cooperVo2max(meters: number): number | null {
  if (!(meters > 504.9)) return null;
  const v = (meters - 504.9) / 44.73;
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

/** 12분 테스트 길이(초) — Cooper 프로토콜 그대로 */
export const COOPER_TEST_SEC = 12 * 60;

/** 12분 테스트로 인정할 시간 범위(초) — 오차를 감안해 조금 넉넉히 */
const COOPER_MIN_SEC = 11 * 60 + 30;
const COOPER_MAX_SEC = 12 * 60 + 30;

/**
 * 테스트 남은 시간(초). 아직 시작 전(startedAt=null)이면 전체 길이.
 *
 * 벽시계로 잰다 — 활성 시간(일시정지 제외)으로 재면 안 된다. Cooper 는
 * '12분 동안 간 거리' 인데, 멈춘 시간을 빼 주면 신호 대기마다 시계가 서고
 * 결국 12분보다 오래 달려 거리가 부풀려진다. 서 있었으면 그만큼 덜 간 게
 * 맞고, 그게 이 검사가 재려는 것이다.
 */
export function cooperRemainingSec(startedAt: number | null, now: number): number {
  if (startedAt == null) return COOPER_TEST_SEC;
  const left = COOPER_TEST_SEC - (now - startedAt) / 1000;
  return left > 0 ? left : 0;
}

/** 추정에 쓸 수 있는 러닝의 최소 조건 */
const MIN_DURATION_SEC = 6 * 60; // 너무 짧으면 GPS 오차 비중이 커진다
const MIN_DISTANCE_KM = 1.2;

/**
 * 사람이 낼 수 있는 VO₂max 의 하한 (fitness.ts 의 PLAUSIBLE_RANGE 와 같은 값).
 *
 * 여기서 한 번 더 막는 이유: 12분을 거의 걸어서 900m 를 갔다면 Cooper 공식은
 * 8.8 을 낸다. 그 값은 평가 단계(isPlausible)에서 어차피 버려지지만, 그 전에
 * 화면의 추정 카드에는 '내 심폐지구력 8.8' 이 그대로 찍힌다.
 */
const MIN_PLAUSIBLE_VO2 = 10;

export interface RunSummary {
  distanceKm: number;
  durationSec?: number;
  at: number;
  /** 12분 테스트로 뛴 기록인지 (앱이 안내한 테스트) */
  isCooperTest?: boolean;
}

/**
 * 기록들에서 VO₂max 를 추정한다.
 *
 * 12분 테스트 기록이 있으면 그걸 우선한다 — 설계상 최대 노력이라 가장 믿을
 * 만하다. 없으면 일반 기록 중 가장 좋은 노력을 Daniels 로 환산한다.
 */
export function estimateVo2max(runs: RunSummary[]): Vo2maxEstimate | null {
  // 1) 12분 테스트 — 있으면 이게 가장 정확하다.
  //
  //    일반 기록의 최소 거리(1.2km)를 여기엔 걸지 않는다. 12분에 1.1km 밖에
  //    못 간 사람도 자기가 직접 한 검사의 결과는 받아야 한다 — 그 사람이야말로
  //    '지금 내 몸이 어느 정도인지' 를 알아야 할 사람이다. 대신 사람이 낼 수
  //    있는 값의 하한을 밑돌면(=거의 걸었다면) 결과로 쓰지 않고 아래로 넘긴다.
  const tests = runs.filter(
    (r) =>
      r.isCooperTest &&
      typeof r.durationSec === 'number' &&
      r.durationSec >= COOPER_MIN_SEC &&
      r.durationSec <= COOPER_MAX_SEC &&
      r.distanceKm > 0,
  );
  if (tests.length > 0) {
    const best = tests.reduce((a, b) => (b.distanceKm > a.distanceKm ? b : a));
    const value = cooperVo2max(best.distanceKm * 1000);
    if (value != null && value >= MIN_PLAUSIBLE_VO2) {
      return {
        value,
        method: 'cooper',
        basis: { distanceKm: best.distanceKm, durationSec: best.durationSec!, at: best.at },
        confidence: 'high',
        note: `12분 달리기 테스트 ${best.distanceKm.toFixed(2)}km 기준 (Cooper 공식)`,
      };
    }
  }

  // 2) 일반 기록 중 가장 좋은 노력
  const usable = runs.filter(
    (r) =>
      typeof r.durationSec === 'number' &&
      r.durationSec >= MIN_DURATION_SEC &&
      r.distanceKm >= MIN_DISTANCE_KM,
  );
  if (usable.length === 0) return null;
  let best: { run: RunSummary; vdot: number } | null = null;
  for (const r of usable) {
    const vdot = danielsVdot(r.distanceKm, r.durationSec!);
    if (vdot == null) continue;
    if (!best || vdot > best.vdot) best = { run: r, vdot };
  }
  if (!best) return null;

  // 기록이 많을수록 그중 최고가 최대 노력에 가까울 확률이 높다.
  // 그래도 'high' 는 주지 않는다 — 최대였다는 보장이 없기 때문이다.
  const confidence = usable.length >= 5 ? 'medium' : 'low';
  const mm = Math.floor(best.run.durationSec! / 60);
  const ss = Math.round(best.run.durationSec! % 60);
  return {
    value: best.vdot,
    method: 'daniels',
    basis: {
      distanceKm: best.run.distanceKm,
      durationSec: best.run.durationSec!,
      at: best.run.at,
    },
    confidence,
    note:
      `기록 ${usable.length}개 중 가장 좋은 ${best.run.distanceKm.toFixed(2)}km ` +
      `${mm}분${ss > 0 ? ` ${ss}초` : ''} 기준 (Daniels·Gilbert 공식). ` +
      '최대로 달린 기록이 아니면 실제보다 낮게 나옵니다.',
  };
}

/** 신뢰도를 사람 말로 */
export const CONFIDENCE_LABEL: Record<Vo2maxEstimate['confidence'], string> = {
  high: '정확도 높음',
  medium: '참고용',
  low: '참고용(기록이 적어요)',
};
