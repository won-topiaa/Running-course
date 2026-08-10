// 배포본 스모크 검증 — 빌드된 dist 를 실제 브라우저로 열어 전 화면을 눌러 본다.
//   npm run check:smoke   (dist 를 새로 빌드한 뒤 연다)
//
// 단위 검증(check:*)은 로직만 본다. 이 스크립트는 그 반대로, '진짜 배포되는
// 파일'이 실제 브라우저에서 렌더 오류·미처리 예외 없이 도는지만 본다.
// 배포 직전에 사람이 돌리는 용도 (네트워크·외부 SDK 사정을 타므로 CI 용은 아니다).
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const DIST = resolve('dist');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  try {
    let p = join(DIST, decodeURIComponent(req.url.split('?')[0]));
    const st = await stat(p).catch(() => null);
    if (!st || st.isDirectory()) p = join(DIST, 'index.html');
    const body = await readFile(p);
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = [];
const step = (c, m) => { (c ? ok : problems).push(m); console.log((c ? '  ✅ ' : '  ❌ ') + m); };

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone 14 Pro
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'ko-KR',
});
const page = await ctx.newPage();

// 화면을 깨뜨리는 것만 모은다. 외부 SDK(카카오 도메인 제한)·API 실패는
// 앱이 폴백으로 흡수하도록 설계돼 있으므로 소음으로 걸러낸다.
const noise = /kakao|dapi|openrouteservice|overpass|open-meteo|routing\.openstreetmap|tile|supabase|favicon|Failed to load resource/i;
const errors = [];
page.on('pageerror', (e) => errors.push(`미처리 예외: ${e.message}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (!noise.test(t)) errors.push(`콘솔 오류: ${t.slice(0, 160)}`);
});

console.log('\n배포본(dist) 실제 브라우저 검증 · 390×844\n');

await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const hasApp = await page.locator('#root').count();
step(hasApp === 1 && (await page.locator('#root *').count()) > 0, '앱이 렌더된다');
step(!(await page.getByText('문제가 생겼어요').count()), 'ErrorBoundary 화면이 안 뜬다');

// 탭 순회 — 각 화면의 지연 청크가 실제로 받아지고 렌더되는지
for (const [tab, marker] of [
  ['추천', '추천 코스'],
  ['내 코스', '저장한 코스'],
  ['마이', '러너'],
  ['만들기', '거리'],
]) {
  await page.getByRole('button', { name: tab, exact: true }).first().click();
  await page.waitForTimeout(1200);
  const seen = await page.getByText(marker).first().isVisible().catch(() => false);
  step(seen, `'${tab}' 탭이 열린다`);
}

// 러닝 기록 — 헤드리스엔 GPS 가 없으니 데모로 전 과정을 태운다
await page.getByRole('button', { name: '뛰기', exact: true }).first().click();
await page.waitForTimeout(1200);
step(await page.getByText('FREE RUN').first().isVisible().catch(() => false), '기록 화면이 열린다');

await page.getByRole('button', { name: /GPS 없이 데모/ }).click();
// 데모는 실제 러닝 속도(3.33m/s)로 재생된다 — 이동 임계(12m)를 넘어 거리가
// 찍히기까지 7초쯤 걸리므로, 그만큼 기다렸다가 본다.
await page.waitForTimeout(11000);
const dist = await page.locator('text=/^\\d+\\.\\d{2}$/').first().textContent().catch(() => null);
step(dist !== null && parseFloat(dist) > 0, `데모 러닝으로 거리가 쌓인다 (${dist ?? '없음'}km)`);

await page.getByRole('button', { name: /종료 · 저장|저장 중/ }).click();
// 종료는 지형 고도 조회(최대 4초)를 기다렸다가 요약으로 넘어간다.
// 고정 대기로 찍으면 회선에 따라 검사 자체가 흔들리므로 화면이 뜰 때까지 본다.
const summary = page.getByText(/러닝 완료|기록할 만큼/).first();
await summary.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
step(await summary.isVisible().catch(() => false), '종료하면 요약 화면으로 넘어간다');

// 요약의 숫자가 상식 범위인지 (이번에 고친 고도)
const body = await page.locator('body').innerText();
step(!/NaN|Infinity|undefined/.test(body), '화면에 NaN·undefined 가 없다');
// 통계 카드는 '값 위, 라벨 아래' 순서라 라벨 앞의 숫자를 읽어야 한다.
// (라벨 뒤를 읽으면 차트 캡션의 '고도 30~33m' 를 오르막으로 착각한다)
const asc = /(\d+)m\s*\n\s*총 오르막/.exec(body);
const km = /([\d.]+)\s*\n?\s*km/.exec(body);
if (asc && km) {
  const pct = (Number(asc[1]) / (Number(km[1]) * 1000)) * 100;
  console.log(`    요약: ${km[1]}km · 총 오르막 ${asc[1]}m (평균 ${pct.toFixed(1)}%)`);
  step(pct <= 35.5, `상승 고도가 사람이 뛸 수 있는 경사 안 (평균 ${pct.toFixed(1)}%)`);
}

await page.getByRole('button', { name: '닫기' }).first().click().catch(() => {});
await page.waitForTimeout(1000);

step(errors.length === 0, `앱 자체 오류 ${errors.length}건`);
errors.slice(0, 8).forEach((e) => console.log('     · ' + e));

await browser.close();
server.close();

console.log(`\n통과 ${ok.length} / 실패 ${problems.length}`);
process.exit(problems.length ? 1 : 0);
