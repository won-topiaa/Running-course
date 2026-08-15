// ---------------------------------------------------------------------------
// 국민체력100 체력인증센터 측정결과 — 기준 분포 로더
//
// 공공데이터포털 15108938 (서울올림픽기념국민체육진흥공단)
//   https://www.data.go.kr/data/15108938/openapi.do
//   · 무료 · 이용허락범위 제한 없음
//   · 제공: 나이구분/연령/상장구분/측정항목(신장·체중·체지방률·허리둘레·혈압·
//          악력·윗몸말아올리기·반복점프 등)/측정연월/운동처방
//
// 하는 일: 같은 성별·연령대의 측정값을 모아 오름차순 표본(FitnessNorm)으로
// 만든다. 백분위 계산은 fitness.ts 가 한다.
//
// ── 아직 못 채운 것 ────────────────────────────────────────────────────────
// 요청/응답 필드 이름은 활용신청(로그인 필요) 뒤에 나오는 명세를 봐야 정확히
// 알 수 있다. 그 전까지 추측한 이름을 코드에 박아 두면, 나중에 안 맞을 때
// '왜 안 되는지' 를 찾기 어렵다. 그래서 매핑을 SPEC 한 곳에 모아 두고,
// 명세를 받으면 여기만 고치면 되게 했다. 키가 없거나 응답이 예상과 다르면
// 조용히 null 을 돌려준다 — 체력 축이 빠질 뿐 앱은 그대로 돈다.
// ---------------------------------------------------------------------------

import bundled from '../data/fitnessNorm.json';
import { fetchWithTimeout } from './fetchTimeout';
import {
  ageBandOf,
  type FitnessItem,
  type FitnessNorm,
  type Sex,
} from './fitness';

// 활용신청 승인 화면의 End Point 를 그대로 쓴다 (2026-08-15 승인 기준).
// 데이터포맷 JSON+XML — resultType=json 으로 JSON 을 받는다.
const BASE = 'https://apis.data.go.kr/B551014/SRVC_NFA_TEST_RESULT';

/**
 * 응답 → 우리 항목 매핑.
 *
 * 실제 명세를 받으면 이 표만 고친다. 값이 여러 이름으로 올 수 있어 후보를
 * 배열로 둔다(포털 API 는 같은 데이터도 버전마다 필드명이 달라지곤 한다).
 */
const SPEC = {
  /** 오퍼레이션명 — 활용신청 상세기능정보의 경로 (2026-08-15 실호출 확인) */
  operation: '/TODZ_NFA_TEST_RESULT_NEW',
  /** 목록 경로 */
  itemsPath: [
    ['response', 'body', 'items', 'item'],
    ['response', 'body', 'items'],
  ],
  /** 성별 — 응답은 'M'/'F', 요청 파라미터도 같은 값을 받는다 */
  sexKey: 'test_sex',
  maleValue: 'M',
  femaleValue: 'F',
  /** 나이 — age_degree 가 실제 나이, age_class 가 연령대(요청 필터용) */
  ageKey: 'age_degree',
  ageClassKey: 'age_class',
  /** 측정 항목 → 응답 필드 (Swagger 명세 그대로) */
  itemKeys: {
    // VO₂max 는 세 검사(스텝·왕복오래달리기·트레드밀) 중 받은 것에만 값이
    // 있다. 셋 다 같은 단위(ml/kg/min)라 먼저 나오는 값을 쓴다 — 실측에서
    // 셋을 합치면 2023년 이후 거의 전원이 하나는 갖고 있다.
    vo2max: ['item_f037', 'item_f030', 'item_f035'],
    bodyFatPct: ['item_f003'],
    longJumpCm: ['item_f022'],
    // 절대악력(f052)은 명세에 있어도 값이 0% 라 좌·우 악력을 쓴다
    gripKg: ['item_f007', 'item_f008'],
    waistCm: ['item_f004'],
  } as Record<FitnessItem, string[]>,
  /** 운동처방 내용 — 공단이 측정 결과에 맞춰 내려 준 텍스트 */
  prescriptionKey: 'pres_note',
} as const;

const CACHE_KEY = 'runcourse.fitnessNorm.v1';
/** 기준 분포는 자주 바뀌지 않는다 — 30일 캐시 (포털 수정일도 연 단위다) */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 백분위를 낼 만큼 모으되, 모바일에서 한 번에 받기엔 부담 없는 크기 */
const FETCH_ROWS = 1000;

interface CacheEntry {
  at: number;
  norm: FitnessNorm;
}

function cacheIdOf(sex: Sex, ageBand: string): string {
  return `${CACHE_KEY}.${sex}.${ageBand}`;
}

function readCache(sex: Sex, ageBand: string): FitnessNorm | null {
  try {
    const raw = localStorage.getItem(cacheIdOf(sex, ageBand));
    if (!raw) return null;
    const e = JSON.parse(raw) as CacheEntry;
    if (!e || typeof e.at !== 'number' || Date.now() - e.at > CACHE_TTL_MS) return null;
    // 모양이 깨진 캐시는 버린다 — 그대로 쓰면 백분위 계산에서 터진다
    if (!e.norm || typeof e.norm.n !== 'number' || !e.norm.samples) return null;
    return e.norm;
  } catch {
    return null;
  }
}

function writeCache(norm: FitnessNorm): void {
  try {
    localStorage.setItem(
      cacheIdOf(norm.sex, norm.ageBand),
      JSON.stringify({ at: Date.now(), norm } satisfies CacheEntry),
    );
  } catch {
    /* 용량 초과 등 — 캐시는 없어도 그만이다 */
  }
}

/** 중첩 객체에서 첫 번째로 맞는 경로를 찾아 배열을 꺼낸다 */
function pickArray(json: unknown, paths: readonly (readonly string[])[]): unknown[] | null {
  for (const path of paths) {
    let cur: unknown = json;
    for (const key of path) {
      if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[key];
      } else {
        cur = undefined;
        break;
      }
    }
    if (Array.isArray(cur)) return cur;
  }
  return null;
}

function pickValue(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (k in row && row[k] != null && row[k] !== '') return row[k];
  }
  return undefined;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function sexOf(row: Record<string, unknown>): Sex | null {
  const v = row[SPEC.sexKey];
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (s === SPEC.maleValue) return 'male';
  if (s === SPEC.femaleValue) return 'female';
  return null;
}

/**
 * 응답 행들을 성별·연령대로 걸러 오름차순 표본으로 만든다.
 * 파싱은 export 해 둔다 — 실제 응답 없이도 검사 스크립트가 이 변환을 검증한다.
 */
export function normFromRows(
  rows: unknown[],
  sex: Sex,
  ageBand: string,
  source: string,
): FitnessNorm {
  const samples: Partial<Record<FitnessItem, number[]>> = {};
  let n = 0;

  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const row = r as Record<string, unknown>;
    if (sexOf(row) !== sex) continue;
    const age = toNumber(row[SPEC.ageKey]);
    if (age == null || ageBandOf(age) !== ageBand) continue;

    let used = false;
    for (const item of Object.keys(SPEC.itemKeys) as FitnessItem[]) {
      const v = toNumber(pickValue(row, SPEC.itemKeys[item]));
      // 0 은 '측정 안 함' 으로 들어오는 경우가 많다 — 표본에 넣으면 분포가 왜곡된다
      if (v == null || v <= 0) continue;
      (samples[item] ??= []).push(v);
      used = true;
    }
    if (used) n++;
  }

  for (const key of Object.keys(samples) as FitnessItem[]) {
    samples[key]!.sort((a, b) => a - b);
  }
  return { sex, ageBand, samples, n, source };
}

/**
 * 같은 성별·연령대의 기준 분포를 가져온다.
 * 키가 없거나 응답이 예상과 다르면 null — 호출부는 체력 축을 빼고 돌아간다.
 */
/**
 * 빌드 시점에 묶어 둔 기준 분포에서 찾는다 (scripts/fetch-fitness-norm.mjs).
 *
 * 이게 기본 경로다 — 포털 API 는 CORS 헤더를 주지 않는 경우가 많아 브라우저
 * 에서 직접 부르면 차단되고, 클라이언트에 서비스 키를 넣으면 번들에 그대로
 * 실려 일일 한도가 털린다. 분포는 자주 바뀌지 않으니 묶어 두는 편이 낫다.
 */
function bundledNorm(sex: Sex, ageBand: string): FitnessNorm | null {
  const list = (bundled as { norms?: FitnessNorm[] }).norms;
  if (!Array.isArray(list)) return null;
  const hit = list.find((n) => n.sex === sex && n.ageBand === ageBand);
  return hit && hit.n > 0 ? hit : null;
}

export async function loadFitnessNorm(
  serviceKey: string | null,
  sex: Sex,
  age: number,
): Promise<FitnessNorm | null> {
  const ageBand = ageBandOf(age);
  // 묶어 둔 값이 있으면 그걸 쓴다 — 네트워크도 키도 필요 없다
  const packed = bundledNorm(sex, ageBand);
  if (packed) return packed;

  const cached = readCache(sex, ageBand);
  if (cached) return cached;
  // 키를 직접 넣은 경우(개발·검증용)에만 실시간 호출을 시도한다
  if (!serviceKey) return null;

  // 또래 필터를 서버에 맡긴다 — 294만 건을 다 받아 거르는 건 말이 안 된다.
  // age_class 는 연령대(20·30·40…), test_sex 는 M/F 를 그대로 받는다.
  const ageClass = Math.floor(age / 10) * 10;
  const url =
    `${BASE}${SPEC.operation}?serviceKey=${encodeURIComponent(serviceKey)}` +
    `&pageNo=1&numOfRows=${FETCH_ROWS}&resultType=json` +
    `&test_sex=${sex === 'male' ? SPEC.maleValue : SPEC.femaleValue}` +
    `&age_class=${ageClass}`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    const rows = pickArray(json, SPEC.itemsPath);
    if (!rows || rows.length === 0) return null;

    const norm = normFromRows(
      rows,
      sex,
      ageBand,
      '국민체육진흥공단 「국민체력100 체력인증센터 측정결과」(공공데이터포털)',
    );
    // 표본이 모자라면 캐시도 하지 않는다 — 다음에 더 받아 볼 기회를 남긴다
    if (norm.n === 0) return null;
    writeCache(norm);
    return norm;
  } catch {
    return null;
  }
}
