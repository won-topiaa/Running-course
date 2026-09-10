// '내 위치' 측위 검증 — locateOnce
//
// 이 로직이 틀리면 사용자는 자기가 있는 곳에서 몇 km 떨어진 핀을 보게 된다.
// 실제로 그랬다: 예전 코드는 getCurrentPosition 의 첫 응답을 그대로 썼는데,
// 그건 위성이 잡히기 전의 기지국·IP 추정 좌표다. maximumAge 까지 1분으로 둬서
// 그 거친 좌표가 캐시로 즉시 나왔다.
//
// 진짜 기기 없이 검사하려고 geolocation 을 통째로 주입한다 — 측위가 시간을
// 두고 좋아지는 상황, 권한이 거부된 상황, 아무것도 안 오는 상황을 흉내낸다.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'locate-'));
const out = join(dir, 'locate.mjs');
await build({
  entryPoints: ['src/lib/locate.ts'],
  bundle: true,
  format: 'esm',
  outfile: out,
  logLevel: 'error',
  define: { 'import.meta.env': '{}' },
});
const { locateOnce, LocateError, locateErrorMessage, coarseNotice, GOOD_ENOUGH_M } =
  await import(out);

let pass = 0,
  fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
    console.log('  ✅ ' + msg);
  } else {
    fail++;
    console.error('  ❌ ' + msg);
  }
};

/**
 * 가짜 geolocation. fixes 는 [지연ms, 좌표, 오차] 목록이고, 가상 시계로
 * 흘려보낸다. 실제 타이머를 안 써서 검사가 즉시 끝난다.
 */
function fakeGeo(fixes, { errorAt = null, errorCode = 2 } = {}) {
  const timers = [];
  let now = 0;
  const api = {
    watchCleared: 0,
    watchPosition(okCb, errCb) {
      for (const [delay, coords, accuracy] of fixes) {
        timers.push([
          delay,
          () =>
            okCb({
              coords: { latitude: coords[0], longitude: coords[1], accuracy },
            }),
        ]);
      }
      if (errorAt != null) {
        timers.push([errorAt, () => errCb({ code: errorCode })]);
      }
      return 1;
    },
    clearWatch() {
      api.watchCleared++;
    },
  };
  // 가상 시계 — setTimer/clearTimer 주입에 쓴다
  const clock = {
    setTimer(fn, ms) {
      const id = { at: now + ms, fn, dead: false };
      timers.push([ms, fn, id]);
      return id;
    },
    clearTimer(id) {
      if (id && typeof id === 'object') id.dead = true;
    },
    /** 등록된 이벤트를 시간 순으로 전부 흘려보낸다 */
    async run() {
      const sorted = [...timers].sort((a, b) => a[0] - b[0]);
      for (const [at, fn, id] of sorted) {
        now = at;
        if (id?.dead) continue;
        fn();
        await Promise.resolve(); // 프라미스 콜백이 돌 틈을 준다
      }
    },
  };
  return { api, clock, timers };
}

console.log('\n[정확도 개선 대기] 첫 응답이 거칠면 더 나은 걸 기다린다');
{
  // 0ms 에 오차 3000m(IP 추정), 500ms 에 오차 20m(위성)
  const { api, clock } = fakeGeo([
    [0, [37.5, 127.0], 3000],
    [500, [37.4979, 127.0276], 20],
  ]);
  const job = locateOnce({
    geolocation: api,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    maxWaitMs: 12_000,
  });
  const p = job.promise;
  await clock.run();
  const r = await p;
  ok(r.accuracyM === 20, `거친 첫 응답 대신 정확한 측위를 쓴다 (오차 ${r.accuracyM}m)`);
  ok(r.precise === true, '정확도 기준을 넘으면 precise');
  ok(r.coords[0] === 37.4979, '좌표도 정확한 쪽');
  ok(api.watchCleared === 1, '끝나면 watch 를 끊는다');
  ok(coarseNotice(r) === null, '정확하면 안내 문구가 없다');
}

console.log('\n[시간 초과] 끝까지 거칠면 그때까지 중 최선을 준다');
{
  const { api, clock } = fakeGeo([
    [0, [37.5, 127.0], 3000],
    [200, [37.51, 127.01], 800],
  ]);
  const job = locateOnce({
    geolocation: api,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    maxWaitMs: 1000,
  });
  const p = job.promise;
  await clock.run();
  const r = await p;
  ok(r.accuracyM === 800, `가장 정확했던 측위를 쓴다 (오차 ${r.accuracyM}m)`);
  ok(r.precise === false, '기준에 못 미치면 precise 가 아니다');
  const notice = coarseNotice(r);
  ok(typeof notice === 'string' && notice.length > 0, '거친 위치는 안내 문구가 나온다');
  ok(notice.includes('800m'), `안내에 오차가 적힌다 (${notice})`);
}

console.log('\n[권한 거부] 기다려도 안 풀리니 즉시 끝낸다');
{
  const { api, clock } = fakeGeo([], { errorAt: 0, errorCode: 1 });
  const job = locateOnce({
    geolocation: api,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    maxWaitMs: 12_000,
  });
  const p = job.promise.then(
    () => 'resolved',
    (e) => e,
  );
  await clock.run();
  const e = await p;
  ok(e instanceof LocateError, '권한 거부는 오류로 끝난다');
  ok(e.kind === 'denied', `오류 종류가 denied (${e.kind})`);
  ok(locateErrorMessage('denied').includes('권한'), '권한 안내 문구에 권한이 언급된다');
}

console.log('\n[측위 실패 뒤 회복] 이미 받아 둔 게 있으면 그걸 쓴다');
{
  // 오차 300m 를 하나 받고 나서 위성 상실 오류(code 2)가 온다
  const { api, clock } = fakeGeo([[0, [37.55, 126.99], 300]], { errorAt: 100, errorCode: 2 });
  const job = locateOnce({
    geolocation: api,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    maxWaitMs: 12_000,
  });
  const p = job.promise;
  await clock.run();
  const r = await p;
  ok(r.accuracyM === 300, '오류가 와도 이미 받은 측위를 버리지 않는다');
}

console.log('\n[아무것도 못 받음] 타임아웃으로 끝난다');
{
  const { api, clock } = fakeGeo([]);
  const job = locateOnce({
    geolocation: api,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    maxWaitMs: 500,
  });
  const p = job.promise.then(
    () => 'resolved',
    (e) => e,
  );
  await clock.run();
  const e = await p;
  ok(e instanceof LocateError && e.kind === 'timeout', '측위가 하나도 없으면 timeout');
}

console.log('\n[지원 안 함]');
{
  const job = locateOnce({ geolocation: null });
  const e = await job.promise.then(
    () => 'resolved',
    (x) => x,
  );
  ok(e instanceof LocateError && e.kind === 'unsupported', 'geolocation 이 없으면 unsupported');
  ok(locateErrorMessage('unsupported').length > 0, 'unsupported 안내 문구 존재');
}

console.log('\n[취소] 화면을 떠나면 watch 를 끊는다');
{
  const { api, clock } = fakeGeo([[100, [37.5, 127.0], 10]]);
  const job = locateOnce({
    geolocation: api,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  let settled = false;
  job.promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  job.cancel();
  await clock.run();
  await Promise.resolve();
  ok(api.watchCleared >= 1, '취소하면 watch 를 끊는다');
  ok(settled === false, '취소 뒤에는 약속이 끝나지 않는다 (setState 가 안 불린다)');
}

console.log('\n[캐시를 쓰지 않는다] maximumAge 가 0 인가');
{
  let seenOpts = null;
  const api = {
    watchPosition(_ok, _err, opts) {
      seenOpts = opts;
      return 1;
    },
    clearWatch() {},
  };
  const job = locateOnce({ geolocation: api, setTimer: () => 1, clearTimer: () => {} });
  job.cancel();
  ok(seenOpts?.maximumAge === 0, "maximumAge 가 0 — 거친 캐시 좌표를 안 쓴다");
  ok(seenOpts?.enableHighAccuracy === true, 'enableHighAccuracy 를 켠다');
}

console.log('\n[기준값]');
ok(GOOD_ENOUGH_M === 50, `충분히 좋음 기준이 기록 필터와 같다 (${GOOD_ENOUGH_M}m)`);
for (const kind of ['unsupported', 'denied', 'timeout', 'unavailable']) {
  const m = locateErrorMessage(kind);
  ok(typeof m === 'string' && m.length > 5, `${kind} 안내 문구가 있다`);
  ok(!/undefined|NaN/.test(m), `${kind} 문구에 undefined·NaN 없음`);
}

console.log(`\n측위 검증: ${pass} 통과 / ${fail} 실패`);
process.exit(fail > 0 ? 1 : 0);
