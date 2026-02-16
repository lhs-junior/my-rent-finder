import { chromium } from 'playwright';

const listUrl='https://www.dabangapp.com/map/onetwo?m_zoom=16&m_lat=37.4857594200833&m_lng=127.015326629497&detail_type=room&detail_id=69770bf1bc7323273ce03724';

(async()=>{
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({
    userAgent:'Mozilla/5.0',
    locale:'ko-KR',
    timezoneId:'Asia/Seoul'
  });
  const page=await context.newPage();
  page.on('response', async (res) => {
    const u=res.url();
    if (!/api\//.test(u) && !/json/.test(res.headers()['content-type']||'')) return;
    const ct=res.headers()['content-type']||'';
    if (!/json|javascript/.test(ct)) return;
    try {
      const txt = await res.text();
      if (txt.length > 20) {
        console.log('HIT',res.status(),ct,u,'len',txt.length);
        console.log(txt.slice(0,220));
      }
    } catch {}
  });
  await page.goto(listUrl,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForTimeout(5000);
  const html=await page.content();
  console.log('html_len',html.length);
  console.log('hasMapInfo',html.includes('detail_id'),html.includes('roomDesc'),html.includes('roomTitle'));
  await browser.close();
})();
