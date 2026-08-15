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
  await build({
    entryPoints: [e], bundle: true, format: 'esm', outfile: o, logLevel: 'error',
    loader: { '.json': 'json' },
  });
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

console.log('\n[검사 모드] 12분 타이머 — 벽시계로 재는가');
{
  const now = 1_700_000_000_000;
  check(V.cooperRemainingSec(null, now) === 720, '시작 전에는 12분이 통째로 남아 있다');
  check(V.cooperRemainingSec(now - 60_000, now) === 660, '1분 지나면 11분 남는다');
  check(V.cooperRemainingSec(now - 719_000, now) === 1, '11분 59초 지나면 1초 남는다');
  check(V.cooperRemainingSec(now - 900_000, now) === 0, '한참 지나도 음수로 안 간다 (0에서 멈춤)');
  // 벽시계라는 게 핵심이다. 활성 시간으로 재면 신호 대기마다 시계가 서서
  // 결국 12분보다 오래 달리게 되고, 그만큼 거리가 부풀려진다.
  check(V.COOPER_TEST_SEC === 720, '검사 길이는 Cooper 프로토콜 그대로 720초');
}

console.log('\n[검사 인정] 무엇을 검사로 칠 것인가');
{
  const at = Date.now();
  // 12분에 1.05km — 일반 기록이면 최소 거리(1.2km)에 걸려 버려진다.
  // 하지만 본인이 직접 한 검사다. 이 사람이야말로 자기 상태를 알아야 한다.
  const slow = V.estimateVo2max([{ distanceKm: 1.05, durationSec: 720, at, isCooperTest: true }]);
  check(slow?.method === 'cooper', `12분에 1.05km 도 검사로 인정한다 (${slow?.value})`);

  // 거의 걸었다면(900m) 공식은 8.8 을 낸다 — 사람이 낼 수 있는 하한(10) 밑이다.
  const walked = V.estimateVo2max([{ distanceKm: 0.9, durationSec: 720, at, isCooperTest: true }]);
  check(walked == null, '거의 걸은 검사는 숫자를 만들어 내지 않는다');

  // 걸었더라도 평소 기록이 있으면 그쪽으로 넘어간다 (조용히 사라지지 않는다)
  const fallback = V.estimateVo2max([
    { distanceKm: 0.9, durationSec: 720, at, isCooperTest: true },
    { distanceKm: 5, durationSec: 1800, at },
  ]);
  check(fallback?.method === 'daniels', '검사가 쓸 수 없으면 평소 기록으로 넘어간다');

  // 검사는 설계상 최대 노력이라, 평소 최고 기록보다 우선한다
  const both = V.estimateVo2max([
    { distanceKm: 10, durationSec: 2700, at },
    { distanceKm: 2.4, durationSec: 720, at, isCooperTest: true },
  ]);
  check(both?.method === 'cooper' && both.confidence === 'high',
    `검사가 있으면 평소 기록보다 우선하고 '정확도 높음' 이 된다 (${both?.value})`);

  // 12분을 못 채운 기록에 표시만 붙어 있으면 검사로 안 친다
  const short = V.estimateVo2max([
    { distanceKm: 2.0, durationSec: 600, at, isCooperTest: true },
    { distanceKm: 5, durationSec: 1500, at },
  ]);
  check(short?.method === 'daniels', '10분에 끝난 기록은 표시가 있어도 Cooper 로 안 친다');
}

console.log('\n[저장] 검사 표시가 아무 기록에나 붙지 않는가');
{
  const SR = await bundle('src/lib/savedRoutes.ts', 'sr.mjs');
  const route = {
    coords: [[37.5, 127.0], [37.501, 127.001]],
    elevations: [10, 12],
    distanceKm: 2.4, ascentM: 2, maxGradePct: 1,
  };
  const real = SR.savedFromView({
    name: '검사', route, kind: 'recorded', source: 'gps', durationSec: 720, isCooperTest: true,
  });
  check(real.isCooperTest === true, '실제로 기록한 검사에는 표시가 붙는다');

  // 데모는 kind 가 'built' 다. 지어낸 2.4km 가 심폐지구력 42.4 로 둔갑하면 안 된다.
  const demo = SR.savedFromView({
    name: '검사(데모)', route, kind: 'built', source: 'demo', durationSec: 720, isCooperTest: true,
  });
  check(!demo.isCooperTest, '데모에는 검사 표시가 붙지 않는다');

  const plain = SR.savedFromView({
    name: '러닝', route, kind: 'recorded', source: 'gps', durationSec: 1800,
  });
  check(!plain.isCooperTest, '평소 러닝에는 표시가 없다');

  // 저장소에서 온 값은 무엇이든 들어올 수 있다 — true 하나만 통과해야 한다
  const dirty = SR.sanitizeRoutes([
    { ...real, isCooperTest: 'true' },
    { ...real, id: 'x2', isCooperTest: 1 },
    { ...real, id: 'x3', isCooperTest: true },
  ]);
  check(dirty.length === 3 && !dirty[0].isCooperTest && !dirty[1].isCooperTest && dirty[2].isCooperTest,
    "문자열 'true'·숫자 1 은 검사로 안 읽는다 (참 같은 값이 검사로 둔갑하지 않게)");
}

console.log('\n[사슬] 검사 결과가 정말 코스 추천까지 가는가');
{
  const F = await bundle('src/lib/fitness.ts', 'f.mjs');
  const K = await bundle('src/lib/kspoFitness.ts', 'k.mjs');
  const C = await bundle('src/data/courses.ts', 'c.mjs');
  const norm = await K.loadFitnessNorm(null, 'male', 32);
  check(norm != null, `기준 분포를 앱에 묶어 두고 바로 쓴다 (${norm?.sex} ${norm?.ageBand} n=${norm?.n})`);

  const at = Date.now();
  const run = (m) => {
    const est = V.estimateVo2max([{ distanceKm: m / 1000, durationSec: 720, at, isCooperTest: true }]);
    const a = F.assess({ birthYear: 1994, sex: 'male', measured: {}, measuredAt: null }, norm,
      est ? { vo2max: est.value } : {});
    return { est, a, rx: F.prescribe(a, 32) };
  };

  const weak = run(2000);
  const strong = run(2900);
  check(weak.a.overall != null && strong.a.overall != null, '검사만으로도 또래 백분위가 나온다');
  check(strong.a.overall > weak.a.overall,
    `멀리 간 사람이 더 높은 백분위 (2000m 상위 ${100 - weak.a.overall}% vs 2900m 상위 ${100 - strong.a.overall}%)`);
  check(strong.rx.sessionKm.max > weak.rx.sessionKm.max,
    `처방 거리가 달라진다 (${weak.rx.sessionKm.min}~${weak.rx.sessionKm.max}km vs ${strong.rx.sessionKm.min}~${strong.rx.sessionKm.max}km)`);
  check(strong.rx.maxAscentPerKm > weak.rx.maxAscentPerKm,
    `경사 상한도 달라진다 (${weak.rx.maxAscentPerKm} vs ${strong.rx.maxAscentPerKm} m/km)`);

  // 그래서 코스 순서가 실제로 바뀌는가 — 이게 사용자가 체감하는 전부다
  const courses = C.COURSES ?? C.courses ?? [];
  check(courses.length > 0, `코스 데이터 ${courses.length}개`);
  const top = ({ rx }) =>
    courses
      .map((c) => ({ c, s: F.courseFitScore(c, rx) }))
      .filter((x) => x.s != null)
      .sort((a, b) => b.s - a.s || a.c.distanceKm - b.c.distanceKm)[0];
  const weakTop = top(weak);
  const strongTop = top(strong);
  check(weakTop.c.distanceKm < strongTop.c.distanceKm,
    `추천 1순위가 바뀐다 (2000m → ${weakTop.c.name} ${weakTop.c.distanceKm}km · 2900m → ${strongTop.c.name} ${strongTop.c.distanceKm}km)`);

  // 체력을 모르면 이 축은 통째로 빠진다 — 0점으로 두면 멀쩡한 코스가 밀린다
  check(F.courseFitScore(courses[0], null) === null, '체력을 모르면 적합도는 null (0점이 아니다)');
}

console.log(`\n결과: ${ok.length} 통과, ${bad.length} 실패`);
if (bad.length) { for (const m of bad) console.log('  ❌ ' + m); process.exit(1); }
