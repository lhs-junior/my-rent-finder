#!/usr/bin/env node
/**
 * KB부동산 — page.route() 인터셉트로 propList/filter 필터 변경
 * 사이트의 인증 헤더를 유지하면서 request body만 수정
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== propList/filter 인터셉트 테스트 ===\n");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes("kbland.kr")) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.log("✗ 탭 없음"); return; }

  // ═══ 1. 먼저 필터 구조 확인 ═══
  console.log("1. 필터 구조 전체 확인...");
  await page.goto("https://kbland.kr/map?xy=37.6055,127.0824,17", {
    waitUntil: "domcontentloaded", timeout: 25000,
  });
  await page.waitForTimeout(5000);

  const filterInfo = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    const filters = vm?.$store?.state?.map?.filtersData?.filters;
    if (!filters) return { error: "no filters" };

    const result = {};
    // typeProd → 물건유형
    const typeProd = filters.typeProd;
    if (typeProd?.types) {
      for (const [groupName, group] of Object.entries(typeProd.types)) {
        result[groupName] = {
          title: group.title,
          selected: group.selected,
          options: group.options?.map(o => ({
            text: o.text, key: o.key, value: o.value,
          })),
        };
      }
    }

    // typeDeal → 거래유형
    const typeDeal = filters.typeDeal;
    if (typeDeal?.types) {
      result.typeDeal = {
        title: typeDeal.filterName,
        selected: typeDeal.types?.selected,
        options: typeDeal.types?.options?.map(o => ({
          text: o.text, key: o.key, value: o.value,
        })),
      };
    }

    return result;
  });

  console.log("  물건유형 구조:");
  for (const [group, data] of Object.entries(filterInfo)) {
    if (group === "typeDeal") continue;
    console.log(`\n  ── ${group}: ${data.title} ──`);
    console.log(`    selected: ${JSON.stringify(data.selected)}`);
    for (const opt of data.options || []) {
      console.log(`    key=${opt.key}: ${opt.text} (${opt.value})`);
    }
  }

  if (filterInfo.typeDeal) {
    console.log(`\n  ── 거래유형 ──`);
    console.log(`    ${JSON.stringify(filterInfo.typeDeal)}`);
  }

  // ═══ 2. 클러스터 목록 가져오기 ═══
  console.log("\n\n2. 클러스터 목록...");
  const clusters = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    return (vm?.$store?.state?.map?.markerMaemulList || []).map(m => ({
      id: m.클러스터식별자, count: m.매물개수,
      lat: m.wgs84위도, lng: m.wgs84경도,
    })).sort((a, b) => b.count - a.count);
  });
  console.log(`  ${clusters.length}개 클러스터`);

  // ═══ 3. page.route()로 인터셉트 + 필터 변경 ═══
  console.log("\n3. page.route() 인터셉트 테스트...\n");

  const interceptedResponses = [];

  // 인터셉터 등록: propList/filter body 수정
  await page.route("**/propList/filter", async (route) => {
    const request = route.request();
    const origBody = request.postData();

    let modifiedBody;
    try {
      const bodyObj = JSON.parse(origBody);
      // 빌라/주택 + 월세 필터로 변경
      bodyObj["물건종류"] = "02,03,04,06"; // 빌라/주택 코드 (아래에서 확인 후 수정)
      bodyObj["거래유형"] = "3"; // 월세만
      bodyObj["보증금종료값"] = "6000";
      bodyObj["월세종료값"] = "80";
      bodyObj["면적시작값"] = "40";
      bodyObj["페이지목록수"] = 100;
      modifiedBody = JSON.stringify(bodyObj);
      console.log(`  [INTERCEPT] body 수정됨 — 물건종류: ${bodyObj["물건종류"]}, 거래유형: ${bodyObj["거래유형"]}`);
    } catch {
      modifiedBody = origBody;
    }

    // 수정된 body로 요청 전달 (헤더는 그대로 유지!)
    const response = await route.fetch({
      postData: modifiedBody,
    });

    // 응답 캡처
    const responseBody = await response.text();
    interceptedResponses.push({
      status: response.status(),
      body: responseBody,
    });

    console.log(`  [INTERCEPT] 응답: ${response.status()}, ${responseBody.length}b`);

    // 원본 응답 대신 수정된 응답 전달
    await route.fulfill({ response, body: responseBody });
  });

  // /cl/ 페이지로 이동 (인터셉터가 동작)
  const target = clusters[0];
  if (target) {
    console.log(`  /cl/${target.id} 이동 (${target.count}건)...`);
    await page.goto(
      `https://kbland.kr/cl/${target.id}?xy=${target.lat},${target.lng},17`,
      { waitUntil: "domcontentloaded", timeout: 25000 }
    );
    await page.waitForTimeout(5000);

    console.log(`\n  인터셉트된 응답: ${interceptedResponses.length}건`);
    for (const res of interceptedResponses) {
      try {
        const json = JSON.parse(res.body);
        const data = json?.dataBody?.data;
        console.log(`  code: ${json?.dataHeader?.resultCode}, 총매물: ${data?.총매물건수}, 반환: ${data?.propertyList?.length}`);
        if (data?.propertyList?.length > 0) {
          console.log(`  ★★★ 인터셉트 성공! ★★★`);
          const types = {};
          const deals = {};
          for (const item of data.propertyList) {
            types[item.매물종별구분명] = (types[item.매물종별구분명] || 0) + 1;
            deals[item.매물거래구분명] = (deals[item.매물거래구분명] || 0) + 1;
          }
          console.log(`  유형: ${JSON.stringify(types)}`);
          console.log(`  거래: ${JSON.stringify(deals)}`);
          console.log(`  매물IDs: ${data.propertyList.slice(0, 20).map(l => l.매물일련번호).join(", ")}`);

          for (const item of data.propertyList.slice(0, 5)) {
            console.log(`    ${item.매물일련번호}: [${item.매물종별구분명}] ${item.매물거래구분명}`);
            console.log(`      ${item.읍면동명} ${item.상세번지내용||""} ${item.건물명||item.단지명||""}`);
            console.log(`      보증금 ${item.월세보증금||item.전세가||"-"}, 월세 ${item.월세가||"-"}, 면적 ${item.전용면적}㎡, ${item.방수}방`);
          }
        }
      } catch (e) {
        console.log(`  파싱 실패: ${e.message}`);
      }
    }
  }

  // 인터셉터 해제
  await page.unroute("**/propList/filter");

  // ═══ 4. 물건종류 코드 변형 테스트 (인터셉트로) ═══
  console.log("\n\n4. 물건종류 코드 변형 테스트:");

  const codeTests = [
    { codes: "02", label: "02만" },
    { codes: "03", label: "03만" },
    { codes: "06", label: "06만" },
    { codes: "02,03", label: "02,03" },
    { codes: "02,03,06", label: "02,03,06" },
    { codes: "02,03,04,06", label: "02,03,04,06" },
    { codes: "01,02,03,04,05,06,07,41", label: "전체" },
  ];

  for (const test of codeTests) {
    interceptedResponses.length = 0;

    await page.route("**/propList/filter", async (route) => {
      const origBody = route.request().postData();
      try {
        const bodyObj = JSON.parse(origBody);
        bodyObj["물건종류"] = test.codes;
        bodyObj["거래유형"] = "3";
        bodyObj["페이지목록수"] = 100;
        const response = await route.fetch({ postData: JSON.stringify(bodyObj) });
        const responseBody = await response.text();
        interceptedResponses.push({ body: responseBody });
        await route.fulfill({ response, body: responseBody });
      } catch {
        await route.continue();
      }
    });

    await page.goto(
      `https://kbland.kr/cl/${target.id}?xy=${target.lat},${target.lng},17`,
      { waitUntil: "domcontentloaded", timeout: 25000 }
    );
    await page.waitForTimeout(3000);
    await page.unroute("**/propList/filter");

    if (interceptedResponses.length > 0) {
      try {
        const json = JSON.parse(interceptedResponses[0].body);
        const data = json?.dataBody?.data;
        const list = data?.propertyList || [];
        const types = {};
        for (const item of list) {
          types[item.매물종별구분명] = (types[item.매물종별구분명] || 0) + 1;
        }
        console.log(`  ${test.label}: 총${data?.총매물건수}건, 반환${list.length}건 — ${JSON.stringify(types)}`);
      } catch {}
    } else {
      console.log(`  ${test.label}: 인터셉트 실패`);
    }
  }

  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
