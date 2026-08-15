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

export interface FitnessState {
  /** 만 나이 — 생년을 모르면 null */
  age: number | null;
  assessment: FitnessAssessment;
  /** 코스 추천에 실리는 처방. 근거가 없으면 null 이고, 그때는 체력 축이 빠진다 */
  prescription: RunPrescription | null;
  /** 기준 분포를 받아오는 중인지 (화면이 '불러오는 중'을 말할 수 있게) */
  loading: boolean;
}

export function useFitness(
  profile: FitnessProfile,
  serviceKey: string | null,
): FitnessState {
  const [norm, setNorm] = useState<FitnessNorm | null>(null);
  const [loading, setLoading] = useState(false);

  const age = profile.birthYear != null ? ageFromBirthYear(profile.birthYear) : null;

  // 나이·성별이 있어야 어느 집단과 견줄지가 정해진다. 측정값이 하나도 없으면
  // 분포를 받아 봐야 쓸 데가 없으므로 호출하지 않는다 — 남의 서버를 괜히
  // 두드리지 않는다.
  const hasMeasured = Object.values(profile.measured).some(
    (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
  );
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
    const assessment = assess(profile, norm);
    return {
      age,
      assessment,
      prescription: prescribe(assessment.overall, age),
      loading,
    };
  }, [profile, norm, age, loading]);
}
