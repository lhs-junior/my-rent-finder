#!/usr/bin/env node
/**
 * KB부동산 — propList/filter를 인증 헤더와 함께 호출
 * + /cl/ 페이지 네비게이션으로 캡처하여 헤더 비교
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== propList/filter 인증 헤더 분석 ===\n");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes("kbland.kr")) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.log("✗ 탭 없음"); return; }

  // ═══ 1. /cl/ 네비게이션으로 실제 request 헤더 캡처 ═══
  console.log("1. /cl/ 네비게이션으로 실제 request 헤더 캡처...");

  // 먼저 지도 페이지로 이동
  await page.goto("https://kbland.kr/map?xy=37.6055,127.0824,17", {
    waitUntil: "domcontentloaded", timeout: 25000,
  });
  await page.waitForTimeout(5000);

  const capturedReqs = [];
  page.on("request", (req) => {
    if (req.url().includes("propList/filter")) {
      capturedReqs.push({
        url: req.url(),
        method: req.method(),
        headers: req.headers(),
        postData: req.postData(),
      });
    }
  });

  const capturedRes = [];
  page.on("response", async (res) => {
    if (res.url().includes("propList/filter")) {
      try {
        const body = await res.text();
        capturedRes.push({ url: res.url(), status: res.status(), body });
      } catch {}
    }
  });

  // 클러스터 클릭으로 /cl/ 이동
  const clickResult = await page.evaluate(async () => {
    const vm = document.querySelector("#app")?.__vue__;
    const clusters = vm?.$store?.state?.map?.markerMaemulList || [];
    if (clusters.length === 0) return { error: "no clusters" };

    const target = [...clusters].sort((a, b) => b.매물개수 - a.매물개수)[0];
    const mapInstance = vm.$store.state.map?.naverMapInstance;
    if (!mapInstance) return { error: "no map" };

    const coord = new naver.maps.LatLng(target.wgs84위도, target.wgs84경도);
    const pixel = mapInstance.getProjection().fromCoordToOffset(coord);
    const rect = mapInstance.getElement().getBoundingClientRect();

    return {
      id: target.클러스터식별자,
      count: target.매물개수,
      x: pixel.x + rect.left,
      y: pixel.y + rect.top,
    };
  });

  if (clickResult.x) {
    console.log(`  클러스터 ${clickResult.id} 클릭 (${clickResult.count}건)...`);
    await page.mouse.click(clickResult.x, clickResult.y);
    await page.waitForTimeout(5000);
  }

  console.log(`\n  캡처된 요청: ${capturedReqs.length}건`);
  if (capturedReqs.length > 0) {
    const req = capturedReqs[0];
    console.log("  ── 실제 헤더 ──");
    for (const [k, v] of Object.entries(req.headers)) {
      console.log(`    ${k}: ${v.substring(0, 200)}`);
    }
    console.log(`\n  ── 실제 body ──`);
    console.log(`  ${req.postData?.substring(0, 500)}`);
  }

  console.log(`\n  캡처된 응답: ${capturedRes.length}건`);
  if (capturedRes.length > 0) {
    const res = capturedRes[0];
    try {
      const json = JSON.parse(res.body);
      const data = json?.dataBody?.data;
      console.log(`  status: ${res.status}, code: ${json?.dataHeader?.resultCode}`);
      console.log(`  총매물건수: ${data?.총매물건수}, propertyList: ${data?.propertyList?.length}건`);
    } catch {}
  }

  // ═══ 2. 캡처된 헤더로 직접 호출 ═══
  console.log("\n\n2. 캡처된 헤더로 직접 호출:");
  if (capturedReqs.length > 0) {
    const origHeaders = capturedReqs[0].headers;
    const origBody = capturedReqs[0].postData;

    // 완전히 동일한 헤더+body로 호출
    const r1 = await page.evaluate(async ({ headers, body }) => {
      const res = await fetch("https://api.kbland.kr/land-property/propList/filter", {
        method: "POST",
        headers,
        body,
        credentials: "include",
      });
      return { status: res.status, text: await res.text() };
    }, { headers: origHeaders, body: origBody });

    try {
      const json = JSON.parse(r1.text);
      const data = json?.dataBody?.data;
      console.log(`  동일 헤더+body: ${json?.dataHeader?.resultCode}, 총${data?.총매물건수}건, 반환${data?.propertyList?.length}건`);
    } catch (e) {
      console.log(`  동일 헤더+body: 실패 ${e.message}`);
    }

    // body만 변경 (물건종류 → 03,05, 거래유형 → 3)
    try {
      const bodyObj = JSON.parse(origBody);
      bodyObj["물건종류"] = "03,05";
      bodyObj["거래유형"] = "3";
      bodyObj["보증금종료값"] = "6000";
      bodyObj["월세종료값"] = "80";
      bodyObj["면적시작값"] = "40";

      const r2 = await page.evaluate(async ({ headers, body }) => {
        const res = await fetch("https://api.kbland.kr/land-property/propList/filter", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          credentials: "include",
        });
        return { status: res.status, text: await res.text() };
      }, { headers: origHeaders, body: bodyObj });

      const json2 = JSON.parse(r2.text);
      const data2 = json2?.dataBody?.data;
      console.log(`  커스텀필터 (03,05+월세): ${json2?.dataHeader?.resultCode}, 총${data2?.총매물건수}건, 반환${data2?.propertyList?.length}건`);

      if (data2?.propertyList?.length > 0) {
        for (const item of data2.propertyList.slice(0, 3)) {
          console.log(`    ${item.매물일련번호}: [${item.매물종별구분명}] ${item.매물거래구분명} ${item.읍면동명} 월세${item.월세보증금}/${item.월세가} ${item.전용면적}㎡`);
        }
      }
    } catch (e) {
      console.log(`  커스텀필터: 실패 ${e.message}`);
    }

    // ═══ 3. 헤더 하나씩 제거하며 어떤 헤더가 필수인지 확인 ═══
    console.log("\n\n3. 필수 헤더 식별:");
    const essentialHeaders = ["content-type"];
    const authHeaders = Object.keys(origHeaders).filter(k =>
      k.includes("auth") || k.includes("token") || k.includes("cookie") ||
      k.includes("x-") || k.includes("kbland") || k.includes("site")
    );
    console.log(`  인증 관련 헤더: ${authHeaders.join(", ")}`);

    // content-type만으로 호출
    const r3 = await page.evaluate(async ({ body }) => {
      const res = await fetch("https://api.kbland.kr/land-property/propList/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        credentials: "include",
      });
      return { status: res.status, text: await res.text() };
    }, { body: origBody });
    try {
      const j = JSON.parse(r3.text);
      console.log(`  Content-Type만: ${j?.dataHeader?.resultCode}, 총${j?.dataBody?.data?.총매물건수}건`);
    } catch {}

    // 각 인증 헤더 하나씩 추가하며 테스트
    for (const hdr of authHeaders) {
      const testHeaders = { "Content-Type": "application/json", [hdr]: origHeaders[hdr] };
      const rt = await page.evaluate(async ({ headers, body }) => {
        const res = await fetch("https://api.kbland.kr/land-property/propList/filter", {
          method: "POST",
          headers,
          body,
          credentials: "include",
        });
        return { status: res.status, text: await res.text() };
      }, { headers: testHeaders, body: origBody });
      try {
        const j = JSON.parse(rt.text);
        console.log(`  +${hdr}: ${j?.dataHeader?.resultCode}, 총${j?.dataBody?.data?.총매물건수}건`);
      } catch {}
    }
  }

  // ═══ 4. Vuex 필터 변경 후 /cl/ 네비게이션 ═══
  console.log("\n\n4. Vuex 필터 변경 → /cl/ 네비게이션:");

  // 지도로 돌아가기
  await page.goto("https://kbland.kr/map?xy=37.6055,127.0824,17", {
    waitUntil: "domcontentloaded", timeout: 25000,
  });
  await page.waitForTimeout(5000);

  // Vuex filtersData 변경
  const filterChangeResult = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    const store = vm?.$store;
    if (!store) return { error: "no store" };

    // 현재 필터 상태 확인
    const currentFilters = store.state.map?.filtersData;
    const currentMapParams = store.state.map?.mapParams;

    let mapParamsObj;
    try {
      mapParamsObj = typeof currentMapParams === "string" ? JSON.parse(currentMapParams) : currentMapParams;
    } catch {
      mapParamsObj = currentMapParams;
    }

    return {
      filtersData: JSON.stringify(currentFilters).substring(0, 1000),
      mapParams: JSON.stringify(mapParamsObj).substring(0, 1000),
      mapParamsType: typeof currentMapParams,
    };
  });
  console.log(`  현재 필터: ${filterChangeResult.filtersData?.substring(0, 500)}`);
  console.log(`  현재 맵파라미터: ${filterChangeResult.mapParams?.substring(0, 500)}`);

  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
