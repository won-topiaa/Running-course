// 길 성격(waytype/surface) 해석 · 더위 판정 · 더 나은 시간대 찾기 검증.
//   node scripts/local-features-check.mjs
// esbuild(vite 의존성)로 TS 를 즉석에서 묶어 브라우저 없이 돌린다.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// node 의 fetch 는 HTTPS_PROXY 를 스스로 보지 않는다 — 프록시 뒤에서 실호출을
// 하려면 명시적으로 붙여야 한다(없으면 그냥 직접 연결).
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxy) {
  try {
    const { setGlobalDispatcher, ProxyAgent } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(proxy));
  } catch {
    /* undici 가 없으면 그대로 진행 — 실호출은 샘플 폴백으로 건너뛴다 */
  }
}

const dir = mkdtempSync(join(tmpdir(), 'lf-'));
const bundle = async (entry, name) => {
  const out = join(dir, name);
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    outfile: out,
    logLevel: 'error',
  });
  return import(out);
};

const { parseWayMix, wayMixLabel } = await bundle('src/lib/wayMix.ts', 'w.mjs');
const { evaluatePath } = await bundle('src/lib/routeStyle.ts', 's.mjs');

const ok = [];
const bad = [];
const check = (c, m) => {
  (c ? ok : bad).push(m);
  console.log((c ? '  ✅ ' : '  ❌ ') + m);
};

// ── 1) ORS extras 해석 ──────────────────────────────────────────────────────
console.log('\n[길 성격] ORS extras → 러너 말');
// 실제 ORS 응답에서 그대로 가져온 모양 (서울 시청→성북 4.35km)
const realExtras = {
  waytype: {
    summary: [
      { value: 3, distance: 1787.8, amount: 41.09 }, // Street
      { value: 7, distance: 1715.6, amount: 39.43 }, // Footway
      { value: 4, distance: 644.8, amount: 14.82 }, // Path
      { value: 1, distance: 122.7, amount: 2.82 }, // State Road
      { value: 6, distance: 79.9, amount: 1.84 }, // Cycleway
    ],
  },
  surface: {
    summary: [
      { value: 0, distance: 3698.2, amount: 85.0 }, // Unknown
      { value: 14, distance: 442.5, amount: 10.17 }, // Paving Stones
      { value: 3, distance: 210.1, amount: 4.83 }, // Asphalt
    ],
  },
};
const mix = parseWayMix(realExtras);
console.log('   ', JSON.stringify(mix), '→', wayMixLabel(mix));
check(mix.trailPct === 56, `보행자 길 ${mix.trailPct}% (Footway+Path+Cycleway = 39.43+14.82+1.84)`);
check(mix.roadPct === 44, `차도 ${mix.roadPct}% (Street+StateRoad = 41.09+2.82)`);
check(mix.softPct === 0, '흙길 0% (포장만 있음)');
check(mix.stepsM === 0, '계단 없음');

const trailHeavy = parseWayMix({
  waytype: {
    summary: [
      { value: 7, distance: 4000, amount: 92 },
      { value: 8, distance: 120, amount: 8 },
    ],
  },
  surface: { summary: [{ value: 11, distance: 2000, amount: 46 }] },
});
console.log('   ', JSON.stringify(trailHeavy), '→', wayMixLabel(trailHeavy));
check(trailHeavy.trailPct === 92 && trailHeavy.stepsM === 120, '계단 길이를 따로 집계');
check(trailHeavy.softPct === 46, '흙 노면 비율 집계');

check(parseWayMix(undefined) === null, 'extras 없으면 null (OSRM·오프라인)');
check(parseWayMix({ waytype: { summary: [] } }) === null, '빈 summary 도 null');

// ── 2) 취향 점수 ────────────────────────────────────────────────────────────
console.log('\n[취향] 길 성격 점수');
const routeWith = (way) => ({ way, distanceKm: 5, ascentM: 30, maxGradePct: 4, segments: [] });
const anyEval = evaluatePath(routeWith(mix), 'any');
check(anyEval.score === null, "'상관없음'은 점수를 안 낸다(가중치에서 빠짐)");
check(evaluatePath(routeWith(undefined), 'trail').score === null, 'way 정보 없으면 점수 null');

const t1 = evaluatePath(routeWith(mix), 'trail');
const t2 = evaluatePath(routeWith(trailHeavy), 'trail');
console.log(`    산책로 56% → ${t1.score.toFixed(2)} / 92%(계단 120m) → ${t2.score.toFixed(2)}`);
check(t2.score > t1.score, '보행자 길 비율이 높을수록 높은 점수');
const noSteps = evaluatePath(routeWith({ ...trailHeavy, stepsM: 0 }), 'trail');
check(
  noSteps.score > t2.score,
  `계단은 감점 (${t2.score.toFixed(2)} < ${noSteps.score.toFixed(2)})`,
);

const s1 = evaluatePath(routeWith(mix), 'soft');
const s2 = evaluatePath(routeWith(trailHeavy), 'soft');
console.log(`    흙길 0% → ${s1.score.toFixed(2)} / 46% → ${s2.score.toFixed(2)}`);
check(s2.score > s1.score, '흙길 비율이 높을수록 높은 점수');
check(!!t1.reason && !!s1.reason, '사람이 읽을 이유 문장 생성');

// ── 3) 더위·자외선 판정 + 더 나은 시간대 ───────────────────────────────────
console.log('\n[한국 여름] 더위 판정 · 뛰기 좋은 시간');
const { getConditions, sampleConditions } = await bundle('src/lib/weather.ts', 'wx.mjs');

// 폴백(샘플)에도 새 필드가 있어야 UI 가 안 깨진다
const sample = sampleConditions();
check(
  typeof sample.uvIndex === 'number' && sample.heatRisk === 'none' && sample.advice === null,
  '샘플 폴백도 새 필드를 채운다 (선선 → 조언 없음)',
);

// 실제 Open-Meteo 호출 (키 불필요). 네트워크가 막히면 건너뛴다.
const seoul = await getConditions([37.5665, 126.978]);
if (seoul.source === 'sample') {
  console.log('  ⏭  네트워크 차단 — 실호출 검증 생략');
} else {
  console.log(
    `    지금 체감 ${seoul.feelsC}° · 자외선 ${seoul.uvIndex} · 미세먼지 ${seoul.aqiLabel} → ${seoul.heatRisk}`,
  );
  if (seoul.betterHour) {
    console.log(
      `    더 나은 시간: ${seoul.betterHour.hour}시 (${seoul.betterHour.inHours}시간 뒤) 체감 ${seoul.betterHour.feelsC}° 강수 ${seoul.betterHour.rainPct}%`,
    );
  }
  check(Number.isFinite(seoul.uvIndex), '실호출에서 자외선 지수 수신');
  check(['none', 'caution', 'danger'].includes(seoul.heatRisk), '더위 등급 산출');
  check(
    seoul.heatRisk === 'none' ? seoul.advice === null : typeof seoul.advice === 'string',
    '위험할 때만 조언 문장이 생긴다',
  );
  check(
    !seoul.betterHour || seoul.betterHour.feelsC <= seoul.feelsC - 2,
    '추천 시간대는 지금보다 체감 2° 이상 시원할 때만',
  );
  check(
    !seoul.betterHour || (seoul.betterHour.inHours >= 1 && seoul.betterHour.inHours <= 12),
    '추천 시간대는 1~12시간 내',
  );
}

console.log(`\n통과 ${ok.length} / 실패 ${bad.length}`);
if (bad.length) process.exit(1);
