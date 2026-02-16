#!/usr/bin/env node
/**
 * KB부동산 /p/{id} 페이지의 API 호출 캡처
 * 기존 탭 사용 — 새 탭 안 열음
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== KB부동산 매물 상세 페이지 API 캡처 ===\n");

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

  const captured = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("api.kbland.kr")) return;
    if (url.match(/\.(js|css|png|jpg|svg|woff)$/)) return;
    // 이미 본 URL 건너뛰기 (메뉴, 배너 등)
    if (url.includes("menuList") || url.includes("banner") || url.includes("notice") || url.includes("marketing")) return;

    try {
      const body = await res.text();
      const req = res.request();
      captured.push({
        url, method: req.method(), status: res.status(),
        size: body.length,
        postData: req.postData()?.substring(0, 500),
        body: body.substring(0, 3000),
      });
      console.log(`  [CAP] ${req.method()} ${url.substring(0, 120)} (${body.length}b)`);
    } catch {}
  });

  // 사용자가 봤던 URL 패턴: /p/217517396 (중랑구 중화동)
  // 먼저 지도 페이지에서 마커 ID를 얻어야 함
  // 일단 사용자가 봤던 URL로 직접 이동
  console.log("1. /p/ 매물 페이지로 이동...");
  await page.goto("https://kbland.kr/p/217517396?xy=37.5739221,127.0481467,17", {
    waitUntil: "domcontentloaded", timeout: 20000,
  });
  await page.waitForTimeout(5000);

  console.log(`\n2. 캡처된 API: ${captured.length}건\n`);
  for (const c of captured) {
    console.log(`=== ${c.method} ${c.url.substring(0, 120)} ===`);
    console.log(`  Status: ${c.status} | Size: ${c.size}b`);
    if (c.postData) console.log(`  PostData: ${c.postData}`);
    try {
      const json = JSON.parse(c.body);
      const code = json?.dataHeader?.resultCode;
      console.log(`  Result: ${code} - ${json?.dataHeader?.message}`);
      const data = json?.dataBody?.data;
      if (data && Array.isArray(data)) {
        console.log(`  ✓ Array: ${data.length}건`);
        if (data[0]) {
          console.log(`  Keys: ${Object.keys(data[0]).join(", ")}`);
          console.log(`  Sample[0]: ${JSON.stringify(data[0]).substring(0, 500)}`);
        }
        if (data[1]) console.log(`  Sample[1]: ${JSON.stringify(data[1]).substring(0, 500)}`);
      } else if (data && typeof data === "object") {
        for (const [k, v] of Object.entries(data)) {
          if (Array.isArray(v) && v.length > 0) {
            console.log(`  ✓ ${k}: ${v.length}건`);
            console.log(`    Keys: ${Object.keys(v[0]).join(", ")}`);
            console.log(`    Sample: ${JSON.stringify(v[0]).substring(0, 500)}`);
            if (v[1]) console.log(`    Sample2: ${JSON.stringify(v[1]).substring(0, 500)}`);
          } else if (typeof v !== "object") {
            console.log(`  ${k}: ${v}`);
          }
        }
      }
    } catch {
      console.log(`  Raw: ${c.body.substring(0, 300)}`);
    }
    console.log();
  }

  // 3. DOM에서 매물 리스트 직접 파싱
  console.log("3. DOM에서 매물 리스트 파싱...");
  const domListings = await page.evaluate(() => {
    const results = [];
    // 사이드바 매물 리스트 영역
    const items = document.querySelectorAll('[class*="list"] li, [class*="item"], [class*="card"]');
    for (const el of items) {
      const text = el.textContent?.trim()?.replace(/\s+/g, " ");
      if (!text || text.length < 10) continue;
      if (text.includes("월세") || text.includes("만/") || text.includes("전세") || text.includes("다가구") || text.includes("빌라")) {
        results.push({
          text: text.substring(0, 250),
          tag: el.tagName,
          cls: el.className?.substring?.(0, 60),
          childCount: el.children?.length,
        });
      }
    }

    // 더 넓은 범위로 검색
    const allText = document.body.innerText;
    const rentMatches = allText.match(/월세\s+[\d,]+만\s*\/\s*[\d,]+만/g);

    return { items: results, rentPatterns: rentMatches?.slice(0, 20) || [] };
  });

  console.log(`   매물 DOM 요소: ${domListings.items.length}개`);
  for (const item of domListings.items.slice(0, 15)) {
    console.log(`   [${item.tag}.${item.cls?.substring(0, 30)}] ${item.text}`);
  }
  console.log(`\n   월세 패턴 매칭: ${domListings.rentPatterns.length}개`);
  domListings.rentPatterns.forEach(m => console.log(`   - ${m}`));

  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
