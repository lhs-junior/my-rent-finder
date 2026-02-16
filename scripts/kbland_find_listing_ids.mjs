#!/usr/bin/env node
/**
 * KB부동산 — 매물일련번호 리스트 획득 방법 탐색
 * 1) /p/ 페이지에서 Vuex propertyList 확인
 * 2) map250mBlwInfoList 고줌레벨에서 개별 매물 마커 확인
 * 3) 지도 마커 클릭 → URL 변경 캡처
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== KB부동산 매물일련번호 리스트 탐색 ===\n");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes("kbland.kr")) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.log("✗ kbland.kr 탭 없음"); return; }
  console.log(`✓ 기존 탭\n`);

  // Helper
  async function apiFetch(url, method = "GET", body = null) {
    return page.evaluate(async ({ u, m, b }) => {
      const opts = { method: m, credentials: "include" };
      if (b) { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(b); }
      const res = await fetch(u, opts);
      return { status: res.status, text: await res.text() };
    }, { u: url, m: method, b: body });
  }

  // ═══ 테스트 1: /p/ 페이지에서 Vuex propertyList 확인 ═══
  console.log("=== 1. /p/ 페이지 Vuex propertyList ===");
  await page.goto("https://kbland.kr/p/217517396?xy=37.5739221,127.0481467,17", {
    waitUntil: "domcontentloaded", timeout: 20000,
  });
  await page.waitForTimeout(8000); // SPA 로딩 대기

  const vuexProperty = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    if (!vm?.$store) return { error: "no vuex" };
    const state = vm.$store.state.property;
    return {
      propertyListData: state?.propertyList?.data ? JSON.stringify(state.propertyList.data).substring(0, 3000) : "null",
      propertyListLoading: state?.propertyList?.isLoading,
    };
  });
  console.log(`  propertyList.isLoading: ${vuexProperty.propertyListLoading}`);
  console.log(`  propertyList.data: ${vuexProperty.propertyListData?.substring(0, 1500)}\n`);

  // Vuex의 map state도 확인
  const vuexMap = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    if (!vm?.$store) return { error: "no vuex" };
    const mapState = vm.$store.state.map;
    const keys = mapState ? Object.keys(mapState) : [];
    const result = { keys };
    for (const k of keys) {
      const v = mapState[k];
      if (v && typeof v === "object") {
        result[k] = JSON.stringify(v).substring(0, 500);
      }
    }
    return result;
  });
  console.log("  Vuex map state keys:", vuexMap.keys?.join(", "));

  // ═══ 테스트 2: 지도에서 단지/건물 클릭 → /p/ URL 추출 ═══
  console.log("\n=== 2. 지도 마커 클릭 → URL 캡처 ===");

  // 네트워크 캡처
  const newApis = [];
  const responseHandler = async (res) => {
    const url = res.url();
    if (!url.includes("api.kbland.kr") || url.includes("menuList") || url.includes("banner")) return;
    try {
      const body = await res.text();
      newApis.push({ url: url.substring(0, 150), size: body.length, preview: body.substring(0, 500) });
    } catch {}
  };
  page.on("response", responseHandler);

  await page.goto("https://kbland.kr/map?xy=37.6055,127.0824,17", {
    waitUntil: "domcontentloaded", timeout: 20000,
  });
  await page.waitForTimeout(5000);

  // 지도의 실제 클릭 가능한 마커 찾기 (SVG/canvas 위의 div overlay)
  const clickTargets = await page.evaluate(() => {
    // 지도 컨테이너 내의 클릭 가능 요소
    const mapDiv = document.querySelector('[class*="map-container"], [class*="naverMap"], #map, .map');

    // 다양한 셀렉터로 마커 찾기
    const selectors = [
      '[class*="marker"]', '[class*="Marker"]',
      '[class*="cluster"]', '[class*="Cluster"]',
      '[class*="overlay"]', '[class*="Overlay"]',
      '[class*="info-window"]', '[class*="InfoWindow"]',
      'div[style*="cursor: pointer"]',
      'div[style*="z-index"][style*="position: absolute"]',
    ];

    const found = {};
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        found[sel] = {
          count: els.length,
          samples: Array.from(els).slice(0, 3).map(el => ({
            tag: el.tagName,
            cls: el.className?.toString()?.substring(0, 60),
            text: el.textContent?.trim()?.substring(0, 50),
            style: el.getAttribute("style")?.substring(0, 80),
            children: el.children?.length,
          })),
        };
      }
    }

    // Naver Map API를 통한 마커 접근 시도
    let naverMapMarkers = null;
    if (window.naver?.maps) {
      naverMapMarkers = "naver.maps available";
    }

    return { found, naverMapMarkers, mapDivExists: !!mapDiv };
  });

  console.log("  Naver Map API:", clickTargets.naverMapMarkers);
  console.log("  Map container:", clickTargets.mapDivExists);
  for (const [sel, data] of Object.entries(clickTargets.found)) {
    console.log(`  ${sel}: ${data.count}개`);
    for (const s of data.samples) {
      console.log(`    ${s.tag}.${s.cls} text="${s.text}" children=${s.children}`);
    }
  }

  // ═══ 테스트 3: map250mBlwInfoList 고줌레벨 ═══
  console.log("\n=== 3. map250mBlwInfoList 줌레벨별 응답 ===");

  // 중화동 275-40 주변 좁은 범위
  for (const zoom of [17, 18, 19]) {
    const offset = zoom === 17 ? 0.005 : zoom === 18 ? 0.002 : 0.001;
    const body = {
      selectCode: "1,2,3", zoomLevel: zoom,
      startLat: 37.6055 - offset, startLng: 127.0824 - offset,
      endLat: 37.6055 + offset, endLng: 127.0824 + offset,
      "물건종류": "03,05", "거래유형": "3",
      "보증금시작값": "", "보증금종료값": "",
      "월세시작값": "", "월세종료값": "",
      "면적시작값": "", "면적종료값": "",
    };

    const result = await apiFetch(
      "https://api.kbland.kr/land-complex/map/map250mBlwInfoList",
      "POST", body
    );
    try {
      const json = JSON.parse(result.text);
      const data = json?.dataBody?.data;
      if (!data) { console.log(`  zoom ${zoom}: no data`); continue; }

      const 단지 = data.단지리스트 || [];
      const 매물 = data.매물리스트 || [];
      const 분양 = data.분양리스트 || [];
      const 비단지 = data.비단지매물리스트 || data.nonComplexList || [];

      console.log(`  zoom ${zoom}: 단지 ${단지.length}, 매물 ${매물.length}, 분양 ${분양.length}, 비단지 ${비단지.length}`);

      // 모든 키 확인
      console.log(`    data keys: ${Object.keys(data).join(", ")}`);

      // 비단지 매물 (개별 매물일 수 있음)
      if (비단지.length > 0) {
        console.log(`    비단지 keys: ${Object.keys(비단지[0]).join(", ")}`);
        console.log(`    비단지 sample: ${JSON.stringify(비단지[0]).substring(0, 500)}`);
      }

      // 단지에 매물일련번호가 있는지
      if (단지.length > 0) {
        const sample = 단지[0];
        const hasListingId = "매물일련번호" in sample;
        console.log(`    단지 keys: ${Object.keys(sample).join(", ")}`);
        console.log(`    단지 has 매물일련번호: ${hasListingId}`);
        if (hasListingId) console.log(`    매물일련번호: ${sample.매물일련번호}`);
      }

      // 매물리스트에 개별 ID가 있는지
      if (매물.length > 0) {
        console.log(`    매물 keys: ${Object.keys(매물[0]).join(", ")}`);
        console.log(`    매물 sample: ${JSON.stringify(매물[0]).substring(0, 500)}`);
      }
    } catch (e) {
      console.log(`  zoom ${zoom}: parse error — ${e.message}`);
    }
  }

  // ═══ 테스트 4: propList with siteToken header ═══
  console.log("\n=== 4. propList with siteToken ===");
  const siteToken = await page.evaluate(() => {
    try {
      const vuex = JSON.parse(localStorage.getItem("vuex") || "{}");
      return vuex?.member?.siteToken || null;
    } catch { return null; }
  });
  console.log(`  siteToken: ${siteToken}`);

  if (siteToken) {
    const propListResult = await page.evaluate(async ({ token }) => {
      const body = {
        selectCode: "1,2,3", zoomLevel: 17,
        startLat: 37.600, startLng: 127.077,
        endLat: 37.610, endLng: 127.087,
        "물건종류": "03,05", "거래유형": "3",
        "보증금시작값": "", "보증금종료값": "",
        "월세시작값": "", "월세종료값": "",
        "면적시작값": "", "면적종료값": "",
      };

      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "X-Auth-Token": token,
        "siteToken": token,
      };

      const results = [];
      for (const ep of [
        "/land-property/propList/stutCdFilter/list",
        "/land-property/propList/nonComplexList",
      ]) {
        try {
          const res = await fetch(`https://api.kbland.kr${ep}`, {
            method: "POST", headers, body: JSON.stringify(body), credentials: "include",
          });
          const text = await res.text();
          results.push({ ep, text: text.substring(0, 500), status: res.status });
        } catch (e) {
          results.push({ ep, error: e.message });
        }
      }
      return results;
    }, { token: siteToken });

    for (const r of propListResult) {
      try {
        const json = JSON.parse(r.text);
        console.log(`  ${r.ep}: ${json?.dataHeader?.resultCode} — ${json?.dataHeader?.message}`);
      } catch {
        console.log(`  ${r.ep}: ${r.status} — ${r.text?.substring(0, 100)}`);
      }
    }
  }

  page.off("response", responseHandler);
  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
