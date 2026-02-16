import { chromium } from 'playwright';

const filters='{"sellingTypeList":["MONTHLY_RENT","LEASE"],"depositRange":{"min":0,"max":6000},"priceRange":{"min":0,"max":80},"tradeRange":{"min":0,"max":80},"isIncludeMaintenance":false}';
const encoded=encodeURIComponent(filters);

(async()=>{
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({
    userAgent:'Mozilla/5.0',
    locale:'ko-KR',
    timezoneId:'Asia/Seoul'
  });
  const page=await context.newPage();
  let regionId='';

  page.on('response', async(res)=>{
    const u=res.url();
    if (u.includes('/api/v5/loc/search?')) {
      try {
        const j=JSON.parse(await res.text());
        const first=(j.result?.regionList?.[0]||j.result?.regions?.[0]||{});
        regionId = first.regionGid || first.regionId || first.id || '';
        console.log('loc search first', first);
      } catch {}
    }
    if (u.includes('/api/v5/room-list/recommend/home-ai/region')) {
      try {
        const j=JSON.parse(await res.text());
        console.log('page response status', j.code, 'count', j.result?.list?.length);
      } catch {}
    }
  });

  const query='서울시 노원구 월세';
  await page.goto('https://www.dabangapp.com/?q='+encodeURIComponent(query), {waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);

  const input = page.locator('#search-input, input[type=search]').first();
  if (await input.count()) {
    await input.fill('노원구 월세');
    await input.press('Enter');
    await page.waitForTimeout(2500);
  }

  const region = regionId || '10194';
  const listUrl = `https://www.dabangapp.com/api/v5/room-list/recommend/home-ai/region?id=${region}&mapCategoryType=ONE_TWO_ROOM&filters=${encoded}&curationType=REGION_ROOM&useMap=naver`;
  console.log('regionUsed', region);
  const data = await page.evaluate(async (url, region) => {
    const r = await fetch(url, {
      headers: {
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36',
        accept:'application/json, text/plain, */*',
        'accept-language':'ko-KR,ko;q=0.9,en;q=0.8',
        referer:location.href,
        'd-api-version':'5.0.0',
        'd-app-version':'1',
        'd-call-type':'web',
        csrf:'token',
        'cache-control':'no-cache',
        pragma:'no-cache',
      },
    });
    return {status:r.status, text: await r.text()};
  }, listUrl);

  console.log('manualFetch', data.status, data.text.slice(0, 200));
  const parsed = JSON.parse(data.text);
  const first = parsed.result?.list?.[0];
  console.log('manual count', parsed.result?.list?.length || 0);
  if (first) {
    console.log('manual keys', Object.keys(first));
    console.log('manual sample', JSON.stringify({
      id:first.id,
      seq:first.seq,
      roomTypeName:first.roomTypeName,
      roomTitle:first.roomTitle,
      roomRent:first.roomRent,
      roomDeposit:first.roomDeposit,
      rentPrice:first.rentPrice,
      deposit:first.deposit,
      rentTitle:first.priceTitle,
      area:first.area,
      areaText:first.areaText,
      areaM2:first.area_m2,
      areaUnit:first.areaUnit,
      address:first.address,
      address2:first.address2,
      detailType:first.detail_type,
      detailId:first.detail_id,
      location:first.location,
      tradeType:first.tradeType,
      roomType:first.roomType,
      floorText:first.floor,
      roomDesc:first.roomDesc,
      description:first.description,
    }, null, 2));
  }

  await browser.close();
})();
