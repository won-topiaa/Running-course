// 국민체력100 기준 분포 수집 — 빌드 전에 한 번 돌린다.
//
//   KSPO_SERVICE_KEY=발급받은키 node scripts/fetch-fitness-norm.mjs
//   (또는)  node scripts/fetch-fitness-norm.mjs 발급받은키
//
// 프록시 뒤에서는 NODE_USE_ENV_PROXY=1 을 붙인다 — node 의 내장 fetch 는
// HTTPS_PROXY 를 스스로 보지 않아, 안 붙이면 전부 조용히 실패한다.
//
// 왜 런타임이 아니라 여기서 받는가:
//   1) 공공데이터포털 API 는 CORS 헤더를 주지 않는 경우가 많다. 브라우저에서
//      직접 부르면 차단돼 사용자 화면에서는 아무것도 못 받는다.
//   2) 클라이언트 앱에 서비스 키를 넣으면 번들에 그대로 실려 누구나 꺼내 쓸 수
//      있다 — 일일 호출 한도가 남의 손에 털린다.
//   3) 기준 분포는 자주 바뀌지 않는다(포털 수정일도 연 단위). 한 번 받아 묶어
//      두면 앱이 즉시 뜨고 오프라인에서도 돈다.
//
// 결과물: src/data/fitnessNorm.json  (앱이 정적으로 import 한다)
//
// 이 스크립트는 진단도 겸한다 — 응답의 실제 필드명을 그대로 찍어 주므로,
// 매핑이 안 맞으면 무엇으로 고쳐야 하는지 바로 보인다.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const KEY = process.env.KSPO_SERVICE_KEY || process.argv[2];
if (!KEY) {
  console.error('서비스 키가 필요합니다.\n  KSPO_SERVICE_KEY=... node scripts/fetch-fitness-norm.mjs');
  process.exit(1);
}

const BASE = 'https://apis.data.go.kr/B551014/SRVC_NFA_TEST_RESULT/TODZ_NFA_TEST_RESULT_NEW';
const OUT = 'src/data/fitnessNorm.json';
const ROWS = 1000;          // 한 번에 받을 행 수
const PAGES_PER_COHORT = 3; // 집단당 페이지 수 (최대 3,000행)
// 2023년 이후만 쓴다. 그 전 데이터에는 VO₂max 가 아예 없다(실측: 2011~2013 표본 0%).
const START_YM = '202301';
const END_YM = '209912';

const SEXES = [['male', 'M'], ['female', 'F']];
const AGE_CLASSES = [20, 30, 40, 50, 60, 70];

// 응답 필드 → 우리 항목 (Swagger 명세 그대로, src/lib/kspoFitness.ts 의 SPEC 과 동일)
const ITEM_KEYS = {
  vo2max: ['item_f037', 'item_f030', 'item_f035'], // 스텝·왕복·트레드밀 중 받은 것
  bodyFatPct: ['item_f003'],
  longJumpCm: ['item_f022'],
  gripKg: ['item_f007', 'item_f008'], // 절대악력(f052)은 값이 0% 라 좌·우를 쓴다
  waistCm: ['item_f004'],
};
// 사람이 낼 수 있는 범위 — 밖이면 버린다 (실측에 허리둘레 1cm, 멀리뛰기 2435cm 가 섞여 있다)
const RANGE = {
  vo2max: [10, 90],
  bodyFatPct: [3, 60],
  longJumpCm: [50, 380],
  gripKg: [5, 100],
  waistCm: [40, 160],
};

const dig = (o, path) => path.reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const rowsOf = (j) => {
  for (const p of [['response', 'body', 'items', 'item'], ['response', 'body', 'items']]) {
    const v = dig(j, p);
    if (Array.isArray(v)) return v;
  }
  return null;
};
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const pick = (row, keys) => {
  for (const k of keys) if (row[k] != null && row[k] !== '') return row[k];
};
const bandOf = (a) => (a < 20 ? '10대' : a >= 70 ? '70대 이상' : `${Math.floor(a / 10) * 10}대`);

const SOURCE = '국민체육진흥공단 「국민체력100 체력인증센터 측정결과」(공공데이터포털 15108938)';
const norms = [];
let totalRows = 0;
let dropped = 0;

for (const [sex, code] of SEXES) {
  for (const ageClass of AGE_CLASSES) {
    const samples = {};
    let n = 0;
    for (let page = 1; page <= PAGES_PER_COHORT; page++) {
      const url =
        `${BASE}?serviceKey=${encodeURIComponent(KEY)}&pageNo=${page}&numOfRows=${ROWS}` +
        `&resultType=json&test_sex=${code}&age_class=${ageClass}` +
        `&starttest_ym=${START_YM}&endtest_ym=${END_YM}`;
      let json = null;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.error(`  ! HTTP ${res.status} — ${(await res.text()).slice(0, 160)}`);
          break;
        }
        json = await res.json();
      } catch (e) {
        // 원인을 삼키지 않는다. 프록시 뒤에서 NODE_USE_ENV_PROXY 를 안 붙이면
        // 여기로 오는데, '인증키를 확인하라'고만 하면 엉뚱한 데를 파게 된다.
        console.error(`  ! 호출 실패: ${e instanceof Error ? e.message : e}`);
        break;
      }
      const rows = rowsOf(json);
      if (!rows || rows.length === 0) break;
      totalRows += rows.length;
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        let used = false;
        for (const [item, keys] of Object.entries(ITEM_KEYS)) {
          const v = num(pick(row, keys));
          if (v == null) continue;
          const [lo, hi] = RANGE[item];
          if (v < lo || v > hi) { dropped++; continue; } // 상식 밖 값은 버린다
          (samples[item] ??= []).push(v);
          used = true;
        }
        if (used) n++;
      }
      if (rows.length < ROWS) break;
    }
    // 원본 표본을 통째로 묶으면 파일이 754KB 가 된다(앱 전체 JS 가 243KB 다).
    // 백분위 조회에 필요한 건 분포의 모양이지 개별 값이 아니므로, 101개
    // 백분위 지점(p0~p100)만 남긴다 — 1% 해상도면 '상위 몇 %' 에 충분하다.
    const quantized = {};
    const counts = {};
    for (const k of Object.keys(samples)) {
      const arr = samples[k].sort((a, b) => a - b);
      counts[k] = arr.length;
      if (arr.length <= 101) {
        quantized[k] = arr;
      } else {
        quantized[k] = Array.from({ length: 101 }, (_, i) =>
          arr[Math.min(arr.length - 1, Math.round((i / 100) * (arr.length - 1)))],
        );
      }
    }
    const label = `${sex === 'male' ? '남' : '여'} ${bandOf(ageClass)}`;
    if (n > 0) {
      norms.push({ sex, ageBand: bandOf(ageClass), samples: quantized, counts, n, source: SOURCE });
      const detail = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ');
      console.log(`  ${label}: ${n}명 · ${detail}`);
    } else {
      console.log(`  ${label}: 표본 없음`);
    }
  }
}

console.log(`\n총 ${totalRows}행 조회 · 상식 밖 값 ${dropped}개 제외 · ${norms.length}개 집단`);
if (norms.length === 0) {
  console.error('표본을 만들지 못했습니다.');
  console.error('  · 프록시 뒤라면: NODE_USE_ENV_PROXY=1 을 붙였는지 확인');
  console.error('  · 그 외에는 인증키 승인 상태와 위에 찍힌 오류 메시지 확인');
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString().slice(0, 10),
      endpoint: BASE,
      period: `${START_YM}~`,
      source: SOURCE,
      norms,
    },
    null,
    1,
  ),
);
console.log(`\n${OUT} 저장 완료 (${norms.length}개 집단)`);
console.log('이제 npm run build 하면 앱에 묶입니다. 서비스 키는 앱에 들어가지 않습니다.');
