#!/usr/bin/env node
/**
 * KB부동산 — Vuex action dispatch + 네트워크 캡처
 * getAsyncPropertyList, getComplexSaleList 호출하며 API 요청 캡처
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== KB부동산 Vuex Action → API 캡처 ===\n");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes("kbland.kr")) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.log("✗ kbland.kr 탭 없음"); return; }

  // 지도 페이지에서 시작
  await page.goto("https://kbland.kr/map?xy=37.6055,127.0824,17", {
    waitUntil: "domcontentloaded", timeout: 25000,
  });
  await page.waitForTimeout(6000);
  console.log("✓ 지도 페이지 로드 완료\n");

  // 네트워크 캡처
  const netLog = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("api.kbland.kr") && !url.includes("menu") && !url.includes("banner")
        && !url.includes("marketing") && !url.includes("notice") && !url.includes("scholMarker")
        && !url.includes("allAreaName") && !url.includes("rankings") && !url.includes("logData")) {
      netLog.push({
        type: "req",
        method: req.method(),
        url: url.substring(0, 200),
        postData: req.postData()?.substring(0, 500),
      });
    }
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("api.kbland.kr") && !url.includes("menu") && !url.includes("banner")
        && !url.includes("marketing") && !url.includes("notice") && !url.includes("scholMarker")
        && !url.includes("allAreaName") && !url.includes("rankings") && !url.includes("logData")) {
      try {
        const body = await res.text();
        netLog.push({
          type: "res",
          url: url.substring(0, 200),
          status: res.status(),
          size: body.length,
          body: body.substring(0, 3000),
        });
      } catch {}
    }
  });

  // ═══ 1. getAsyncPropertyList dispatch ═══
  console.log("=== 1. property/getAsyncPropertyList ===");
  netLog.length = 0;

  // 현재 mapParams 가져오기
  const mapParams = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    const map = vm?.$store?.state?.map;
    return {
      mapParams: map?.mapParams,
      filtersData: map?.filtersData,
    };
  });

  console.log("  현재 mapParams:");
  try {
    const mp = typeof mapParams.mapParams === "string" ? JSON.parse(mapParams.mapParams) : mapParams.mapParams;
    console.log(`    ${JSON.stringify(mp).substring(0, 300)}`);
  } catch {
    console.log(`    ${JSON.stringify(mapParams.mapParams).substring(0, 300)}`);
  }

  const propListResult = await page.evaluate(async () => {
    const vm = document.querySelector("#app")?.__vue__;
    const store = vm?.$store;
    if (!store) return { error: "no store" };

    // mapParams를 그대로 전달
    const params = store.state.map?.mapParams;

    try {
      await store.dispatch("property/getAsyncPropertyList", params);
      await new Promise(r => setTimeout(r, 3000));

      const pList = store.state.property?.propertyList;
      return {
        isLoading: pList?.isLoading,
        isError: pList?.isError,
        error: pList?.error ? String(pList.error).substring(0, 200) : null,
        hasData: pList?.data !== null && pList?.data !== undefined,
        dataType: pList?.data ? (Array.isArray(pList.data) ? "array" : typeof pList.data) : "null",
        dataLength: Array.isArray(pList?.data) ? pList.data.length : null,
        sample: pList?.data ? JSON.stringify(pList.data).substring(0, 1000) : null,
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  console.log(`  결과: ${JSON.stringify(propListResult, null, 2)}`);
  console.log(`  네트워크: ${netLog.length}건`);
  for (const n of netLog) {
    if (n.type === "req") {
      console.log(`    → ${n.method} ${n.url}`);
      if (n.postData) console.log(`      body: ${n.postData.substring(0, 200)}`);
    } else {
      console.log(`    ← ${n.url} (${n.size}b)`);
      try {
        const json = JSON.parse(n.body);
        const code = json?.dataHeader?.resultCode;
        console.log(`      ${code} — ${json?.dataHeader?.message}`);
        const data = json?.dataBody?.data;
        if (Array.isArray(data)) {
          console.log(`      Array(${data.length})`);
          if (data[0]) console.log(`      keys: ${Object.keys(data[0]).join(", ")}`);
          if (data[0]) console.log(`      sample: ${JSON.stringify(data[0]).substring(0, 400)}`);
        }
      } catch {}
    }
  }

  // ═══ 2. complex/getComplexSaleList dispatch ═══
  console.log("\n=== 2. complex/getComplexSaleList ===");
  netLog.length = 0;

  // 단지기본일련번호 가져오기
  const danjiIds = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    const list = vm?.$store?.state?.map?.markerDanjiList || [];
    return list.slice(0, 5).map(d => ({
      id: d.단지기본일련번호,
      name: d.단지명,
      count: d.매물개수,
      type: d.물건종류,
    }));
  });
  console.log(`  단지: ${danjiIds.length}개`);
  for (const d of danjiIds) {
    console.log(`    ${d.id}: ${d.name} (${d.count}건, type=${d.type})`);
  }

  if (danjiIds.length > 0) {
    const targetDanji = danjiIds.find(d => d.count > 0) || danjiIds[0];
    console.log(`\n  대상: ${targetDanji.id} ${targetDanji.name}`);

    const saleListResult = await page.evaluate(async ({ danjiId }) => {
      const vm = document.querySelector("#app")?.__vue__;
      const store = vm?.$store;

      try {
        await store.dispatch("complex/getComplexSaleList", { 단지기본일련번호: danjiId });
        await new Promise(r => setTimeout(r, 3000));

        const complex = store.state.complex;
        // 찾기: complex state에서 saleList 관련 데이터
        const keys = Object.keys(complex);
        const result = { complexKeys: keys };
        for (const k of keys) {
          const v = complex[k];
          if (v?.data !== undefined && v?.data !== null) {
            if (Array.isArray(v.data)) {
              result[k] = { type: "array", length: v.data.length };
              if (v.data[0]) {
                result[k].keys = Object.keys(v.data[0]);
                result[k].sample = JSON.stringify(v.data[0]).substring(0, 500);
              }
            } else if (typeof v.data === "object") {
              result[k] = { type: "object", keys: Object.keys(v.data) };
              // 하위 배열 확인
              for (const [sk, sv] of Object.entries(v.data)) {
                if (Array.isArray(sv) && sv.length > 0) {
                  result[`${k}.${sk}`] = { type: "array", length: sv.length };
                  if (sv[0]) {
                    result[`${k}.${sk}`].keys = Object.keys(sv[0]);
                    result[`${k}.${sk}`].sample = JSON.stringify(sv[0]).substring(0, 500);
                    result[`${k}.${sk}`].has매물ID = "매물일련번호" in sv[0];
                  }
                }
              }
            }
          }
        }
        return result;
      } catch (e) {
        return { error: e.message };
      }
    }, { danjiId: targetDanji.id });

    console.log(`  결과: ${JSON.stringify(saleListResult, null, 2).substring(0, 2000)}`);
  }

  console.log(`\n  네트워크: ${netLog.length}건`);
  for (const n of netLog) {
    if (n.type === "req") {
      console.log(`    → ${n.method} ${n.url}`);
      if (n.postData) console.log(`      body: ${n.postData.substring(0, 300)}`);
    } else {
      console.log(`    ← ${n.url} (${n.size}b)`);
      try {
        const json = JSON.parse(n.body);
        const code = json?.dataHeader?.resultCode;
        console.log(`      ${code} — ${json?.dataHeader?.message}`);
        const data = json?.dataBody?.data;
        if (Array.isArray(data) && data.length > 0) {
          console.log(`      ✓ Array(${data.length})`);
          console.log(`      keys: ${Object.keys(data[0]).join(", ")}`);
          console.log(`      has 매물일련번호: ${"매물일련번호" in data[0]}`);
          console.log(`      sample: ${JSON.stringify(data[0]).substring(0, 500)}`);
          if (data.length > 1) console.log(`      sample2: ${JSON.stringify(data[1]).substring(0, 500)}`);
        } else if (data && typeof data === "object") {
          for (const [k, v] of Object.entries(data)) {
            if (Array.isArray(v) && v.length > 0) {
              console.log(`      ✓ ${k}: Array(${v.length})`);
              console.log(`      keys: ${Object.keys(v[0]).join(", ")}`);
              console.log(`      has 매물일련번호: ${"매물일련번호" in v[0]}`);
              console.log(`      sample: ${JSON.stringify(v[0]).substring(0, 500)}`);
            }
          }
        }
      } catch {}
    }
  }

  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
