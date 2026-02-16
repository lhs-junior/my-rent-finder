import { chromium } from 'playwright';

const query = '서울시 노원구 월세';
const keyword = encodeURIComponent(query);
const url = `https://www.dabangapp.com/?q=${keyword}`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const page = await context.newPage();
  page.on('response', async (res) => {
    const u = res.url();
    if (u.includes('/api/v5/room-list/recommend/home-ai/region')) {
      console.log('MATCH', res.status(), u);
      const req = res.request();
      console.log('REQ_HEADERS', req.headers());
      try {
        const txt = await res.text();
        console.log('REQ_BODY_LEN', txt.length, txt.slice(0, 220));
      } catch {}
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(5000);
  const input = page.locator('#search-input, input[type=search], input[placeholder*="검색" i], input[name*="search" i]').first();
  if (await input.count()) {
    await input.fill('노원구 월세');
    await input.press('Enter');
    await page.waitForTimeout(5000);
  }
  await page.screenshot({ path: 'scripts/dabang_probe2.png', fullPage: true });
  await browser.close();
})();
