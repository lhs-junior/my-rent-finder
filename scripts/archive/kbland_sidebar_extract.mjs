#!/usr/bin/env node
/**
 * KB부동산 — 사이드바에서 매물 리스트 추출
 * /p/ 페이지 사이드바에 표시되는 매물 카드에서 매물일련번호 + 상세 정보 추출
 * 기존 탭만 사용 — 새 탭 안 열음
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== KB부동산 사이드바 매물 추출 ===\n");

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

  // 네트워크 캡처 (매물 리스트 관련 API 찾기)
  const captured = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("api.kbland.kr")) return;
    if (url.includes("menu") || url.includes("banner") || url.includes("notice")
      || url.includes("marketing") || url.includes("stpulConsent")
      || url.includes("getUrgentNotice") || url.includes("serviceAllowCnt")
      || url.includes("scholMarker") || url.includes("allAreaName")
      || url.includes("rankings") || url.includes("PremiumComplex")
      || url.includes("logData") || url.includes("hubLink")) return;

    try {
      const body = await res.text();
      captured.push({
        url: url.substring(0, 200),
        method: res.request().method(),
        size: body.length,
        body: body.substring(0, 5000),
      });
      console.log(`  [NET] ${res.request().method()} ${url.substring(0, 100)} (${body.length}b)`);
    } catch {}
  });

  // 1. /p/ 페이지로 이동 (중랑구 중화동 — 사용자가 봤던 매물)
  console.log("1. 매물 페이지로 이동...");
  await page.goto("https://kbland.kr/p/217517396?xy=37.6055941,127.0824241,17", {
    waitUntil: "domcontentloaded", timeout: 25000,
  });
  console.log("   10초 대기 (SPA 완전 로딩)...");
  await page.waitForTimeout(10000);

  // 2. 전체 DOM 구조 탐색
  console.log("\n2. DOM 구조 탐색:");
  const domStructure = await page.evaluate(() => {
    const result = {};

    // 모든 a 태그에서 /p/ 패턴 찾기
    const allLinks = Array.from(document.querySelectorAll("a"));
    result.pLinks = allLinks
      .filter(a => a.href && a.href.includes("/p/"))
      .map(a => ({
        href: a.href.substring(0, 100),
        text: a.textContent?.trim()?.replace(/\s+/g, " ")?.substring(0, 100),
      }))
      .slice(0, 30);

    // router-link 또는 nuxt-link
    const routerLinks = document.querySelectorAll("[to*='/p/'], [href*='/p/']");
    result.routerLinks = Array.from(routerLinks).slice(0, 10).map(el => ({
      to: el.getAttribute("to")?.substring(0, 100),
      href: el.getAttribute("href")?.substring(0, 100),
      text: el.textContent?.trim()?.replace(/\s+/g, " ")?.substring(0, 80),
    }));

    // 사이드바/패널 영역 찾기
    const panels = document.querySelectorAll(
      '[class*="panel"], [class*="Panel"], [class*="sidebar"], [class*="Sidebar"], ' +
      '[class*="left"], [class*="Left"], [class*="list-wrap"], [class*="listWrap"]'
    );
    result.panels = Array.from(panels).slice(0, 10).map(p => ({
      tag: p.tagName,
      cls: p.className?.toString()?.substring(0, 80),
      childCount: p.children?.length,
      text: p.textContent?.trim()?.replace(/\s+/g, " ")?.substring(0, 200),
    }));

    // 매물 카드 후보: "월세" 또는 "만/" 텍스트 포함하는 요소
    const allElements = document.querySelectorAll("*");
    const cards = [];
    for (const el of allElements) {
      if (el.children.length > 2 && el.children.length < 20) {
        const text = el.textContent?.trim();
        if (text && (text.includes("월세") || text.includes("만/")) && text.length < 500 && text.length > 20) {
          // 부모가 이미 카드인지 확인 (중복 방지)
          const parentInCards = cards.some(c => c.element === el.parentElement);
          if (!parentInCards) {
            cards.push({
              tag: el.tagName,
              cls: el.className?.toString()?.substring(0, 80),
              text: text.replace(/\s+/g, " ").substring(0, 200),
              childCount: el.children.length,
              element: el, // 중복 체크용 (직렬화 안됨)
            });
          }
        }
      }
    }
    result.cards = cards.map(({ element, ...rest }) => rest).slice(0, 20);

    // body 전체 텍스트에서 "매물" 개수 패턴
    const bodyText = document.body.innerText;
    const countMatch = bodyText.match(/총\s*(\d+)\s*개\s*매물/);
    result.totalCountText = countMatch ? countMatch[0] : null;

    // 현재 보이는 주요 텍스트 영역
    result.bodySnippet = bodyText.replace(/\s+/g, " ").substring(0, 1000);

    return result;
  });

  console.log(`  /p/ 링크: ${domStructure.pLinks.length}개`);
  for (const l of domStructure.pLinks.slice(0, 15)) {
    console.log(`    ${l.href} — ${l.text}`);
  }

  console.log(`  router 링크: ${domStructure.routerLinks.length}개`);
  for (const l of domStructure.routerLinks.slice(0, 10)) {
    console.log(`    to=${l.to} href=${l.href} — ${l.text}`);
  }

  console.log(`  패널: ${domStructure.panels.length}개`);
  for (const p of domStructure.panels.slice(0, 5)) {
    console.log(`    ${p.tag}.${p.cls} children=${p.childCount} text="${p.text?.substring(0, 100)}"`);
  }

  console.log(`  매물 카드: ${domStructure.cards.length}개`);
  for (const c of domStructure.cards.slice(0, 10)) {
    console.log(`    [${c.tag}.${c.cls?.substring(0, 40)}] ${c.text}`);
  }

  console.log(`  총 매물 수: ${domStructure.totalCountText || "없음"}`);
  console.log(`  body: ${domStructure.bodySnippet?.substring(0, 500)}`);

  // 3. Vuex property store에서 리스트 데이터
  console.log("\n3. Vuex property store:");
  const vuexProp = await page.evaluate(() => {
    try {
      const vm = document.querySelector("#app")?.__vue__;
      if (!vm?.$store) return { error: "no vuex" };
      const state = vm.$store.state.property;

      // propertyList 상세 확인
      const pList = state?.propertyList;
      const result = {
        isLoading: pList?.isLoading,
        hasData: pList?.data !== null && pList?.data !== undefined,
        dataType: pList?.data ? typeof pList.data : "null",
      };

      if (Array.isArray(pList?.data)) {
        result.count = pList.data.length;
        result.sample = pList.data.slice(0, 3).map(item => {
          if (typeof item === "object" && item) {
            return { keys: Object.keys(item), snippet: JSON.stringify(item).substring(0, 300) };
          }
          return String(item).substring(0, 100);
        });
      } else if (pList?.data && typeof pList.data === "object") {
        result.keys = Object.keys(pList.data);
        result.snippet = JSON.stringify(pList.data).substring(0, 1000);
      }

      // 다른 property state도 확인
      const allKeys = Object.keys(state);
      result.allPropertyStates = {};
      for (const k of allKeys) {
        const v = state[k];
        if (v?.data !== null && v?.data !== undefined) {
          if (Array.isArray(v.data)) {
            result.allPropertyStates[k] = `Array(${v.data.length})`;
          } else if (typeof v.data === "object") {
            result.allPropertyStates[k] = `Object(${Object.keys(v.data).length} keys)`;
          } else {
            result.allPropertyStates[k] = String(v.data).substring(0, 50);
          }
        }
      }

      return result;
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log(`  ${JSON.stringify(vuexProp, null, 2)}`);

  // 4. Vuex map store (safe serialization)
  console.log("\n4. Vuex map store (매물 마커 데이터):");
  const vuexMapSafe = await page.evaluate(() => {
    try {
      const vm = document.querySelector("#app")?.__vue__;
      if (!vm?.$store) return { error: "no vuex" };
      const mapState = vm.$store.state.map;
      if (!mapState) return { error: "no map state" };

      const keys = Object.keys(mapState);
      const result = { keys };
      for (const k of keys) {
        const v = mapState[k];
        if (v === null || v === undefined) continue;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          result[k] = v;
        } else if (Array.isArray(v)) {
          result[k] = `Array(${v.length})`;
          if (v.length > 0 && typeof v[0] === "object") {
            try { result[k + "_sample"] = JSON.stringify(v[0]).substring(0, 300); } catch {}
          }
        } else if (typeof v === "object") {
          try {
            // Safe: only simple objects
            const str = JSON.stringify(v);
            if (str.length < 500) result[k] = str;
            else result[k] = `Object(${Object.keys(v).length} keys: ${Object.keys(v).slice(0, 5).join(", ")})`;
          } catch {
            result[k] = `Object(circular, keys: ${Object.keys(v).slice(0, 5).join(", ")})`;
          }
        }
      }
      return result;
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log(`  ${JSON.stringify(vuexMapSafe, null, 2)}`);

  // 5. 캡처된 네트워크 요청 분석
  console.log(`\n5. 캡처된 API 요청: ${captured.length}건`);
  for (const c of captured) {
    console.log(`  ${c.method} ${c.url}`);
    try {
      const json = JSON.parse(c.body);
      const data = json?.dataBody?.data;
      if (data && Array.isArray(data) && data.length > 0) {
        const hasListingId = data[0] && "매물일련번호" in data[0];
        console.log(`    ✓ Array(${data.length}) hasListingId: ${hasListingId}`);
        if (hasListingId) {
          console.log(`    IDs: ${data.slice(0, 5).map(d => d.매물일련번호).join(", ")}`);
        }
      } else if (data && typeof data === "object") {
        for (const [k, v] of Object.entries(data)) {
          if (Array.isArray(v) && v.length > 0 && v[0]?.매물일련번호) {
            console.log(`    ✓ ${k}: Array(${v.length}) with 매물일련번호`);
            console.log(`    IDs: ${v.slice(0, 5).map(d => d.매물일련번호).join(", ")}`);
          }
        }
      }
    } catch {}
  }

  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
