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

import { fetchWithTimeout } from './fetchTimeout';
import {
  ageBandOf,
  type FitnessItem,
  type FitnessNorm,
  type Sex,
} from './fitness';

const BASE = 'https://apis.data.go.kr/B551014/SRVC_MSRMNT_RESULT';

/**
 * 응답 → 우리 항목 매핑.
 *
 * 실제 명세를 받으면 이 표만 고친다. 값이 여러 이름으로 올 수 있어 후보를
 * 배열로 둔다(포털 API 는 같은 데이터도 버전마다 필드명이 달라지곤 한다).
 */
const SPEC = {
  /** 목록을 감싸는 경로 후보 */
  itemsPath: [
    ['response', 'body', 'items', 'item'],
    ['response', 'body', 'items'],
    ['body', 'items', 'item'],
    ['items'],
  ],
  /** 성별 필드 후보와 값 해석 */
  sexKeys: ['sexdstn', 'sexdstnCode', 'sex', 'gender'],
  maleValues: ['M', '1', '남', '남성', 'male'],
  femaleValues: ['F', '2', '여', '여성', 'female'],
  /** 나이 필드 후보 */
  ageKeys: ['age', 'agrde', 'ageVl', 'measureAge'],
  /** 측정 항목 필드 후보 */
  itemKeys: {
    bodyFatPct: ['bdfatRt', 'bodyFatRt', 'bdfat'],
    waistCm: ['wstCrcmfrnc', 'waist', 'wstVl'],
    gripKg: ['grpStrgth', 'gripStrength', 'grip'],
    sitUpReps: ['stpUpCnt', 'sitUpCnt', 'curlUp'],
    jumpReps: ['rptJumpCnt', 'repeatJump', 'jumpCnt'],
  } as Record<FitnessItem, string[]>,
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
  const v = pickValue(row, SPEC.sexKeys);
  if (v == null) return null;
  const s = String(v).trim();
  if ((SPEC.maleValues as readonly string[]).includes(s)) return 'male';
  if ((SPEC.femaleValues as readonly string[]).includes(s)) return 'female';
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
    const age = toNumber(pickValue(row, SPEC.ageKeys));
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
export async function loadFitnessNorm(
  serviceKey: string | null,
  sex: Sex,
  age: number,
): Promise<FitnessNorm | null> {
  const ageBand = ageBandOf(age);
  const cached = readCache(sex, ageBand);
  if (cached) return cached;
  if (!serviceKey) return null;

  const url =
    `${BASE}?serviceKey=${encodeURIComponent(serviceKey)}` +
    `&pageNo=1&numOfRows=${FETCH_ROWS}&resultType=json`;

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
