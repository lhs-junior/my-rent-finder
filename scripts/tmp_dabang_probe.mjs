import { chromium } from 'playwright';

const query = '서울시 노원구 월세';
const keyword = encodeURIComponent(query);
const url = `https://www.dabangapp.com/?q=${keyword}`;
const want = [/api\/v5\//, /officetel/i, /room/i, /house/i, /search/i, /detail/i];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const page = await context.newPage();
  const hits = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (!want.some((r) => r.test(u))) return;
    try {
      const status = res.status();
      const ct = res.headers()['content-type'] || '';
      if (!/application\/json|text\/json|javascript.+json|text\/plain/i.test(ct)) {
        return;
      }
      const txt = await res.text();
      if (!txt || txt.length < 6) return;
      hits.push({
        url: u,
        status,
        ct,
        body: txt.slice(0, 500),
      });
      console.log('HIT', status, ct, u);
      console.log(txt.slice(0, 260));
      console.log('---');
    } catch (e) {
      // ignore
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(3000);
  const input = page.locator('#search-input, input[type=search], input[placeholder*="검색" i], input[name*="search" i]').first();
  if (await input.count()) {
    await input.fill('노원구 월세');
    await input.press('Enter');
    await page.waitForTimeout(3500);
  }

  const links = await page.$$eval('a[href]', (nodes) => nodes.slice(0, 140).map((n) => ({ href: n.getAttribute('href') || '', text: (n.textContent || '').slice(0, 80) }))); 
  const listing = links.filter((l) => /detail_id|officetel|room/.test(l.href));
  console.log('LISTING_LINKS', listing.length);
  console.log(JSON.stringify(listing.slice(0, 40), null, 2));

  const map = [...new Set(hits.map((h) => h.url))];
  console.log('TOTAL_HITS', hits.length);
  for (const u of map.slice(0, 200)) {
    console.log(u);
  }

  await browser.close();
})();
