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
const ROWS = 1000; // 한 번에 받을 행 수

/**
 * 기간을 나눠 받는 이유 — pageNo 는 측정 시기순이다.
 *
 * 예전엔 집단마다 1~3페이지를 연달아 받았는데, 실측해 보니 그건 사실상
 * '2023년 1~3월에 측정한 사람들' 한 시기의 표본이었다(page 1~3 의 test_ym 이
 * 202301~202303, page 30 은 202402, page 60 은 202503). 같은 남 20대인데
 * 시기에 따라 스텝 중앙값이 43.4~45.1 로 움직인다 — 한 분기만 보고 '또래
 * 기준' 이라고 부르면 그 분기의 특성이 그대로 기준이 된다.
 *
 * 연도별로 나눠 같은 양씩 받아 시기 쏠림을 없앤다. 서버가 기간 필터를
 * 지원하므로 추가 비용도 없다.
 */
const YEAR_SLICES = [
  // 2023년 이전은 받지 않는다 — VO₂max 가 아예 비어 있다(2011~2013 표본 0%).
  ['202301', '202312'],
  ['202401', '202412'],
  ['202501', '202512'],
  ['202601', '202612'],
];

const SEXES = [['male', 'M'], ['female', 'F']];
const AGE_CLASSES = [20, 30, 40, 50, 60, 70];

/**
 * VO₂max 는 측정 방식이 셋인데, 같은 통에 담으면 안 된다.
 *
 * 같은 집단 안에서 방식별 중앙값을 재 보면(2023~ 표본, 집단당 3,000행):
 *   남 20대  스텝 44.8 · 트레드밀 44.6 · 왕복 41.1
 *   남 30대  스텝 42.2 · 트레드밀 42.2 · 왕복 40.0
 *   여 40대  스텝 33.6 · 트레드밀 35.3 · 왕복 30.5
 * 스텝과 트레드밀은 사실상 같은 자를 쓰는데, 왕복오래달리기만 2~3 낮다.
 *
 * 우리가 견주려는 값(러닝 기록에서 낸 Cooper·Daniels 추정치)은 트레드밀
 * 최대운동부하검사를 기준으로 검증된 공식에서 나온다. 그래서 트레드밀과
 * 눈금이 맞는 스텝·트레드밀만 기준 분포로 쓰고, 왕복은 제외한다.
 * 섞어 두면 낮은 쪽 꼬리가 두꺼워져 백분위가 최대 8%p 까지 밀린다
 * (여 40대에서 12분 2,000m 가 상위 55% 대신 47% 로 나왔다).
 *
 * 한계는 분명히 해 둔다: 같은 사람을 두 방식으로 잰 게 아니라 서로 다른
 * 사람들의 분포를 견준 것이다. 어느 방식을 받을지가 체력과 무관하다는
 * 가정이 깔려 있다 — 트레드밀 표본의 중앙값이 스텝과 거의 같다는 점이
 * 그 가정을 어느 정도 뒷받침하지만, 증명은 아니다.
 */
const VO2_KEYS = { step: 'item_f037', treadmill: 'item_f035' };
const VO2_EXCLUDED = { shuttle: 'item_f030' }; // 눈금이 달라 제외 (개수만 기록)

// 응답 필드 → 우리 항목 (Swagger 명세 그대로, src/lib/kspoFitness.ts 의 SPEC 과 동일)
const ITEM_KEYS = {
  vo2max: Object.values(VO2_KEYS),
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
let dropped = 0;   // 범위 밖 (허리둘레 1cm, 멀리뛰기 2435cm 같은 입력 오류)
let unmeasured = 0; // 0·빈칸 — 그 항목을 안 잰 사람. 이상값이 아니다.

let excludedShuttle = 0;

for (const [sex, code] of SEXES) {
  for (const ageClass of AGE_CLASSES) {
    const samples = {};
    // VO₂max 는 방식별로도 세어 둔다 — 나중에 이 분포가 어디서 왔는지
    // 되짚을 수 있어야 한다. 근거를 못 대는 기준은 기준이 아니다.
    const vo2ByMethod = {};
    const months = new Set();
    let n = 0;
    for (const [startYm, endYm] of YEAR_SLICES) {
      const url =
        `${BASE}?serviceKey=${encodeURIComponent(KEY)}&pageNo=1&numOfRows=${ROWS}` +
        `&resultType=json&test_sex=${code}&age_class=${ageClass}` +
        `&starttest_ym=${startYm}&endtest_ym=${endYm}`;
      let json = null;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.error(`  ! HTTP ${res.status} — ${(await res.text()).slice(0, 160)}`);
          continue;
        }
        json = await res.json();
      } catch (e) {
        // 원인을 삼키지 않는다. 프록시 뒤에서 NODE_USE_ENV_PROXY 를 안 붙이면
        // 여기로 오는데, '인증키를 확인하라'고만 하면 엉뚱한 데를 파게 된다.
        console.error(`  ! 호출 실패: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      const rows = rowsOf(json);
      if (!rows || rows.length === 0) continue;
      totalRows += rows.length;
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        if (row.test_ym) months.add(String(row.test_ym));
        let used = false;
        for (const [item, keys] of Object.entries(ITEM_KEYS)) {
          const v = num(pick(row, keys));
          if (v == null) continue;
          const [lo, hi] = RANGE[item];
          // 0 은 '그 항목을 안 쟀다' 는 뜻이다. 범위 밖 이상값과 같이 세면
          // '48,000행 중 72,394개가 상식 밖' 같은 문장이 나와, 멀쩡한 데이터를
          // 쓰레기로 오해하게 만든다. 둘을 갈라 센다.
          if (v <= 0) { unmeasured++; continue; }
          if (v < lo || v > hi) { dropped++; continue; }
          (samples[item] ??= []).push(v);
          used = true;
        }
        // 어느 방식으로 잰 값인지 따로 센다
        for (const [method, key] of Object.entries(VO2_KEYS)) {
          const v = num(row[key]);
          if (v != null && v >= RANGE.vo2max[0] && v <= RANGE.vo2max[1]) {
            vo2ByMethod[method] = (vo2ByMethod[method] ?? 0) + 1;
          }
        }
        for (const key of Object.values(VO2_EXCLUDED)) {
          const v = num(row[key]);
          if (v != null && v >= RANGE.vo2max[0] && v <= RANGE.vo2max[1]) excludedShuttle++;
        }
        if (used) n++;
      }
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
      const ms = [...months].sort();
      norms.push({
        sex, ageBand: bandOf(ageClass), samples: quantized, counts, n,
        // 이 분포가 어떤 방식·어떤 시기에서 왔는지 함께 싣는다
        vo2Methods: vo2ByMethod,
        period: ms.length ? { from: ms[0], to: ms[ms.length - 1], months: ms.length } : null,
        source: SOURCE,
      });
      const detail = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ');
      const mDetail = Object.entries(vo2ByMethod).map(([k, v]) => `${k} ${v}`).join('/');
      console.log(`  ${label}: ${n}명 · ${detail}  [VO₂max ${mDetail} · ${ms.length}개월]`);
    } else {
      console.log(`  ${label}: 표본 없음`);
    }
  }
}

console.log(
  `\n총 ${totalRows}행 조회 · 미측정(0) ${unmeasured}개 · 범위 밖 ${dropped}개 제외 · ${norms.length}개 집단`,
);
console.log(`왕복오래달리기 ${excludedShuttle}건은 기준 분포에서 제외 (스텝·트레드밀과 눈금이 달라 2~3 낮게 나온다)`);
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
      period: `${YEAR_SLICES[0][0]}~${YEAR_SLICES[YEAR_SLICES.length - 1][1]}`,
      // 왜 이 표본만 썼는지를 데이터 옆에 남긴다 — 화면이 근거를 말할 수 있게
      vo2maxBasis:
        '심폐지구력은 스텝 검사(item_f037)와 트레드밀(item_f035) 측정값만 사용했습니다. ' +
        '왕복오래달리기(item_f030)는 같은 집단에서 중앙값이 2~3 낮게 나와 눈금이 달라 제외했습니다.',
      sampling: '연도별로 같은 양씩 나눠 받아 특정 시기에 쏠리지 않게 했습니다.',
      source: SOURCE,
      norms,
    },
    null,
    1,
  ),
);
console.log(`\n${OUT} 저장 완료 (${norms.length}개 집단)`);
console.log('이제 npm run build 하면 앱에 묶입니다. 서비스 키는 앱에 들어가지 않습니다.');
