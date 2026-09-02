// 보고서용 스크린샷 촬영 — 빌드된 dist 를 실제 브라우저로 열어 화면을 찍는다.
//
//   npm run build && node scripts/shots.mjs
//   node scripts/shots.mjs --probe     화면 텍스트만 덤프 (선택자 찾을 때)
//
// 결과물: docs/shots/A~F.png
//
// 네트워크(지도 타일·보행 경로·고도)를 타므로 CI 용이 아니다. 보고서를 만들 때
// 사람이 한 번 돌린다.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const PROBE = process.argv.includes('--probe');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const DIST = resolve('dist');
const OUT = resolve('docs/shots');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

await mkdir(OUT, { recursive: true });

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

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  permissions: ['geolocation'],
  geolocation: { latitude: 37.5285, longitude: 127.0276 }, // 잠실 근처
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  ⚠ 예외:', e.message.slice(0, 120)));

/*
 * 바깥으로 나가는 요청을 Node 가 대신 받아 브라우저에 넘긴다.
 *
 * 이 환경의 외부 통신은 로컬 프록시를 거치고 TLS 가 그 앞에서 다시 끝난다.
 * Node 는 프록시 CA 를 신뢰하도록 이미 맞춰져 있지만, Playwright 가 띄우는
 * 크로미움은 그 CA 를 안 읽어 손이 닿는 족족 연결이 끊긴다. 인증서 검증을
 * 끄는 대신(그건 하면 안 된다) 요청만 Node 로 넘겨 정상적으로 검증된 응답을
 * 그대로 돌려준다. 지도 타일·보행 경로·고도가 이 길로 들어온다.
 */
let relayed = 0;
let relayFailed = 0;
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async (route) => {
  const req = route.request();
  try {
    const res = await fetch(req.url(), {
      method: req.method(),
      headers: req.headers(),
      body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer(),
      redirect: 'follow',
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const headers = Object.fromEntries(res.headers.entries());
    // 압축은 이미 풀려 있다 — 원본 헤더를 그대로 넘기면 브라우저가 두 번 푼다
    delete headers['content-encoding'];
    delete headers['content-length'];
    relayed++;
    await route.fulfill({ status: res.status, headers, body: buf });
  } catch (e) {
    relayFailed++;
    await route.abort().catch(() => {});
  }
});

const dump = async (tag) => {
  const t = await page.locator('body').innerText();
  console.log(`\n──── ${tag} ────\n${t.slice(0, 1400)}\n`);
};

const shot = async (name, note) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  📸 ${name}.png — ${note}`);
};

/**
 * 카드 하나만 잘라 찍는다. 화면 전체를 찍으면 하단 탭바가 카드를 덮어
 * 정작 보여줄 내용이 잘린다 — 기능을 설명하는 그림은 카드째 찍는 편이 낫다.
 * label 을 가진 요소에서 위로 올라가며 카드 컨테이너를 찾는다.
 */
const shotCard = async (name, label, note) => {
  const leaf = page.getByText(label, { exact: true }).first();
  if (!(await leaf.count())) {
    console.log(`  ⚠ ${name}: '${label}' 을 못 찾음`);
    return false;
  }
  const handle = await leaf.elementHandle();

  /*
   * 라벨에서 위로 올라가며 '카드' 를 찾는다.
   *
   * 임계값을 20 으로 두면 rounded-2xl(16px) 인 혼잡도 배지를 지나쳐 엉뚱한
   * 조상이 잡히고, 가장 바깥을 고르면 바텀시트가 통째로 잡힌다. 12px 이상인
   * 조상 중 '가장 안쪽' 이 그 라벨을 머리로 쓰는 카드다.
   */
  const cardHandle = await page.evaluateHandle(
    ([el, maxH]) => {
      let cur = el;
      for (let i = 0; i < 7 && cur.parentElement; i++) {
        cur = cur.parentElement;
        const r = parseFloat(getComputedStyle(cur).borderTopLeftRadius) || 0;
        const b = cur.getBoundingClientRect();
        if (r >= 12 && b.height > 40 && b.height <= maxH) return cur;
      }
      return el.parentElement ?? el;
    },
    [handle, 844],
  );

  const card = cardHandle.asElement();
  if (!card) {
    console.log(`  ⚠ ${name}: '${label}' 카드를 못 찾음`);
    return false;
  }
  // 바텀시트 안의 카드는 시트를 스크롤해야 드러난다. 화면 한가운데로 올려
  // 두면 아래 고정된 액션바에 가려 반 토막이 찍히는 일이 없다.
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(900);

  const box = await card.boundingBox();
  if (!box || box.height < 30) {
    console.log(`  ⚠ ${name}: '${label}' 카드가 화면에 안 잡힘`);
    return false;
  }
  await card.screenshot({ path: join(OUT, `${name}.png`) }).catch(async () => {
    await page.screenshot({ path: join(OUT, `${name}.png`) });
  });
  console.log(`  📸 ${name}.png — ${note}`);
  return true;
};

const go = async (tab) => {
  await page.getByRole('button', { name: tab, exact: true }).first().click();
  await page.waitForTimeout(1400);
};

/**
 * 첫 실행 힌트가 있으면 닫는다 (스크린샷을 가린다).
 * exact 를 반드시 켠다 — 부분 일치로 두면 '시작하기' 가 마이 페이지의
 * '첫 러닝 시작하기' 를 눌러 화면을 통째로 벗어난다.
 */
const dismissHints = async () => {
  for (const label of ['닫기', '확인', '알겠어요']) {
    const b = page.getByRole('button', { name: label, exact: true }).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click().catch(() => {});
      await page.waitForTimeout(400);
    }
  }
};

await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(3000);
await dismissHints();

const want = (n) => !ONLY || ONLY === n;

// ─────────────────────────────────────────────────────────
// A. 체력 평가 — 마이 페이지에서 나이·성별·측정값을 넣고 백분위를 받는다
// ─────────────────────────────────────────────────────────
if (want('A')) {
  await go('마이');
  await dismissHints();
  if (PROBE) await dump('마이 페이지');

  // 출생연도
  const birth = page.locator('input[placeholder="1994"]').first();
  if (await birth.isVisible().catch(() => false)) {
    await birth.fill('1994');
    await page.waitForTimeout(300);
  }
  // 성별
  await page.getByRole('button', { name: '남성', exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(300);

  // 심폐지구력 실측값 — 라벨로 입력칸을 찾는다
  const vo2 = page.locator('label', { hasText: '심폐지구력' }).locator('input').first();
  if (await vo2.isVisible().catch(() => false)) {
    await vo2.fill('44');
    await page.waitForTimeout(300);
  }
  const grip = page.locator('label', { hasText: '악력' }).locator('input').first();
  if (await grip.isVisible().catch(() => false)) await grip.fill('42');
  await page.waitForTimeout(1600);

  if (PROBE) await dump('마이 · 입력 후');
  await shotCard('A', '내 체력', '체력 평가 — 입력과 또래 백분위, 처방');
}

// ─────────────────────────────────────────────────────────
// B. 12분 검사
// ─────────────────────────────────────────────────────────
if (want('B')) {
  // A 에서 넣은 심폐지구력이 저장소에 남아 있으면 '12분 검사 시작' 카드가
  // 사라진다 (이미 아는 사람에게는 권하지 않는 화면이라서). 지우고 새로 연다.
  await ctx.clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await dismissHints();
  await go('마이');
  if (PROBE) await dump('마이 — 12분 검사 진입점 찾기');

  const entry = page.getByRole('button', { name: /12분 검사/ }).first();
  if (await entry.isVisible().catch(() => false)) {
    await entry.click();
    // 여기서 dismissHints 를 부르면 안 된다 — 검사 화면의 '닫기' 를 눌러
    // 방금 들어온 화면을 그대로 되돌아 나온다.
    await page.waitForTimeout(2500);
    if (PROBE) await dump('12분 검사 화면');
    await shot('B', '12분 검사 화면');
  } else {
    console.log('  ⚠ B: 12분 검사 진입점을 못 찾음');
  }
}

// ─────────────────────────────────────────────────────────
// C. 코스 만들기 — 거리 모드로 경로를 생성해 지도 + 비교 카드
// ─────────────────────────────────────────────────────────
if (want('C') || want('D') || want('E')) {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await dismissHints();
  await go('만들기');
  if (PROBE) await dump('만들기 (홈)');

  // 출발점부터 잡는다 — 없으면 추천 버튼이 아무 일도 하지 않는다.
  // 컨텍스트에 잠실 좌표를 물려 뒀으므로 '내 위치' 면 충분하다.
  const here = page.getByRole('button', { name: '내 위치', exact: true }).first();
  if (await here.isVisible().catch(() => false)) {
    await here.click();
    await page.waitForTimeout(2500);
  }

  // 길 성격을 하나 켜 둔다 — 비교 카드가 무엇을 보고 고르는지 드러난다
  await page.getByRole('button', { name: /신호등 적은 길/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);

  // 하단 탭의 '만들기' 가 아니라 본문의 추천 버튼을 눌러야 한다
  const build = page.getByRole('button', { name: /코스 추천받기/ }).first();
  if (await build.isVisible().catch(() => false)) {
    await build.click();
    console.log('  … 경로 생성 대기');
    await page.waitForTimeout(20000); // 라우팅 + 고도 조회
    if (PROBE) await dump('만들기 — 결과');
    if (want('C')) await shot('C', '코스 생성 — 지도와 경로 비교');

    // D·E 는 결과 패널 아래쪽에 있다
    if (want('D')) await shotCard('D', '근처 공공체육시설', '경로 주변 공공체육시설 (15107764)');
    if (want('E')) await shotCard('E', '예상 혼잡도', '예상 혼잡도와 추천 시간대');
  } else {
    console.log('  ⚠ C: 코스 만들기 버튼을 못 찾음');
  }
}

// ─────────────────────────────────────────────────────────
// F. 러닝 기록 (데모 주행)
// ─────────────────────────────────────────────────────────
if (want('F')) {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await dismissHints();
  await go('뛰기');
  if (PROBE) await dump('뛰기');

  const demo = page.getByRole('button', { name: /GPS 없이 데모/ }).first();
  if (await demo.isVisible().catch(() => false)) {
    await demo.click();
    console.log('  … 데모 주행 대기 (거리가 쌓일 때까지)');
    await page.waitForTimeout(45000);

    /*
     * 지도와 기록 수치까지만 자른다.
     *
     * 그 아래에는 '음성 안내가 이 기기에서 재생되지 않아요' 안내가 붙는데,
     * 헤드리스 크로미움에 음성 합성이 없어서 뜨는 것이지 실제 휴대폰에서
     * 나오는 화면이 아니다. 그대로 실으면 되레 없는 고장을 보여주게 된다.
     */
    const cut = await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find(
        (e) => e.children.length === 0 && e.textContent?.trim() === 'PACE',
      );
      if (!el) return null;
      const row = el.closest('div')?.parentElement ?? el;
      return Math.ceil(row.getBoundingClientRect().bottom + 16);
    });

    if (cut && cut > 200) {
      await page.screenshot({
        path: join(OUT, 'F.png'),
        clip: { x: 0, y: 0, width: 390, height: Math.min(cut, 844) },
      });
      console.log('  📸 F.png — 러닝 기록 — 지도와 거리·페이스');
    } else {
      await shot('F', '러닝 기록 — 거리·페이스 실시간');
    }
  } else {
    console.log('  ⚠ F: 데모 버튼을 못 찾음');
  }
}

await browser.close();
server.close();
console.log(`\n외부 요청 중계: 성공 ${relayed} · 실패 ${relayFailed}`);
console.log(`완료 → ${OUT}\n`);
