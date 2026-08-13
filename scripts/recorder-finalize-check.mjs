// 기록 확정값 검증 — 종료 시 저장되는 값이 요약 화면의 값과 같은지 잰다.
//   node scripts/recorder-finalize-check.mjs
//
// useRunRecorder 는 훅이라 렌더러가 필요하다. 테스트 러너를 새로 들이는 대신
// React 의 훅 4개(useState/useRef/useCallback/useEffect)만 흉내 내는 최소
// 셰임으로 갈아끼워 Node 에서 그대로 돌린다. 셰임의 setState 는 슬롯에만 쓰고
// 자동 리렌더를 하지 않는데, 이게 바로 우리가 재려는 조건이다 — 손에 든
// rec 객체는 '마지막 렌더 시점의 값'(1Hz 틱만큼 뒤처진 스냅샷)이다.
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'rec-'));

// ── 최소 훅 런타임 ─────────────────────────────────────────────
const shim = join(dir, 'react-shim.mjs');
writeFileSync(
  shim,
  `
let i = 0;
const slots = [];
export function __reset() { i = 0; }
export function useState(init) {
  const k = i++;
  if (!(k in slots)) slots[k] = typeof init === 'function' ? init() : init;
  return [slots[k], (v) => { slots[k] = typeof v === 'function' ? v(slots[k]) : v; }];
}
export function useRef(init) {
  const k = i++;
  if (!(k in slots)) slots[k] = { current: init };
  return slots[k];
}
export function useCallback(fn) { return fn; }
export function useMemo(fn) { return fn(); }
export function useEffect() {}
export default { useState, useRef, useCallback, useMemo, useEffect };
`,
);

// 진입점을 따로 만들어 훅과 __reset 을 같은 번들에서 함께 내보낸다.
// bundle:true 는 셰임을 번들 안에 인라인하므로, 셰임 파일을 밖에서 따로
// import 하면 슬롯이 다른 두 번째 인스턴스가 잡힌다(렌더마다 상태가 초기화된다).
const entry = join(dir, 'entry.mjs');
writeFileSync(
  entry,
  `export { useRunRecorder } from '${resolve('src/lib/useRunRecorder.ts')}';\n` +
    `export { __reset } from 'react';\n`,
);

const out = join(dir, 'b.mjs');
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  outfile: out,
  logLevel: 'error',
  alias: { react: shim },
});

// 브라우저 전역 스텁 (wakeLock / visibilitychange 가 건드린다)
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
// Node 22 의 navigator 는 getter 라 대입이 안 된다 — 정의로 덮는다.
// wakeLock 키가 없으므로 wakeLockSupported() 는 false 가 되어 조용히 넘어간다.
Object.defineProperty(globalThis, 'navigator', {
  value: { vibrate() {} },
  configurable: true,
});

const { useRunRecorder, __reset } = await import(out);

const render = () => { __reset(); return useRunRecorder([37.5665, 126.978]); };

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}`); }
};

console.log('\n[기록 확정값] 저장값과 요약 화면 값이 같은지');

// 1) 데모 재생 시작 → 실제 시간이 흐르게 둔다
render().startDemo();
await new Promise((r) => setTimeout(r, 9000));

// 2) '마지막 렌더' 시점의 객체를 손에 쥔다 (finish() 가 보는 것과 같은 상태)
const staleRec = render();
const staleElapsed = staleRec.elapsedSec;
const staleDist = staleRec.distanceKm;

// 3) 종료 절차: pause 로 활성 시간을 확정하고 곧바로 확정값을 집는다
staleRec.pause();
const snap = staleRec.snapshot();

// 4) 고도 조회를 기다리는 시간을 흉내 낸다 (실제로는 최대 4초)
await new Promise((r) => setTimeout(r, 300));
staleRec.stop();

// 5) 요약 화면이 보게 될 값
const summary = render();

// 아래 '같은지' 검사들이 0 == 0 으로 헛돌지 않게 먼저 실제 기록이 쌓였는지 본다.
ok(snap.elapsedSec > 0, `확정 시간이 0 이 아니다 (${snap.elapsedSec.toFixed(3)}s)`);
ok(snap.distanceKm > 0, `거리가 쌓였다 (${(snap.distanceKm * 1000).toFixed(0)}m)`);
ok(snap.coords.length > 2, `좌표가 쌓였다 (${snap.coords.length}개)`);
ok(
  snap.elapsedSec === summary.elapsedSec,
  `저장 시간 == 요약 시간 (${snap.elapsedSec.toFixed(3)} vs ${summary.elapsedSec.toFixed(3)})`,
);
ok(
  snap.distanceKm === summary.distanceKm,
  `저장 거리 == 요약 거리 (${snap.distanceKm.toFixed(4)} vs ${summary.distanceKm.toFixed(4)})`,
);
ok(
  snap.coords.length === summary.coords.length,
  `좌표 개수 일치 (${snap.coords.length} vs ${summary.coords.length})`,
);

// 6) 예전 방식(렌더 스냅샷)이 실제로 어긋났는지 — 검사가 헛돌지 않게
const drift = Math.abs(staleElapsed - summary.elapsedSec);
console.log(
  `  ℹ️  렌더 스냅샷과의 차이: ${drift.toFixed(3)}s, 거리 ${Math.abs(staleDist - summary.distanceKm).toFixed(4)}km` +
    (drift > 0 ? '  ← 예전엔 이 값이 저장됐다' : ''),
);

// 7) stop 이 pause 가 확정한 값을 다시 더하지 않는지
ok(
  summary.elapsedSec <= snap.elapsedSec + 0.001,
  `정지 대기 300ms 가 활성 시간에 더해지지 않았다`,
);

console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0); // 데모 인터벌이 살아 있어 명시적으로 끝낸다
