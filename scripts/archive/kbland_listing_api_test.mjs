#!/usr/bin/env node
/**
 * KB부동산 매물 상세 API 호출 + 매물 리스트 획득 방법 탐색
 * 기존 탭에서 page.evaluate(fetch)로 호출 (인증 세션 활용)
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== KB부동산 매물 API 테스트 ===\n");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes("kbland.kr")) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.log("✗ kbland.kr 탭 없음"); return; }
  console.log(`✓ 기존 탭: ${page.url().substring(0, 80)}\n`);

  // Helper: 기존 탭에서 fetch 호출
  async function apiFetch(url) {
    return page.evaluate(async (u) => {
      try {
        const res = await fetch(u, { credentials: "include" });
        const text = await res.text();
        return { ok: true, status: res.status, text };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, url);
  }

  // 1. 매물 기본정보 (bascInfo)
  console.log("1. bascInfo (매물 기본정보):");
  const bascUrl = "https://api.kbland.kr/land-property/property/bascInfo?" +
    encodeURIComponent("매물일련번호") + "=217517396&" +
    encodeURIComponent("단지기본일련번호") + "=";
  const basc = await apiFetch(bascUrl);
  if (basc.ok) {
    const json = JSON.parse(basc.text);
    console.log(`  Status: ${basc.status} | Code: ${json?.dataHeader?.resultCode}`);
    const data = json?.dataBody?.data;
    if (data) {
      console.log(`  Keys: ${Object.keys(data).join(", ")}`);
      console.log(`  Full: ${JSON.stringify(data, null, 2).substring(0, 1500)}`);
    }
  }

  // 2. 매물 상세정보 (dtailInfo)
  console.log("\n2. dtailInfo (매물 상세정보):");
  const dtailUrl = "https://api.kbland.kr/land-property/property/dtailInfo?" +
    encodeURIComponent("매물일련번호") + "=217517396";
  const dtail = await apiFetch(dtailUrl);
  if (dtail.ok) {
    const json = JSON.parse(dtail.text);
    console.log(`  Status: ${dtail.status} | Code: ${json?.dataHeader?.resultCode}`);
    const data = json?.dataBody?.data;
    if (data) {
      console.log(`  Keys: ${Object.keys(data).join(", ")}`);
      console.log(`  Full: ${JSON.stringify(data, null, 2).substring(0, 2000)}`);
    }
  }

  // 3. 매물 유형정보 (typInfo)
  console.log("\n3. typInfo (매물 유형정보):");
  const typUrl = "https://api.kbland.kr/land-property/property/typInfo?" +
    encodeURIComponent("매물일련번호") + "=217517396";
  const typ = await apiFetch(typUrl);
  if (typ.ok) {
    const json = JSON.parse(typ.text);
    console.log(`  Status: ${typ.status} | Code: ${json?.dataHeader?.resultCode}`);
    const data = json?.dataBody?.data;
    if (data) {
      console.log(`  Keys: ${Object.keys(data).join(", ")}`);
      console.log(`  Full: ${JSON.stringify(data, null, 2).substring(0, 1000)}`);
    }
  }

  // 4. 매물 리스트 획득 시도 — Vuex 스토어에서 추출
  console.log("\n\n4. Vuex 스토어에서 매물 리스트 추출 시도:");
  const vuexData = await page.evaluate(() => {
    try {
      // Vue 앱의 Vuex 스토어 접근
      const app = document.querySelector("#app")?.__vue_app__;
      if (app) {
        const store = app.config?.globalProperties?.$store;
        if (store) {
          return { type: "vue3", keys: Object.keys(store.state) };
        }
      }
      // Vue 2 방식
      const vm = document.querySelector("#app")?.__vue__;
      if (vm?.$store) {
        const state = vm.$store.state;
        const keys = Object.keys(state);
        const result = { type: "vue2", keys };
        // property 관련 state 찾기
        for (const k of keys) {
          if (k.includes("prop") || k.includes("property") || k.includes("list") || k.includes("매물")) {
            result[k] = JSON.stringify(state[k]).substring(0, 1000);
          }
        }
        return result;
      }
      // window.__NUXT__ 체크
      if (window.__NUXT__) {
        return { type: "nuxt", keys: Object.keys(window.__NUXT__) };
      }
      return { type: "none" };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log(`  Vuex: ${JSON.stringify(vuexData, null, 2).substring(0, 2000)}`);

  // 5. 지도 페이지의 매물 마커에서 매물일련번호 추출 시도
  console.log("\n5. 지도 마커에서 데이터 추출:");
  // 먼저 지도 페이지로 이동 (중랑구 중화동)
  console.log("  지도 페이지로 이동...");
  await page.goto("https://kbland.kr/map?xy=37.5739,127.0481,17", {
    waitUntil: "domcontentloaded", timeout: 20000,
  });
  await page.waitForTimeout(5000);

  const markerData = await page.evaluate(() => {
    const results = [];

    // 매물 마커의 데이터 속성이나 onclick 핸들러에서 ID 추출
    const markers = document.querySelectorAll('[class*="btnWithIco"]');
    for (const m of Array.from(markers).slice(0, 20)) {
      const data = {
        text: m.textContent?.trim()?.substring(0, 50),
        attrs: {},
        onclick: m.getAttribute("onclick")?.substring(0, 100),
        dataAttrs: {},
      };
      // 모든 data-* 속성
      for (const attr of m.attributes) {
        if (attr.name.startsWith("data-")) {
          data.dataAttrs[attr.name] = attr.value?.substring(0, 50);
        }
      }
      // href
      const link = m.closest("a") || m.querySelector("a");
      if (link) data.href = link.href?.substring(0, 100);

      results.push(data);
    }

    // 또한 a[href*="/p/"] 링크 찾기
    const propLinks = Array.from(document.querySelectorAll('a[href*="/p/"]'))
      .slice(0, 20)
      .map(a => ({ href: a.href?.substring(0, 100), text: a.textContent?.trim()?.substring(0, 50) }));

    // SVG/canvas 마커 체크
    const svgMarkers = document.querySelectorAll("svg [data-id], svg [id]");

    return {
      btnWithIco: results.slice(0, 10),
      propLinks,
      svgMarkerCount: svgMarkers.length,
    };
  });

  console.log(`  btnWithIco 마커: ${markerData.btnWithIco.length}개`);
  for (const m of markerData.btnWithIco.slice(0, 5)) {
    console.log(`    text: "${m.text}" onclick: ${m.onclick || "none"} dataAttrs: ${JSON.stringify(m.dataAttrs)}`);
  }
  console.log(`  /p/ 링크: ${markerData.propLinks.length}개`);
  for (const l of markerData.propLinks.slice(0, 10)) {
    console.log(`    ${l.href} — ${l.text}`);
  }
  console.log(`  SVG 마커: ${markerData.svgMarkerCount}개`);

  // 6. 다른 방법: stutCdFilter 매물 리스트 API를 사이트가 사용하는 정확한 방식으로 호출
  console.log("\n6. stutCdFilter/list — 사이트와 동일한 body로 호출:");
  const listResult = await page.evaluate(async () => {
    const body = {
      selectCode: "1,3",  // 사이트가 사용하는 값 (빌라+단독)
      zoomLevel: 17,
      startLat: 37.5700, startLng: 127.0352,
      endLat: 37.5817, endLng: 127.0610,
      "물건종류": "03,05",
      "거래유형": "3",
      "매매시작값": "", "매매종료값": "",
      "보증금시작값": "", "보증금종료값": "",
      "월세시작값": "", "월세종료값": "",
      "면적시작값": "", "면적종료값": "",
      "준공년도시작값": "", "준공년도종료값": "",
      "방수": "", "욕실수": "",
      "세대수시작값": "", "세대수종료값": "",
      "관리비시작값": "", "관리비종료값": "",
      "용적률시작값": "", "용적률종료값": "",
      "건폐율시작값": "", "건폐율종료값": "",
      "전세가율시작값": "", "전세가율종료값": "",
      "매매전세차시작값": "", "매매전세차종료값": "",
      "월세수익률시작값": "", "월세수익률종료값": "",
      "구조": "", "주차": "", "엘리베이터": "", "보안옵션": "",
    };

    const endpoints = [
      "/land-property/propList/stutCdFilter/list",
      "/land-property/propList/list",
      "/land-property/propList/nonComplexList",
      "/land-property/propList/mapList",
      "/land-property/property/list",
      "/land-property/property/propertyList",
    ];

    const results = [];
    for (const ep of endpoints) {
      try {
        const res = await fetch(`https://api.kbland.kr${ep}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });
        const text = await res.text();
        results.push({ ep, status: res.status, size: text.length, preview: text.substring(0, 500) });
      } catch (e) {
        results.push({ ep, error: e.message });
      }
    }
    return results;
  });

  for (const r of listResult) {
    if (r.error) {
      console.log(`  ${r.ep}: ERROR ${r.error}`);
    } else {
      try {
        const json = JSON.parse(r.preview);
        const code = json?.dataHeader?.resultCode;
        console.log(`  ${r.ep}: ${code} (${r.size}b)`);
        if (code === "10000") {
          console.log(`    ${r.preview.substring(0, 300)}`);
        }
      } catch {
        console.log(`  ${r.ep}: ${r.status} (${r.size}b) — ${r.preview.substring(0, 100)}`);
      }
    }
  }

  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
