// 배포 전 스트레스 검증 — 다양한 실패 상황을 실제 브라우저로 연출한다.
//   npm run build && node scripts/scenario-check.mjs
//
// 각 시나리오는 새 브라우저 컨텍스트에서 돌리고, '앱 자체가 죽는가'만 본다:
//   - 미처리 예외(pageerror)
//   - ErrorBoundary 화면('문제가 생겼어요')
//   - 화면에 NaN/undefined 노출
// 외부 SDK·API(카카오·ORS·OSRM·Overpass·Open-Meteo) 실패는 앱이 폴백으로
// 흡수하도록 설계돼 있으므로 소음으로 걸러낸다.
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';

const DIST = resolve('dist');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png' };

const server = createServer(async (req, res) => {
  try {
    let p = join(DIST, decodeURIComponent(req.url.split('?')[0]));
    const st = await stat(p).catch(() => null);
    if (!st || st.isDirectory()) p = join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404).end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const base = `http://127.0.0.1:${PORT}/`;

// 공유 링크 검증용 정상 토큰을 직접 만든다 (임시 파일 의존 없음).
const tokDir = mkdtempSync(join(tmpdir(), 'tok-'));
const tokOut = join(tokDir, 'p.mjs');
await build({ entryPoints: ['src/lib/polyline.ts'], bundle: true, format: 'esm', outfile: tokOut, logLevel: 'error' });
const { encodeShare, encodePolyline } = await import(tokOut);
const shareToken = encodeShare({
  n: '남산 테스트 코스', s: 'rolling', d: 2.4, a: 38, g: 6.2, src: 'ors',
  p: encodePolyline([[37.5512, 126.9882], [37.5525, 126.9905], [37.5540, 126.9925], [37.5555, 126.9945], [37.5570, 126.9965]]),
  e: [40, 55, 72, 60, 48],
});

const NOISE = /kakao|dapi|openrouteservice|overpass|open-meteo|routing\.openstreetmap|tile|supabase|carto|basemaps|favicon|Failed to load resource|net::ERR|the server responded|status of 4|status of 5/i;
const browser = await chromium.launch({ executablePath: CHROME });

const results = [];
async function scenario(name, opts, fn) {
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? { width: 390, height: 844 },
    isMobile: true, hasTouch: true, locale: 'ko-KR',
    ...(opts.geolocation ? { geolocation: opts.geolocation, permissions: ['geolocation'] } : {}),
  });
  const errs = [];
  const problems = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`예외: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(`콘솔: ${m.text().slice(0,140)}`); });
  if (opts.init) await page.addInitScript(opts.init);
  for (const [pattern, body] of opts.routes ?? []) {
    await ctx.route(pattern, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body()) }),
    );
  }
  if (opts.blockExternal) {
    await ctx.route('**/*', (route) => {
      const h = new URL(route.request().url()).hostname;
      if (h === '127.0.0.1') return route.continue();
      return route.abort();
    });
  }
  try {
    await fn(page, ctx, (cond, msg) => { if (!cond) problems.push(msg); });
    // 공통: ErrorBoundary·NaN 노출은 어느 시나리오든 실패다
    const boom = await page.getByText('문제가 생겼어요').count().catch(() => 0);
    if (boom) problems.push('ErrorBoundary 화면이 떴다');
    const body = await page.locator('body').innerText().catch(() => '');
    if (/\bNaN\b|undefined|Infinity/.test(body)) problems.push('화면에 NaN/undefined 노출');
  } catch (e) {
    problems.push(`시나리오 실행 실패: ${String(e).slice(0,120)}`);
  }
  const appErrs = errs.length;
  const ok = problems.length === 0 && appErrs === 0;
  results.push({ name, ok, problems, appErrs, errs });
  console.log(`${ok ? '✅' : '❌'} ${name}${appErrs ? `  (앱오류 ${appErrs})` : ''}`);
  problems.forEach((p) => console.log('     · ' + p));
  errs.slice(0, 4).forEach((e) => console.log('     · ' + e));
  await ctx.close();
}

const settle = (page, ms=2500) => page.waitForTimeout(ms);

console.log('\n다양한 실패 상황 연출 · 실제 브라우저\n');

// 1) 정상 첫 로드 (대조군)
await scenario('정상 첫 로드', {}, async (page, _c, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  expect(await page.locator('#root *').count() > 0, '앱이 렌더되지 않음');
});

// 2) 손상된 localStorage 로 로드 (다른 탭의 옛 버전·잘린 문자열)
await scenario('손상된 localStorage', {
  init: () => {
    localStorage.setItem('run-app-routes-v1', '{보다시피"깨진 json');
    localStorage.setItem('run-app-settings-v1', '"문자열이라 객체가 아님"');
    localStorage.setItem('run-app-saved-v1', '42');
    localStorage.setItem('run-app-cloud-session-v1', 'null끝');
  },
}, async (page, _c, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  expect(await page.locator('#root *').count() > 0, '깨진 저장소로 렌더 실패');
  await page.getByRole('button', { name: '내 코스', exact: true }).first().click();
  await page.waitForTimeout(1200);
  expect(await page.getByText('저장한 코스').first().isVisible().catch(()=>false), '내 코스 탭이 안 열림');
});

// 3) 위치 거부 → 기록 화면이 데모 안내로 살아있는지
await scenario('위치 권한 거부', {}, async (page, _c, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  await page.getByRole('button', { name: '뛰기', exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'START' }).click().catch(()=>{});
  await page.waitForTimeout(1500);
  // 권한이 없으니 START 를 눌러도 앱이 죽으면 안 되고, 데모 버튼은 계속 있어야 한다
  expect(await page.getByRole('button', { name: /GPS 없이 데모/ }).isVisible().catch(()=>false), '데모 대안이 사라짐');
});

// 4) 위치 허용 + 이동 → 실제 기록 흐름 전체 (watchPosition)
await scenario('위치 허용 + 이동 기록', { geolocation: { latitude: 37.5665, longitude: 126.978, accuracy: 8 } },
  async (page, ctx, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  await page.getByRole('button', { name: '뛰기', exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'START' }).click();
  await page.waitForTimeout(1000);
  // 남쪽으로 약 20m 씩 12번 이동 (위도 0.00018° ≈ 20m)
  for (let i = 1; i <= 12; i++) {
    await ctx.setGeolocation({ latitude: 37.5665 + i * 0.00018, longitude: 126.978, accuracy: 8 });
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(500);
  const dist = await page.locator('text=/^\\d+\\.\\d{2}$/').first().textContent().catch(()=>null);
  expect(dist !== null && parseFloat(dist) > 0, `이동해도 거리가 안 쌓임 (${dist})`);
  await page.getByRole('button', { name: /종료 · 저장|저장 중/ }).click();
  await page.getByText(/러닝 완료|기록할 만큼/).first().waitFor({ state:'visible', timeout: 15000 }).catch(()=>{});
  expect(await page.getByText(/러닝 완료|기록할 만큼/).first().isVisible().catch(()=>false), '종료 후 요약이 안 뜸');
});

// 5) 모든 외부 API·SDK 차단 → 코스 만들기가 데모로라도 뜬다
await scenario('외부 API 전면 차단', { blockExternal: true }, async (page, _c, expect) => {
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await settle(page, 3500);
  expect(await page.locator('#root *').count() > 0, '오프라인 자원만으로 렌더 실패');
  await page.getByRole('button', { name: /코스 추천받기/ }).click().catch(()=>{});
  await page.waitForTimeout(6000);
  // ORS·OSRM 다 막혔으니 데모(직선)로라도 결과가 나와야 하고, 앱이 죽으면 안 된다
  const drew = await page.getByText(/데모|이 경로로 뛰기|다시 찾기|찾는 중/).first().isVisible().catch(()=>false);
  expect(drew, '외부 차단 시 코스 생성이 아무 반응 없음');
});

// 6) 공유 링크 — 정상 토큰
await scenario('공유 링크(정상)', {}, async (page, _c, expect) => {
  await page.goto(base + '#course=' + shareToken, { waitUntil: 'load' }); await settle(page);
  expect(await page.getByText('남산 테스트 코스').first().isVisible().catch(()=>false), '공유 코스가 안 열림');
});

// 7) 공유 링크 — 변조/손상 토큰 (조용히 무시, 크래시 없음)
for (const [label, tok] of [['잘림', shareToken.slice(0, 40)], ['쓰레기', 'xxx%%%not-base64!!'], ['빈값', '']]) {
  await scenario(`공유 링크(손상: ${label})`, {}, async (page, _c, expect) => {
    await page.goto(base + '#course=' + tok, { waitUntil: 'load' }); await settle(page);
    expect(await page.locator('#root *').count() > 0, '손상 링크로 앱이 안 뜸');
    // 손상 링크는 조용히 무시되고 평소 만들기 화면이 떠야 한다
    expect(await page.getByText('거리').first().isVisible().catch(()=>false), '손상 링크 후 기본 화면이 안 뜸');
  });
}

// 8) 빠른 연타 — generate 연타 + 탭 왕복
await scenario('빠른 연타(생성+탭)', {}, async (page, _c, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  const gen = page.getByRole('button', { name: /코스 추천받기/ });
  for (let i = 0; i < 5; i++) { await gen.click({ force: true }).catch(()=>{}); await page.waitForTimeout(120); }
  for (let i = 0; i < 6; i++) {
    for (const t of ['추천','내 코스','마이','만들기']) {
      await page.getByRole('button', { name: t, exact: true }).first().click().catch(()=>{});
      await page.waitForTimeout(80);
    }
  }
  await page.waitForTimeout(1500);
  expect(await page.locator('#root *').count() > 0, '연타 후 앱이 사라짐');
});

// 9) 저장소 꽉 참 → 안내 배너 (크래시 대신)
await scenario('저장소 꽉 참', {
  init: () => {
    const r = { id:'a', name:'기존', createdAt: Date.now(), kind:'recorded', distanceKm:3,
      ascentM:10, maxGradePct:3, source:'gps', coords:[[37.5,127.0],[37.51,127.0]], elevations:[10,12] };
    localStorage.setItem('run-app-routes-v1', JSON.stringify([r]));
    const orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k, v) => { if (k.includes('routes')) throw new DOMException('quota','QuotaExceededError'); return orig(k, v); };
  },
}, async (page, _c, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  expect(await page.getByText(/저장 공간이 가득/).first().isVisible().catch(()=>false), '용량 초과 안내 배너가 안 뜸');
});

// 10) 아주 좁은 화면 (320px) — 버튼 깨짐/오버플로우
await scenario('초소형 화면 320px', { viewport: { width: 320, height: 640 } }, async (page, _c, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const cw = await page.evaluate(() => document.documentElement.clientWidth);
  expect(sw <= cw + 2, `가로 스크롤 발생 (내용 ${sw}px > 화면 ${cw}px)`);
});

// 11) 더운 날 경고 — 어두운 화면에 밝은 판때기가 생기면 안 된다.
// 실측: 러닝 점수 73점(주의)인 날, 팔레트에 없는 amber 가 Tailwind 기본
// (거의 흰색)으로 떨어져 화면 맨 위가 통째로 하얗게 떴다.
await scenario('더운 날 폭염 경고 표시', {
  routes: [
    [/api\.open-meteo\.com\/v1\/forecast/, () => {
      const now = new Date();
      const iso = (h) => { const d = new Date(now); d.setHours(now.getHours() + h, 0, 0, 0); return d.toISOString().slice(0, 16); };
      return {
        utc_offset_seconds: 32400,
        current: { temperature_2m: 29, apparent_temperature: 32, relative_humidity_2m: 70, weather_code: 1, wind_speed_10m: 6, precipitation: 0, uv_index: 7 },
        hourly: { time: [iso(0), iso(6), iso(11)], apparent_temperature: [32, 29, 27], uv_index: [7, 0, 0], precipitation_probability: [10, 10, 10] },
      };
    }],
    [/air-quality-api\.open-meteo\.com/, () => ({ current: { pm2_5: 8, pm10: 16 } })],
  ],
}, async (page, _c, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page, 3000);
  const el = page.getByText(/체감 \d+°/).first();
  expect(await el.isVisible().catch(() => false), '폭염 경고 줄이 안 뜸');
  const info = await el.evaluate((n) => {
    const bg = getComputedStyle(n).backgroundColor;
    const [r, g, b] = (bg.match(/\d+/g) ?? [0, 0, 0]).map(Number);
    // 줄 수는 높이÷줄높이로 재면 안 된다 — padding 이 섞여 1줄이 2줄로 나온다.
    // 텍스트에 Range 를 씌우면 실제로 몇 줄로 흘렀는지 그대로 나온다.
    const range = document.createRange();
    range.selectNodeContents(n);
    return { bg, lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, lines: range.getClientRects().length };
  });
  console.log(`     경고 배경 ${info.bg} · 밝기 ${info.lum.toFixed(2)} · ${info.lines}줄`);
  expect(info.lum < 0.3, `어두운 테마인데 경고 배경이 밝다 (밝기 ${info.lum.toFixed(2)})`);
  expect(info.lines <= 1, `경고가 ${info.lines}줄 — 첫 화면에서 그만큼 지도가 줄어든다`);
});

// 12) 종료 버튼 연타 — 고도 조회를 기다리는 몇 초 사이에 여러 번 눌러도
//     기록이 두 번 저장되면 안 된다 (마이 통계가 두 배가 된다).
await scenario('종료 연타(중복 저장 방지)', { geolocation: { latitude: 37.5665, longitude: 126.978, accuracy: 6 } },
  async (page, ctx, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  await page.getByRole('button', { name: '뛰기', exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'START' }).click();
  await page.waitForTimeout(1200);
  for (let i = 1; i <= 20; i++) {
    await ctx.setGeolocation({ latitude: 37.5665 + i * 0.000045, longitude: 126.978, accuracy: 6 });
    await page.waitForTimeout(600);
  }
  const count = () => page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('run-app-routes-v1') || '[]').length; } catch { return -1; }
  });
  const before = await count();
  const fin = page.getByRole('button', { name: /종료 · 저장|저장 중/ });
  let taps = 0;
  for (let i = 0; i < 6; i++) {
    if (await fin.click({ timeout: 1500 }).then(() => true).catch(() => false)) taps++;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(6000);
  const after = await count();
  const saved = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('run-app-routes-v1') || '[]')[0] ?? null; } catch { return null; }
  });
  console.log(`     ${taps}번 눌림 · 기록 ${before} → ${after}건 · ${saved?.distanceKm?.toFixed?.(2)}km/상승${saved?.ascentM}m`);
  expect(after - before === 1, `연타로 ${after - before}건 저장됨 (1건이어야 함)`);
  expect(!!saved && saved.distanceKm > 0, `저장된 거리가 0 (${saved?.distanceKm})`);
});

// 13) 러닝 도중 위치 권한이 끊겨도 그때까지 뛴 기록을 잃지 않는지
//     (설정에서 끄거나 OS 가 회수하는 경우. 예전엔 시작 화면으로 되돌아가
//      화면에서 기록이 사라졌다 — 안전망에는 남지만 앱을 껐다 켜야 보였다)
await scenario('러닝 중 위치 권한 취소', { geolocation: { latitude: 37.5665, longitude: 126.978, accuracy: 8 } },
  async (page, ctx, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  await page.getByRole('button', { name: '뛰기', exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'START' }).click();
  await page.waitForTimeout(1000);
  for (let i = 1; i <= 8; i++) {
    await ctx.setGeolocation({ latitude: 37.5665 + i * 0.00018, longitude: 126.978, accuracy: 8 });
    await page.waitForTimeout(400);
  }
  // 뛰는 도중 권한 회수
  await ctx.clearPermissions();
  await page.waitForTimeout(3000);
  const summary = await page.getByText(/러닝 완료|기록할 만큼/).first().isVisible().catch(() => false);
  const backToStart = await page.getByRole('button', { name: 'START' }).isVisible().catch(() => false);
  expect(summary || !backToStart, '권한이 끊기자 시작 화면으로 돌아가 기록이 화면에서 사라졌다');
});

// 12) 오프라인 재로드 (SW 캐시로 다시 열리는지)
await scenario('오프라인 재로드(PWA)', {}, async (page, ctx, expect) => {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(3500); // SW 설치 + idle prefetch 대기
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' }).catch(()=>{});
  await page.waitForTimeout(2000);
  expect(await page.locator('#root *').count() > 0, '오프라인 재로드 시 앱이 안 뜸');
});

// 13) 음성 — START 를 누른 그 제스처 안에서 엔진을 깨우는가
//     iOS Safari 는 사용자 제스처 밖에서 시작된 첫 발화를 조용히 버린다.
//     예전엔 첫 발화가 GPS 측위 뒤 effect 에서 났고(START 직후 3초간
//     speak() 호출 0회), 그래서 아이폰에서는 끝까지 무음이었다.
await scenario('음성 엔진 제스처 활성화', {
  geolocation: { latitude: 37.5665, longitude: 126.978, accuracy: 6 },
  init: () => {
    const log = { spoke: [], played: [], dropped: [] };
    window.__voiceLog = log;
    let unlocked = false; // 제스처 안에서 한 번 열려야 이후가 재생된다 (iOS 모델)
    window.speechSynthesis.speak = (u) => {
      const active = navigator.userActivation ? navigator.userActivation.isActive : true;
      log.spoke.push({ text: u.text, gesture: active });
      if (!unlocked && active) unlocked = true;
      if (unlocked) {
        log.played.push(u.text);
        setTimeout(() => u.dispatchEvent(new Event('start')), 1);
        setTimeout(() => u.dispatchEvent(new Event('end')), 20);
      } else {
        log.dropped.push(u.text);
      }
    };
    window.speechSynthesis.cancel = () => {};
    window.speechSynthesis.resume = () => {};
    window.speechSynthesis.getVoices = () => [];
  },
}, async (page, _c, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  await page.getByRole('button', { name: '뛰기', exact: true }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'START' }).click();
  await page.waitForTimeout(2500);
  const v = await page.evaluate(() => window.__voiceLog);
  expect(v.spoke.length > 0, 'START 를 눌러도 아무 발화가 없다 (아이폰이면 끝까지 무음)');
  // 자유 러닝은 1km 이정표까지 다른 안내가 없다 — 이 한마디가 출발 인사이자
  // '음성이 살아 있다' 는 유일한 신호다.
  expect(
    v.played.some((t) => t.includes('출발합니다')),
    `START 에서 '출발합니다' 가 안 나온다 (들린 말: ${JSON.stringify(v.played)})`,
  );
  expect(
    v.spoke.some((x) => x.gesture),
    '제스처 안에서 시작된 발화가 없다 — iOS 가 음성 엔진을 열어 주지 않는다',
  );
  expect(v.dropped.length === 0, `버려진 발화 ${v.dropped.length}건`);
  expect(
    !(await page.getByText(/재생되지 않아요/).isVisible().catch(() => false)),
    '정상 재생인데 음성 실패 안내가 떴다',
  );
});

// 14) 음성 — 엔진이 거부하면 이유를 화면이 말해 주는가
await scenario('음성 실패 안내', {
  geolocation: { latitude: 37.5665, longitude: 126.978, accuracy: 6 },
  init: () => {
    // 발화를 받되 언제나 error 로 돌려주는 엔진 (TTS 미설치·무음 모드 등)
    window.speechSynthesis.speak = (u) => {
      setTimeout(() => {
        const e = new Event('error');
        e.error = 'synthesis-failed';
        u.dispatchEvent(e);
      }, 5);
    };
    window.speechSynthesis.cancel = () => {};
    window.speechSynthesis.resume = () => {};
    window.speechSynthesis.getVoices = () => [];
  },
}, async (page, _c, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  await page.getByRole('button', { name: '뛰기', exact: true }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'START' }).click();
  await page.waitForTimeout(3500);
  expect(
    await page.getByText(/재생되지 않아요/).isVisible().catch(() => false),
    '음성이 안 나오는데 화면이 아무 말도 하지 않는다',
  );
});

// 15) 만들기 화면 — 칩 두 줄이 무엇을 뜻하는지 보이고, 길 성격은 함께 고를 수 있는가
await scenario('취향 칩 라벨·다중 선택', {}, async (page, _c, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  // 서랍을 연다 (첫 화면은 지도 우선으로 접혀 있다)
  const handle = page.getByRole('button', { name: /펼치기|접기/ }).first();
  if ((await handle.getAttribute('aria-expanded')) !== 'true') await handle.click();
  await page.waitForTimeout(800);

  // 위 줄이 경사, 아래 줄이 길이라는 걸 화면이 말해 줘야 한다
  const body = await page.locator('body').innerText();
  expect(/(^|\n)\s*경사\s*($|\n)/m.test(body) || body.includes('경사'), '경사 줄 라벨이 없다');
  expect(body.includes('길'), '길 줄 라벨이 없다');

  const trail = page.getByRole('button', { name: /신호등 적은 길/ });
  const soft = page.getByRole('button', { name: /흙길·트레일/ });
  const any = page.getByRole('button', { name: /상관없음/ });
  expect(await trail.isVisible().catch(() => false), '길 성격 칩이 안 보인다');

  // 둘을 함께 고를 수 있어야 한다 — 천변 흙산책로처럼 둘 다 원하는 경우가 흔하다
  await trail.click(); await page.waitForTimeout(250);
  await soft.click(); await page.waitForTimeout(250);
  expect(
    (await trail.getAttribute('aria-pressed')) === 'true' &&
      (await soft.getAttribute('aria-pressed')) === 'true',
    '두 번째를 누르면 첫 번째가 꺼진다 (다중 선택이 안 된다)',
  );
  expect((await any.getAttribute('aria-pressed')) === 'false', "둘을 골랐는데 '상관없음' 이 켜져 있다");

  // '상관없음' 은 나머지를 모두 끈다
  await any.click(); await page.waitForTimeout(250);
  expect(
    (await trail.getAttribute('aria-pressed')) === 'false' &&
      (await soft.getAttribute('aria-pressed')) === 'false' &&
      (await any.getAttribute('aria-pressed')) === 'true',
    "'상관없음' 이 나머지를 끄지 않는다",
  );

  // 다시 껐다 켜기 — 같은 칩을 두 번 누르면 꺼진다
  await trail.click(); await page.waitForTimeout(200);
  await trail.click(); await page.waitForTimeout(200);
  expect((await any.getAttribute('aria-pressed')) === 'true', '모두 끄면 상관없음으로 돌아가야 한다');
});

// 16) 추천 코스 상세 — 순환 코스에서 바퀴 수를 고를 수 있는가
await scenario('바퀴 수 고르기', {}, async (page, _c, expect) => {
  await page.goto(base, { waitUntil: 'load' }); await settle(page);
  await page.getByRole('button', { name: '추천', exact: true }).first().click();
  await page.waitForTimeout(1200);
  // 순환 코스 하나를 연다
  await page.getByText('석촌호수').first().click();
  await page.waitForTimeout(3000); // 실제 경로 라우팅 대기 (실패해도 앱은 살아야 한다)

  const picker = page.getByText('바퀴 수');
  if (await picker.isVisible().catch(() => false)) {
    const plus = page.getByRole('button', { name: '바퀴 수 늘리기' });
    const minus = page.getByRole('button', { name: '바퀴 수 줄이기' });
    expect(await minus.isDisabled(), '1바퀴인데 빼기 버튼이 살아 있다');
    await plus.click(); await page.waitForTimeout(300);
    const t = await page.locator('body').innerText();
    expect(/2바퀴 따라 뛰기/.test(t), `2바퀴로 올려도 버튼이 안 바뀐다`);
    expect(/×\s*2\s*=/.test(t), '합계 계산(× 2 =)이 안 보인다');
    await minus.click(); await page.waitForTimeout(300);
    expect(
      /이 코스 따라 뛰기/.test(await page.locator('body').innerText()),
      '1바퀴로 되돌리면 원래 문구로 돌아가야 한다',
    );
  } else {
    // 라우팅이 안 됐으면 바퀴 선택이 없는 게 맞다 — 그때도 앱은 멀쩡해야 한다
    expect(
      await page.getByRole('button', { name: /따라 뛰기|이 코스로 뛰기/ }).isVisible().catch(() => false),
      '경로를 못 받았는데 뛰기 버튼도 없다',
    );
  }
});

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n시나리오 ${results.length}개 · 통과 ${results.length - failed.length} / 실패 ${failed.length}`);
process.exit(failed.length ? 1 : 0);
