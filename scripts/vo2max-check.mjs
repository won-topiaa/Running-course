// VO₂max 추정 검증.
//   node scripts/vo2max-check.mjs
//
// 공식이 틀리면 그 위에 쌓은 처방·추천이 전부 무의미하다. 그래서 먼저
// 문헌에 공개된 기준점으로 검산하고, 그다음 '모르면 안 낸다' 를 확인한다.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'vo-'));
const bundle = async (e, n) => {
  const o = join(dir, n);
  await build({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, logLevel: 'error' });
  return import(o);
};
const V = await bundle('src/lib/vo2max.ts', 'v.mjs');
const ok = [], bad = [];
const check = (c, m) => { (c ? ok : bad).push(m); console.log((c ? '  ✅ ' : '  ❌ ') + m); };

console.log('\n[검산] Daniels·Gilbert VDOT — 공개된 등가표와 맞는가');
// Daniels' Running Formula 의 VDOT 등가표.
// 같은 VDOT 행에 있는 서로 다른 거리의 기록들은 모두 그 VDOT 로 환산돼야 한다
// — 이게 이 공식의 핵심 성질이라, 한 점이 아니라 행 단위로 검산한다.
const TABLE = [
  { vdot: 40, runs: [[5, '24:08'], [10, '50:03'], [21.0975, '1:50:59']] },
  { vdot: 50, runs: [[5, '19:57'], [10, '41:21'], [21.0975, '1:31:35']] },
  { vdot: 60, runs: [[5, '17:03'], [10, '35:22'], [21.0975, '1:18:09']] },
];
const toSec = (t) => t.split(':').reverse().reduce((a, v, i) => a + Number(v) * 60 ** i, 0);
for (const { vdot, runs } of TABLE) {
  for (const [km, time] of runs) {
    const got = V.danielsVdot(km, toSec(time));
    const diff = Math.abs(got - vdot);
    const label = km === 21.0975 ? '하프' : `${km}km`;
    check(diff <= 0.6, `VDOT ${vdot} 행: ${label} ${time} → ${got} (차 ${diff.toFixed(1)})`);
  }
}

console.log('\n[검산] Cooper 12분 달리기');
for (const [m, expect, label] of [
  [2400, 42.4, '2400m'],
  [2800, 51.4, '2800m'],
  [1800, 28.9, '1800m'],
]) {
  const got = V.cooperVo2max(m);
  check(Math.abs(got - expect) <= 0.5, `${label} → ${got} ml/kg/min (문헌 ${expect})`);
}

console.log('\n[방어] 공식이 다루지 않는 입력은 숫자를 내지 않는다');
check(V.danielsVdot(0, 600) === null, '거리 0 → null');
check(V.danielsVdot(5, 0) === null, '시간 0 → null');
check(V.danielsVdot(1, 60) === null, '1분 — 너무 짧아 공식 범위 밖 → null');
check(V.danielsVdot(5, 5 * 3600) === null, '5시간 — 범위 밖 → null');
check(V.danielsVdot(100, 600) === null, '10분에 100km — 사람 속도 아님 → null');
check(V.danielsVdot(0.5, 600) === null, '10분에 0.5km — 걷기보다 느림 → null');
check(V.cooperVo2max(400) === null, '12분에 400m → null (공식 하한)');

console.log('\n[선택] 기록 중 무엇을 근거로 삼는가');
const day = 86400000, now = Date.now();
check(V.estimateVo2max([]) === null, '기록이 없으면 추정하지 않는다');
check(
  V.estimateVo2max([{ distanceKm: 3, at: now }]) === null,
  '시간이 없는 기록은 못 쓴다',
);
check(
  V.estimateVo2max([{ distanceKm: 0.8, durationSec: 400, at: now }]) === null,
  '너무 짧은 기록(0.8km)은 제외',
);
{
  const runs = [
    { distanceKm: 5, durationSec: 30 * 60, at: now - 5 * day },  // 느긋
    { distanceKm: 5, durationSec: 22 * 60, at: now - 3 * day },  // 빠름 ← 이게 근거
    { distanceKm: 3, durationSec: 18 * 60, at: now - day },
  ];
  const e = V.estimateVo2max(runs);
  check(e != null && e.method === 'daniels', 'Daniels 로 추정');
  check(
    e.basis.distanceKm === 5 && e.basis.durationSec === 22 * 60,
    `가장 좋은 노력을 고른다 (5km 22:00, VDOT ${e.value})`,
  );
  check(e.confidence === 'low', `기록 3개 → 신뢰도 ${e.confidence}`);
  check(
    e.note.includes('최대로 달린 기록이 아니면'),
    '최대 노력이 아닐 수 있다고 분명히 밝힌다',
  );
  const many = [...runs, ...runs].map((r, i) => ({ ...r, at: now - i * day }));
  check(V.estimateVo2max(many).confidence === 'medium', '기록이 5개 이상이면 신뢰도 medium');
}

console.log('\n[12분 테스트] 있으면 그걸 우선한다');
{
  const runs = [
    { distanceKm: 10, durationSec: 44 * 60, at: now - 2 * day },        // 좋은 일반 기록
    { distanceKm: 2.6, durationSec: 12 * 60, at: now, isCooperTest: true }, // 테스트
  ];
  const e = V.estimateVo2max(runs);
  check(e.method === 'cooper', '일반 기록보다 12분 테스트를 우선');
  check(e.confidence === 'high', '테스트는 설계상 최대 노력이라 정확도 높음');
  check(Math.abs(e.value - V.cooperVo2max(2600)) < 0.01, `Cooper 값 ${e.value}`);
  // 시간이 어긋난 '테스트' 는 테스트로 인정하지 않는다
  const bad = [{ distanceKm: 5, durationSec: 25 * 60, at: now, isCooperTest: true }];
  check(V.estimateVo2max(bad).method === 'daniels', '12분에서 크게 벗어나면 Cooper 로 안 친다');
}

console.log('\n[단조성] 같은 거리면 빠를수록 높게 나온다');
{
  let prev = 0, mono = true;
  for (const sec of [35, 30, 27, 24, 21, 19].map((m) => m * 60)) {
    const v = V.danielsVdot(5, sec);
    if (v <= prev) { mono = false; break; }
    prev = v;
  }
  check(mono, '5km 를 35분→19분으로 줄이면 VDOT 가 계속 오른다');
  // 등가표의 같은 행이면 거리가 달라도 같은 값이 나와야 한다
  const a = V.danielsVdot(5, toSec('19:57'));
  const b = V.danielsVdot(21.0975, toSec('1:31:35'));
  check(Math.abs(a - b) <= 0.6, `등가 기록은 거리가 달라도 같은 VDOT (5km ${a} vs 하프 ${b})`);
}

console.log(`\n결과: ${ok.length} 통과, ${bad.length} 실패`);
if (bad.length) { for (const m of bad) console.log('  ❌ ' + m); process.exit(1); }
