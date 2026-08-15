// ---------------------------------------------------------------------------
// 체력 상태 훅 — 프로필 → 기준 분포 → 평가 → 처방
//
// 앱 전역에서 쓰는 값이라 App 에서 한 번만 계산해 AppApi 로 내려보낸다.
// 화면마다 부르면 같은 분포를 화면 수만큼 받아 오게 된다.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import {
  ageFromBirthYear,
  assess,
  prescribe,
  type FitnessAssessment,
  type FitnessNorm,
  type FitnessProfile,
  type RunPrescription,
} from './fitness';
import { loadFitnessNorm } from './kspoFitness';
import { estimateVo2max, type Vo2maxEstimate } from './vo2max';
import type { SavedRoute } from './savedRoutes';

export interface FitnessState {
  /** 만 나이 — 생년을 모르면 null */
  age: number | null;
  assessment: FitnessAssessment;
  /** 코스 추천에 실리는 처방. 근거가 없으면 null 이고, 그때는 체력 축이 빠진다 */
  prescription: RunPrescription | null;
  /** 기준 분포를 받아오는 중인지 (화면이 '불러오는 중'을 말할 수 있게) */
  loading: boolean;
  /**
   * 러닝 기록에서 추정한 VO₂max. 실측값이 있으면 평가에는 실측이 쓰이지만,
   * 이 값은 화면에 '앱 추정' 으로 따로 보여 준다.
   */
  vo2maxEstimate: Vo2maxEstimate | null;
}

export function useFitness(
  profile: FitnessProfile,
  serviceKey: string | null,
  /** 기록한 러닝 — VO₂max 추정 근거 */
  savedRoutes: SavedRoute[] = [],
): FitnessState {
  const [norm, setNorm] = useState<FitnessNorm | null>(null);
  const [loading, setLoading] = useState(false);

  const age = profile.birthYear != null ? ageFromBirthYear(profile.birthYear) : null;

  // 나이·성별이 있어야 어느 집단과 견줄지가 정해진다. 측정값이 하나도 없으면
  // 분포를 받아 봐야 쓸 데가 없으므로 호출하지 않는다 — 남의 서버를 괜히
  // 두드리지 않는다.
  // 러닝 기록에서 VO₂max 를 추정한다. 체력인증센터에 안 가 본 사람도
  // 출발선에 설 수 있게 하는 경로다 (대부분이 여기 해당한다).
  const vo2maxEstimate = useMemo(
    () =>
      estimateVo2max(
        savedRoutes
          .filter((r) => r.kind === 'recorded' && r.durationSec != null)
          .map((r) => ({
            distanceKm: r.distanceKm,
            durationSec: r.durationSec,
            at: r.createdAt,
            // 12분 테스트 표시를 함께 넘긴다. 이게 빠지면 테스트를 하고도
            // 늘 '참고용' 에 머문다 — 검사한 보람이 화면에 안 나타난다.
            isCooperTest: r.isCooperTest,
          })),
      ),
    [savedRoutes],
  );
  const estimates = useMemo(
    () => (vo2maxEstimate ? { vo2max: vo2maxEstimate.value } : {}),
    [vo2maxEstimate],
  );

  const hasMeasured =
    Object.values(profile.measured).some(
      (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
    ) || vo2maxEstimate != null;
  const sex = profile.sex;

  useEffect(() => {
    if (!sex || age == null || !hasMeasured) {
      setNorm(null);
      return;
    }
    let alive = true;
    setLoading(true);
    void loadFitnessNorm(serviceKey, sex, age)
      .then((n) => {
        if (alive) setNorm(n);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sex, age, hasMeasured, serviceKey]);

  return useMemo(() => {
    const assessment = assess(profile, norm, estimates);
    return {
      age,
      assessment,
      prescription: prescribe(assessment, age),
      loading,
      vo2maxEstimate,
    };
  }, [profile, norm, age, loading, estimates, vo2maxEstimate]);
}
