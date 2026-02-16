#!/usr/bin/env node
/**
 * KB부동산 네트워크 캡처 — 기존 탭에서 지도 이동 시 API 요청 캡처
 * 새 탭을 열지 않고 기존 kbland.kr 탭만 사용
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== KB부동산 네트워크 캡처 ===\n");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  console.log("✓ CDP 연결");

  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes("kbland.kr")) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.log("✗ kbland.kr 탭 없음"); return; }
  console.log(`✓ 기존 탭: ${page.url().substring(0, 80)}\n`);

  // 네트워크 캡처 설정
  const captured = [];
  page.on("response", async (res) => {
    const url = res.url();
    // api.kbland.kr 요청만 캡처
    if (!url.includes("api.kbland.kr")) return;
    // 정적 리소스 제외
    if (url.match(/\.(js|css|png|jpg|svg|woff)$/)) return;

    try {
      const body = await res.text();
      const req = res.request();
      const postData = req.postData();
      captured.push({
        url: url.substring(0, 150),
        method: req.method(),
        status: res.status(),
        size: body.length,
        postData: postData ? postData.substring(0, 500) : null,
        preview: body.substring(0, 1000),
      });
      console.log(`  [CAP] ${req.method()} ${url.substring(0, 100)} (${body.length}b)`);
    } catch {}
  });

  // 중랑구 중화동 좌표로 지도 페이지 이동 (기존 탭에서)
  console.log("1. 지도 페이지로 이동 (중랑구 중화동)...");
  await page.goto("https://kbland.kr/map?xy=37.5739,127.0481,16", {
    waitUntil: "domcontentloaded", timeout: 20000,
  });
  console.log("   대기 중 (5초)...");
  await page.waitForTimeout(5000);

  console.log(`\n2. 캡처된 API 요청: ${captured.length}건\n`);

  // 결과 분석
  for (const c of captured) {
    console.log(`--- ${c.method} ${c.url} ---`);
    console.log(`  Status: ${c.status} | Size: ${c.size}b`);
    if (c.postData) console.log(`  PostData: ${c.postData.substring(0, 200)}`);
    try {
      const json = JSON.parse(c.preview);
      const code = json?.dataHeader?.resultCode;
      const msg = json?.dataHeader?.message;
      console.log(`  Result: ${code} - ${msg}`);
      const data = json?.dataBody?.data;
      if (data) {
        if (Array.isArray(data)) {
          console.log(`  ✓ Array: ${data.length}건`);
          if (data[0]) console.log(`    Keys: ${Object.keys(data[0]).join(", ")}`);
          if (data[0]) console.log(`    Sample: ${JSON.stringify(data[0]).substring(0, 300)}`);
        } else if (typeof data === "object") {
          for (const [k, v] of Object.entries(data)) {
            if (Array.isArray(v)) {
              console.log(`  ✓ ${k}: ${v.length}건`);
              if (v[0]) console.log(`    Keys: ${Object.keys(v[0]).join(", ")}`);
              if (v[0]) console.log(`    Sample: ${JSON.stringify(v[0]).substring(0, 300)}`);
            } else {
              console.log(`  ${k}: ${JSON.stringify(v).substring(0, 100)}`);
            }
          }
        }
      }
    } catch {}
    console.log();
  }

  // 3. 매물 마커 클릭해서 상세 API 캡처
  console.log("\n3. 매물 마커 클릭 시도...");
  const markers = await page.$$('[class*="btnWithIco"]');
  console.log(`   매물 마커: ${markers.length}개`);

  if (markers.length > 0) {
    const before = captured.length;
    // 첫 번째 마커 클릭
    try {
      await markers[0].click();
      console.log("   마커 클릭 완료, 3초 대기...");
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log(`   마커 클릭 실패: ${e.message}`);
    }

    const newCaptured = captured.slice(before);
    console.log(`   마커 클릭 후 새 API 요청: ${newCaptured.length}건`);
    for (const c of newCaptured) {
      console.log(`   ${c.method} ${c.url}`);
      console.log(`     ${c.preview.substring(0, 300)}`);
      console.log();
    }
  }

  // 4. 매물 리스트 버튼 클릭
  console.log("\n4. 매물 리스트 사이드바 탐색...");
  const listBtn = await page.$('button:has-text("매물"), [class*="btn-rd-floting"]');
  if (listBtn) {
    const before2 = captured.length;
    try {
      await listBtn.click();
      console.log("   매물 리스트 버튼 클릭, 3초 대기...");
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log(`   클릭 실패: ${e.message}`);
    }

    const newCaptured2 = captured.slice(before2);
    console.log(`   새 API 요청: ${newCaptured2.length}건`);
    for (const c of newCaptured2) {
      console.log(`   ${c.method} ${c.url}`);
      console.log(`     ${c.preview.substring(0, 500)}`);
      console.log();
    }
  }

  // 5. 현재 보이는 매물 리스트 DOM에서 직접 추출
  console.log("\n5. DOM에서 매물 데이터 직접 추출...");
  const listings = await page.evaluate(() => {
    const results = [];
    // 매물 카드 형태의 DOM 요소 탐색
    const cards = document.querySelectorAll('[class*="item"], [class*="card"], [class*="list"] li, [class*="property"]');
    for (const card of Array.from(cards).slice(0, 30)) {
      const text = card.textContent?.trim();
      if (!text) continue;
      // 월세/전세/매매 텍스트가 포함된 것만
      if (text.includes("월세") || text.includes("만/")) {
        results.push({
          text: text.replace(/\s+/g, " ").substring(0, 200),
          tag: card.tagName,
          class: card.className?.substring?.(0, 80),
        });
      }
    }
    return results;
  });

  console.log(`   매물 카드 DOM: ${listings.length}개`);
  for (const l of listings.slice(0, 10)) {
    console.log(`   [${l.tag}.${l.class?.substring(0, 30)}] ${l.text}`);
  }

  console.log("\n=== 캡처 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
