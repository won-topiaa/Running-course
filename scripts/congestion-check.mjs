// 혼잡도 추정 모델 검증
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
}

// ---- haversine (congestion.ts 와 같은 공식) ----
const R = 6371008.8;
const toRad = d => d * Math.PI / 180;
function quickDist(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---- 상수 재현 ----
const HOT_ZONES = [
  { center: [37.4979, 127.0276], radiusM: 800, baseDensity: 0.95, name: '강남역' },
  { center: [37.5563, 126.9237], radiusM: 600, baseDensity: 0.90, name: '홍대입구' },
  { center: [37.5660, 126.9784], radiusM: 500, baseDensity: 0.85, name: '광화문' },
  { center: [37.5636, 126.9830], radiusM: 400, baseDensity: 0.82, name: '종각' },
  { center: [37.5610, 127.0340], radiusM: 500, baseDensity: 0.80, name: '건대입구' },
  { center: [37.5116, 127.0598], radiusM: 500, baseDensity: 0.78, name: '잠실' },
  { center: [37.5547, 126.9707], radiusM: 400, baseDensity: 0.80, name: '시청' },
  { center: [37.5283, 126.9294], radiusM: 600, baseDensity: 0.75, name: '여의도' },
  { center: [37.5044, 127.0247], radiusM: 400, baseDensity: 0.82, name: '교대/서초' },
  { center: [37.4844, 127.0343], radiusM: 500, baseDensity: 0.78, name: '양재' },
  { center: [37.5140, 127.1005], radiusM: 400, baseDensity: 0.72, name: '송파' },
  { center: [37.6511, 127.0560], radiusM: 500, baseDensity: 0.70, name: '노원' },
  { center: [37.5445, 126.8372], radiusM: 500, baseDensity: 0.68, name: '목동' },
  { center: [37.5596, 126.9427], radiusM: 500, baseDensity: 0.72, name: '마포' },
  { center: [37.5401, 126.9942], radiusM: 600, baseDensity: 0.65, name: '이태원/한남' },
];

const QUIET_ZONES = [
  { center: [37.5284, 126.9344], radiusM: 1200, quietFactor: 0.25 },
  { center: [37.5665, 126.9693], radiusM: 500, quietFactor: 0.20 },
  { center: [37.5480, 127.0448], radiusM: 800, quietFactor: 0.30 },
  { center: [37.5208, 127.1214], radiusM: 1000, quietFactor: 0.20 },
  { center: [37.5088, 127.0628], radiusM: 600, quietFactor: 0.30 },
  { center: [37.5520, 126.9720], radiusM: 500, quietFactor: 0.25 },
  { center: [37.5700, 126.9680], radiusM: 500, quietFactor: 0.30 },
  { center: [37.5680, 127.0080], radiusM: 400, quietFactor: 0.30 },
  { center: [37.5135, 127.1025], radiusM: 800, quietFactor: 0.25 },
  { center: [37.6455, 127.0113], radiusM: 1500, quietFactor: 0.15 },
  { center: [37.6572, 127.0520], radiusM: 1000, quietFactor: 0.20 },
];

const TIME_MULTIPLIERS = {
  0: 0.15, 1: 0.10, 2: 0.08, 3: 0.08, 4: 0.10, 5: 0.15,
  6: 0.25, 7: 0.45, 8: 0.80, 9: 0.90,
  10: 0.65, 11: 0.60, 12: 0.85, 13: 0.80,
  14: 0.60, 15: 0.55, 16: 0.60,
  17: 0.85, 18: 0.95, 19: 0.80,
  20: 0.60, 21: 0.45, 22: 0.35, 23: 0.25,
};

function baseDensityAt(pt) {
  let maxHot = 0.35;
  for (const z of HOT_ZONES) {
    const d = quickDist(pt, z.center);
    if (d < z.radiusM) {
      const ratio = 1 - d / z.radiusM;
      const density = z.baseDensity * ratio;
      if (density > maxHot) maxHot = density;
    }
  }
  let quietest = 1;
  for (const z of QUIET_ZONES) {
    const d = quickDist(pt, z.center);
    if (d < z.radiusM) {
      const ratio = 1 - d / z.radiusM;
      const factor = 1 - (1 - z.quietFactor) * ratio;
      if (factor < quietest) quietest = factor;
    }
  }
  return Math.max(0, Math.min(1, maxHot * quietest));
}

function timeMultiplier(hour, isWeekend) {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const m = TIME_MULTIPLIERS[h] ?? 0.5;
  return isWeekend ? m * 0.7 : m;
}

function toLevel(score) {
  if (score < 0.2) return 'low';
  if (score < 0.4) return 'moderate';
  if (score < 0.65) return 'high';
  return 'very-high';
}

function estimateCongestion(path, hour, isWeekend) {
  if (path.length === 0) return { level: 'low', score: 0 };
  const step = Math.max(1, Math.floor(path.length / 15));
  let sum = 0, count = 0;
  for (let i = 0; i < path.length; i += step) {
    sum += baseDensityAt(path[i]);
    count++;
  }
  const avgBase = sum / count;
  const timeMul = timeMultiplier(hour, isWeekend);
  const score = Math.min(1, avgBase * timeMul);
  return { level: toLevel(score), score, avgBase };
}

// ---- 1. 핫존 기본 밀도 ----
console.log('=== 핫존 밀도 검증 ===');
for (const z of HOT_ZONES) {
  const density = baseDensityAt(z.center);
  // 콰이어트존과 겹치는 핫존(시청·여의도·송파·노원)은 감쇄돼 0.6 미만이 정상이다
  ok(density >= 0.2, `${z.name} 중심: 밀도 ${density.toFixed(2)} >= 0.2`);
  ok(density <= 1.0, `${z.name} 중심: 밀도 ${density.toFixed(2)} <= 1.0`);

  // 반경 밖 ~2km 지점은 기본 밀도(0.35) 이하여야
  const outside = [z.center[0] + 0.02, z.center[1]];
  const outsideDensity = baseDensityAt(outside);
  ok(outsideDensity <= 0.40, `${z.name} 밖: ${outsideDensity.toFixed(2)} <= 0.40`);
}

// ---- 2. 콰이어트존 감쇄 ----
console.log('\n=== 콰이어트존 감쇄 검증 ===');
for (const z of QUIET_ZONES) {
  const centerDensity = baseDensityAt(z.center);
  const nearbyOutside = [z.center[0] + 0.02, z.center[1]];
  const outsideDensity = baseDensityAt(nearbyOutside);
  // 콰이어트존 중심은 (핫존과 겹치지 않으면) 낮은 밀도
  ok(centerDensity <= 0.6, `콰이어트존 ${z.center}: 밀도 ${centerDensity.toFixed(2)} <= 0.6`);
}

// ---- 3. 시간대별 보정 ----
console.log('\n=== 시간대별 보정 검증 ===');
// 새벽은 가장 낮아야
ok(TIME_MULTIPLIERS[3] < TIME_MULTIPLIERS[9], '새벽 3시 < 오전 9시');
ok(TIME_MULTIPLIERS[5] < TIME_MULTIPLIERS[18], '새벽 5시 < 오후 6시');
// 출퇴근은 높아야
ok(TIME_MULTIPLIERS[9] >= 0.8, '오전 9시 출근시간 >= 0.8');
ok(TIME_MULTIPLIERS[18] >= 0.8, '오후 6시 퇴근시간 >= 0.8');
// 점심도 높아야
ok(TIME_MULTIPLIERS[12] >= 0.7, '낮 12시 점심 >= 0.7');

// 주말은 평일보다 낮아야
for (let h = 0; h < 24; h++) {
  const wd = timeMultiplier(h, false);
  const we = timeMultiplier(h, true);
  ok(we <= wd, `${h}시: 주말(${we.toFixed(2)}) <= 평일(${wd.toFixed(2)})`);
}

// ---- 4. 경로 기반 추정 ----
console.log('\n=== 경로 기반 추정 ===');

// 강남역 한복판 출퇴근 시간 → very-high 또는 high
const gangnam9am = estimateCongestion([[37.4979, 127.0276]], 9, false);
ok(gangnam9am.level === 'very-high' || gangnam9am.level === 'high',
  `강남역 오전9시: ${gangnam9am.level} (score: ${gangnam9am.score.toFixed(2)})`);

// 강남역 새벽 → low 또는 moderate
const gangnam4am = estimateCongestion([[37.4979, 127.0276]], 4, false);
ok(gangnam4am.level === 'low' || gangnam4am.level === 'moderate',
  `강남역 새벽4시: ${gangnam4am.level} (score: ${gangnam4am.score.toFixed(2)})`);

// 한강공원 이른 아침 → low
const hangang6am = estimateCongestion([[37.5284, 126.9344]], 6, false);
ok(hangang6am.level === 'low',
  `한강공원 아침6시: ${hangang6am.level} (score: ${hangang6am.score.toFixed(2)})`);

// 한강공원 주말 낮 → low 또는 moderate
const hangangWeekend = estimateCongestion([[37.5284, 126.9344]], 14, true);
ok(hangangWeekend.level === 'low' || hangangWeekend.level === 'moderate',
  `한강공원 주말 오후: ${hangangWeekend.level} (score: ${hangangWeekend.score.toFixed(2)})`);

// 북한산 새벽 → low
const bukhan = estimateCongestion([[37.6572, 127.0520]], 5, false);
ok(bukhan.level === 'low',
  `북한산 새벽5시: ${bukhan.level} (score: ${bukhan.score.toFixed(2)})`);

// 올림픽공원 → 콰이어트존이라 낮게
const olympic = estimateCongestion([[37.5208, 127.1214]], 10, false);
ok(olympic.score < 0.3,
  `올림픽공원 오전10시: score ${olympic.score.toFixed(2)} < 0.3`);

// ---- 5. 경로 여러 점 ----
console.log('\n=== 다중 포인트 경로 ===');

// 강남역 → 한강공원 경로 (혼합)
const mixedPath = [
  [37.4979, 127.0276], // 강남역 (핫)
  [37.5050, 127.0200],
  [37.5150, 127.0100],
  [37.5284, 126.9344], // 한강공원 (콰이어트)
];
const mixed9am = estimateCongestion(mixedPath, 9, false);
ok(mixed9am.score > gangnam4am.score, `혼합 경로 9시 > 강남 4시`);
ok(mixed9am.score < gangnam9am.score, `혼합 경로 < 강남 단독 9시`);

// 공원 전용 경로 → 항상 낮아야
const parkPath = [
  [37.5208, 127.1214], // 올림픽공원
  [37.5180, 127.1100],
  [37.5088, 127.0628], // 석촌호수
];
const parkDay = estimateCongestion(parkPath, 12, false);
ok(parkDay.score < 0.35, `공원 경로 낮12시: ${parkDay.score.toFixed(2)} < 0.35`);

// ---- 6. toLevel 경계값 ----
console.log('\n=== 레벨 경계 검증 ===');
ok(toLevel(0) === 'low', 'score 0 → low');
ok(toLevel(0.19) === 'low', 'score 0.19 → low');
ok(toLevel(0.20) === 'moderate', 'score 0.20 → moderate');
ok(toLevel(0.39) === 'moderate', 'score 0.39 → moderate');
ok(toLevel(0.40) === 'high', 'score 0.40 → high');
ok(toLevel(0.64) === 'high', 'score 0.64 → high');
ok(toLevel(0.65) === 'very-high', 'score 0.65 → very-high');
ok(toLevel(1.0) === 'very-high', 'score 1.0 → very-high');

// ---- 7. 빈 경로 ----
const empty = estimateCongestion([], 12, false);
ok(empty.level === 'low', '빈 경로 → low');
ok(empty.score === 0, '빈 경로 → score 0');

// ---- 8. bestHours 검증 ----
console.log('\n=== 최적 시간대 검증 ===');
function findBestHours(avgBase, isWeekend) {
  const scored = [];
  for (let h = 5; h <= 22; h++) {
    const s = avgBase * timeMultiplier(h, isWeekend);
    scored.push({ h, s });
  }
  scored.sort((a, b) => a.s - b.s);
  return scored.slice(0, 3).map(x => x.h);
}

const gangnamBest = findBestHours(0.95, false);
ok(gangnamBest.length === 3, '최적 시간 3개');
ok(gangnamBest.every(h => h <= 7 || h >= 21), `강남 최적: ${gangnamBest.join(',')} (이른 아침/늦은 밤)`);

const parkBest = findBestHours(0.2, false);
ok(parkBest.length === 3, '공원 최적 3개');
ok(parkBest.includes(5) || parkBest.includes(6), '공원도 이른 아침이 최적');

// ---- 9. score 범위 ----
console.log('\n=== 점수 범위 검증 ===');
for (let h = 0; h < 24; h++) {
  for (const isWe of [false, true]) {
    for (const z of HOT_ZONES) {
      const est = estimateCongestion([z.center], h, isWe);
      ok(est.score >= 0 && est.score <= 1,
        `${z.name} ${h}시 ${isWe ? '주말' : '평일'}: score ${est.score.toFixed(3)} in [0,1]`);
    }
  }
}

// ---- 결과 ----
console.log(`\n혼잡도 검증: ${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail > 0 ? 1 : 0);
