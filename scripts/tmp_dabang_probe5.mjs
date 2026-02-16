import { chromium } from 'playwright';

(async()=>{
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({
    userAgent:'Mozilla/5.0',
    locale:'ko-KR',
    timezoneId:'Asia/Seoul',
  });
  const page=await context.newPage();
  await page.goto('https://www.dabangapp.com/?q=%EB%85%B8%EC%9B%90%EA%B5%AC%20%EC%9B%94%EC%84%B8', {waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);
  const ids=['69770bf1bc7323273ce03724','6975ab84898f603572210373'];
  const out = await page.evaluate(async (ids) => {
    const results = [];
    for (const id of ids) {
      const url = `https://www.dabangapp.com/api/v5/room/${id}`;
      try {
        const r = await fetch(url, {
          headers: {
            'user-agent':'Mozilla/5.0',
            'accept':'application/json, text/plain,*/*;q=0.8',
            'd-api-version':'5.0.0',
            'd-app-version':'1',
            'd-call-type':'web',
            csrf:'token',
            'cache-control':'no-cache',
            pragma:'no-cache',
            referer: location.href,
          },
        });
        const text = await r.text();
        results.push({id, status:r.status, len:text.length, text: text.slice(0,400)});
      } catch (e) {
        results.push({id, status:0, len:0, error:String(e)});
      }
    }
    return results;
  }, ids);
  console.log(out);

  const out2 = await page.evaluate(async () => {
    const r = await fetch('https://www.dabangapp.com/api/v5/room-list/recommend/home-ai/region?id=10194&mapCategoryType=ONE_TWO_ROOM&curationType=REGION_ROOM&useMap=naver&filters=' + encodeURIComponent('{"sellingTypeList":["MONTHLY_RENT","LEASE"],"depositRange":{"min":0,"max":999999},"priceRange":{"min":0,"max":999999},"tradeRange":{"min":0,"max":999999},"isIncludeMaintenance":false}'), {
      headers: {
        'accept': 'application/json, text/plain, */*',
        'd-api-version':'5.0.0',
        'd-app-version':'1',
        'd-call-type':'web',
        csrf:'token',
        referer: location.href,
      },
    });
    return {status:r.status, len:(await r.text()).length};
  });
  console.log('listFetch', out2);

  await browser.close();
})();
