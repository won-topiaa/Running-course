// 길 성격(waytype/surface) 해석 · 더위 판정 · 더 나은 시간대 찾기 검증.
//   node scripts/local-features-check.mjs
// esbuild(vite 의존성)로 TS 를 즉석에서 묶어 브라우저 없이 돌린다.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// node 의 내장 fetch 는 프록시 환경변수를 스스로 보지 않는다. 프록시 뒤에서
// 실호출까지 확인하려면 NODE_USE_ENV_PROXY=1 을 붙여 실행한다(node 22.21+).
//   NODE_USE_ENV_PROXY=1 npm run check:local
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;

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

// 시간대 처리 — 응답의 시각 문자열은 '그 지역'의 로컬 시각이다. 기기 시간대가
// 다르면(해외에서 서울 코스를 볼 때) 몇 시간이 통째로 어긋난다. 응답을 고정해
// 두고, 이 컨테이너(UTC)에서도 KST 기준으로 맞게 읽는지 본다.
{
  const realFetch = globalThis.fetch;
  const OFFSET = 32400; // KST +9h
  const now = Date.now();
  const pad = (n) => String(n).padStart(2, '0');
  // '지역 로컬' 시각 문자열을 만든다 (UTC + 9h)
  const localStr = (msFromNow) => {
    const d = new Date(now + msFromNow + OFFSET * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00`;
  };
  const times = [0, 1, 2, 3, 4, 5].map((h) => localStr(h * 3_600_000));
  globalThis.fetch = async (url) => {
    if (String(url).includes('air-quality'))
      return { ok: true, json: async () => ({ current: { pm2_5: 11, pm10: 20 } }) };
    return {
      ok: true,
      json: async () => ({
        current: {
          temperature_2m: 34,
          apparent_temperature: 36,
          relative_humidity_2m: 70,
          weather_code: 0,
          wind_speed_10m: 6,
          precipitation: 0,
          uv_index: 9,
        },
        utc_offset_seconds: OFFSET,
        hourly: {
          time: times,
          apparent_temperature: [36, 35, 34, 30, 29, 28],
          uv_index: [9, 7, 5, 2, 0, 0],
          precipitation_probability: [10, 10, 10, 10, 10, 10],
        },
      }),
    };
  };
  const tz = await getConditions([37.5665, 126.978]);
  globalThis.fetch = realFetch;
  // 가장 시원한 시각(마지막, 체감 28°)을 골라야 한다
  const expectHour = Number(times[5].slice(11, 13));
  console.log(
    `    고정 응답(KST +9, 기기는 UTC): ${tz.heatRisk} · 추천 ${tz.betterHour?.hour}시 (${tz.betterHour?.inHours}시간 뒤) 체감 ${tz.betterHour?.feelsC}°`,
  );
  check(tz.heatRisk === 'danger', '체감 36°·UV 9 → 위험');
  check(
    tz.betterHour?.hour === expectHour,
    `추천 시각을 지역 시각으로 표시 (${tz.betterHour?.hour}시 = ${expectHour}시)`,
  );
  // 오프셋을 안 빼면 5+9=14시간 뒤가 되어 12시간 창을 벗어나 betterHour 가
  // 통째로 사라진다 — 그게 이 검사의 핵심이다. 정각으로 자른 시각이라
  // 지금이 몇 분이냐에 따라 4~5시간 뒤로 나오는 건 정상이다.
  check(tz.betterHour != null, '기기 시간대(UTC)와 지역(KST)이 달라도 추천 시각을 찾는다');
  check(
    tz.betterHour != null && tz.betterHour.inHours >= 4 && tz.betterHour.inHours <= 6,
    `'몇 시간 뒤'가 지역 시각 기준으로 계산됨 (${tz.betterHour?.inHours}시간 뒤)`,
  );
  check(tz.betterHour?.feelsC === 28, '후보 중 가장 시원한 시각을 고른다');
  // 문구 자체가 아니라 '무엇이 담겼는지'를 본다 — 표현을 다듬을 때마다
  // 검사가 깨지면 안 되고, 정작 중요한 건 체감·추천 시각이 한 줄에 다 있는지다.
  // (첫 화면 맨 위에 뜨는 줄이라 두 줄이 되면 그만큼 지도가 줄어든다)
  const adv = tz.advice ?? '';
  check(
    adv.includes(`체감 ${Math.round(tz.feelsC)}°`) &&
      adv.includes(`${tz.betterHour?.hour}시`) &&
      adv.length <= 45,
    `위험 문구에 체감·추천 시각이 한 줄로 (${adv.length}자) — "${adv}"`,
  );
}

// 실제 Open-Meteo 호출 (키 불필요). 네트워크가 막히면 건너뛴다.
const seoul = await getConditions([37.5665, 126.978]);
if (seoul.source === 'sample') {
  console.log(
    proxy && !process.env.NODE_USE_ENV_PROXY
      ? '  ⏭  실호출 생략 — 프록시 뒤라면 NODE_USE_ENV_PROXY=1 을 붙여 다시 실행하세요'
      : '  ⏭  네트워크에 못 나가 실호출 검증 생략',
  );
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

// ── 4) 숲길 비율 (그늘로가 건물 그림자로 푸는 문제의 근사) ─────────────────
console.log('\n[숲길] Overpass 폴리곤 판정');
const { parseGreenPolys, greenShareOf, sampleAlong } = await bundle(
  'src/lib/greenShare.ts',
  'g.mjs',
);

// 서울시청 근처에 한 변 ~440m 짜리 정사각 '공원'을 하나 놓는다
const LA = 37.5665;
const LN = 126.978;
const D = 0.002; // 위도 0.002° ≈ 222m
const square = (cla, cln, d) => [
  { lat: cla - d, lon: cln - d },
  { lat: cla - d, lon: cln + d },
  { lat: cla + d, lon: cln + d },
  { lat: cla + d, lon: cln - d },
  { lat: cla - d, lon: cln - d },
];
const polys = parseGreenPolys({
  elements: [{ type: 'way', tags: { leisure: 'park' }, geometry: square(LA, LN, D) }],
});
check(polys.length === 1, 'way 지오메트리 → 폴리곤 1개');

// 공원을 완전히 가로지르는 직선(동→서). 양 끝은 공원 밖.
const across = [
  [LA, LN - D * 3],
  [LA, LN + D * 3],
];
const acrossPct = greenShareOf(across, polys);
console.log(`    공원 폭의 3배를 가로지름 → 숲길 ${acrossPct}% (기대 ≈33%)`);
check(Math.abs(acrossPct - 33) <= 6, `가로지르는 비율이 기하학과 맞음 (${acrossPct}%)`);

// 공원 안에만 있는 경로
const insideRoute = [
  [LA - D * 0.5, LN - D * 0.5],
  [LA + D * 0.5, LN + D * 0.5],
];
check(greenShareOf(insideRoute, polys) === 100, '공원 안 경로는 100%');

// 공원에서 멀리 떨어진 경로
const outside = [
  [LA + D * 5, LN + D * 5],
  [LA + D * 6, LN + D * 6],
];
check(greenShareOf(outside, polys) === 0, '공원 밖 경로는 0%');
check(greenShareOf(across, []) === 0, '폴리곤이 없으면 0%');

// relation(멤버 링) 파싱 + inner(구멍) 무시
const rel = parseGreenPolys({
  elements: [
    {
      type: 'relation',
      members: [
        { role: 'outer', geometry: square(LA, LN, D) },
        { role: 'inner', geometry: square(LA, LN, D * 0.2) },
      ],
    },
  ],
});
check(rel.length === 1, 'relation 은 outer 링만 폴리곤으로 (inner 무시)');

// 샘플링: 간격과 상한
const long = [
  [LA, LN],
  [LA + 0.09, LN], // 약 10km
];
const pts = sampleAlong(long, 40);
console.log(`    10km 경로 → 샘플 ${pts.length}개`);
check(pts.length <= 260, `샘플 개수 상한 지킴 (${pts.length}개)`);
check(pts.length >= 200, '10km 를 충분히 촘촘하게 찍음');
const short = sampleAlong(
  [
    [LA, LN],
    [LA + 0.0009, LN],
  ],
  40,
); // 약 100m
console.log(`    100m 경로 → 샘플 ${short.length}개 (40m 간격)`);
check(short.length >= 3 && short.length <= 5, `짧은 경로는 40m 간격 유지 (${short.length}개)`);

check(parseGreenPolys(null).length === 0, '깨진 응답은 빈 목록');
check(
  parseGreenPolys({ elements: [{ type: 'way', geometry: [{ lat: 1, lon: 1 }] }] }).length === 0,
  '점 3개 미만은 폴리곤이 아님',
);


console.log('\n[길 성격] 여러 개를 함께 고를 수 있는가');
{
  const S = await bundle('src/lib/routeStyle.ts', 'rs-multi.mjs');
  const R = (trailPct, softPct) => ({
    distanceKm: 5, ascentM: 0, maxGradePct: 0, segments: [], coords: [], elevations: [],
    way: { trailPct, softPct, roadPct: 100 - trailPct, stepsM: 0 },
  });
  const good = R(85, 60);   // 천변 흙산책로 — 둘 다 만족
  const paved = R(85, 2);   // 천변 포장길
  const dirt = R(10, 60);   // 산속 흙길이지만 신호등 많음
  const city = R(10, 2);    // 도심 대로변

  check(S.evaluatePath(good, []).score === null, "아무것도 안 고르면 이 축을 빼고 계산한다");
  check(S.evaluatePath(good, 'any').score === null, "'any' 한 개도 같은 뜻이다 (예전 호출 방식)");
  check(S.evaluatePath(good, 'trail').score === S.evaluatePath(good, ['trail']).score,
    '문자열 하나와 배열 하나가 같은 점수를 낸다');

  // 둘 다 고르면, 둘 다 잘하는 경로가 1등이어야 한다 — 이게 이 기능의 전부다
  const both = (r) => S.evaluatePath(r, ['trail', 'soft']).score;
  const ranked = [['천변 흙산책로', good], ['산속 흙길', dirt], ['천변 포장길', paved], ['도심 대로변', city]]
    .map(([n, r]) => ({ n, s: both(r) }))
    .sort((a, b) => b.s - a.s);
  check(ranked[0].n === '천변 흙산책로' && ranked[3].n === '도심 대로변',
    `둘 다 고르면 둘 다 만족하는 코스가 1등 (${ranked.map((x) => `${x.n} ${x.s.toFixed(2)}`).join(' > ')})`);
  // 한 축만 잘하는 코스는 중간이다 — 최솟값을 쓰면 0 이 되어 순위가 무의미해진다
  check(both(paved) > both(city) && both(paved) < both(good),
    '한 축만 만족하면 중간 점수 (거르는 기준이 아니라 순위 가중치다)');
  // 설명은 고른 항목 수만큼 나온다
  check(S.evaluatePath(good, ['trail', 'soft']).reason.includes('보행자') &&
        S.evaluatePath(good, ['trail', 'soft']).reason.includes('흙'),
    '둘 다 고르면 설명도 둘 다 나온다');
}

console.log('\n[바퀴 수] 같은 코스를 여러 번');
{
  const RT = await bundle('src/lib/routing.ts', 'rt-laps.mjs');
  const G = await bundle('src/lib/geo.ts', 'g-laps.mjs');
  const P = (x, y) => [37.5 + y / 111320, 127.0 + x / (111320 * Math.cos((37.5 * Math.PI) / 180))];
  const mk = (c) => RT.buildResult(c, c.map(() => 10), 'offline', [c[0]]);

  const ring = [];
  for (let k = 0; k <= 32; k++) {
    const a = (2 * Math.PI * k) / 32;
    ring.push(P(300 * Math.cos(a), 300 * Math.sin(a)));
  }
  const out = [];
  for (let m = 0; m <= 800; m += 25) out.push(P(m, 0));
  const back = [...out, ...out.slice(0, -1).reverse()];
  const oneWay = [];
  for (let m = 0; m <= 1000; m += 25) oneWay.push(P(m, m * 0.2));

  const loop = mk(ring), ob = mk(back), ow = mk(oneWay);
  check(RT.returnsToStart(loop) && RT.returnsToStart(ob), '순환·왕복은 시작점으로 돌아온다');
  // 편도를 반복하면 끝점→시작점 순간이동 선이 생긴다. 기능이 아니라 오류다.
  check(!RT.returnsToStart(ow), '편도는 바퀴 선택 대상이 아니다');

  for (const [label, rt] of [['순환', loop], ['왕복', ob]]) {
    for (const n of [1, 2, 3, 5]) {
      const rep = RT.repeatRoute(rt, n);
      const measured = G.pathLengthMeters(rep.coords) / 1000;
      const err = Math.abs(measured - rt.distanceKm * n) / (rt.distanceKm * n);
      check(err < 0.001, `${label} ${n}바퀴: 좌표로 잰 거리가 표기와 일치 (오차 ${(err * 100).toFixed(2)}%)`);
      check(rep.coords.length === rep.elevations.length, `${label} ${n}바퀴: 좌표와 고도 개수가 맞는다`);
      // 이음매에 거리 0 인 중복점이 생기면 음성 내비가 유령 턴을 잡는다
      let zero = 0;
      for (let i = 1; i < rep.coords.length; i++) {
        if (G.haversineMeters(rep.coords[i - 1], rep.coords[i]) < 0.5) zero++;
      }
      check(zero === 0, `${label} ${n}바퀴: 이음매에 중복점이 없다`);
    }
  }
  check(RT.repeatRoute(loop, 1) === loop, '1바퀴는 원본을 그대로 (쓸데없이 복사하지 않는다)');
  check(RT.repeatRoute(loop, 0).distanceKm === loop.distanceKm, '0·음수는 1바퀴로 본다');
  check(Math.abs(RT.repeatRoute(loop, 3).ascentM - loop.ascentM * 3) < 1e-6, '상승도 바퀴 수만큼');
}

console.log(`\n통과 ${ok.length} / 실패 ${bad.length}`);
if (bad.length) process.exit(1);
