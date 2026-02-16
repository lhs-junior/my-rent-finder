#!/usr/bin/env node

/**
 * 부동산114 API Sniffer
 * Playwright stealth로 부동산114 매물 페이지 접속 후 네트워크 요청/응답 캡처
 */

import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

const verbose = process.argv.includes("--verbose");
const headed = process.argv.includes("--headed");

async function sniff() {
  console.log("=== 부동산114 API Sniffer ===");

  const browser = await chromium.launch({
    headless: !headed,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "ko-KR",
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  // Capture all network requests
  const apiCalls = [];
  const jsonResponses = [];

  page.on("request", (req) => {
    const url = req.url();
    if (
      url.includes("api") ||
      url.includes("ajax") ||
      url.includes("search") ||
      url.includes("memul") ||
      url.includes("list") ||
      url.includes("article") ||
      url.includes("internal") ||
      url.includes(".asp") ||
      url.includes(".json")
    ) {
      const entry = {
        url: url.substring(0, 200),
        method: req.method(),
        resourceType: req.resourceType(),
        headers: Object.fromEntries(
          Object.entries(req.headers()).filter(([k]) =>
            ["content-type", "authorization", "cookie", "referer", "x-requested-with"].includes(k),
          ),
        ),
      };
      if (req.method() === "POST") {
        try {
          entry.postData = req.postData()?.substring(0, 500);
        } catch {}
      }
      apiCalls.push(entry);
      if (verbose) console.log(`  [REQ] ${req.method()} ${url.substring(0, 120)}`);
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    const ct = res.headers()["content-type"] || "";
    if (ct.includes("json") || ct.includes("javascript")) {
      try {
        const body = await res.text();
        if (body.length > 10 && body.length < 500000) {
          const entry = {
            url: url.substring(0, 200),
            status: res.status(),
            contentType: ct,
            bodyLength: body.length,
            bodyPreview: body.substring(0, 500),
          };
          jsonResponses.push(entry);
          if (verbose) console.log(`  [RES] ${res.status()} ${url.substring(0, 120)} (${body.length}b)`);
        }
      } catch {}
    }
  });

  // Strategy 1: Visit main listing page
  console.log("\n1. 메인 매물 페이지 접속...");
  try {
    await page.goto("https://www.r114.com/?_c=memul&_m=p10&direct=F", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(5000);
    console.log(`   URL: ${page.url()}`);
    console.log(`   API calls so far: ${apiCalls.length}`);
  } catch (e) {
    console.log(`   Error: ${e.message}`);
  }

  // Strategy 2: Try 원룸 page
  console.log("\n2. 원룸 매물 페이지...");
  try {
    await page.goto("https://www.r114.com/?_c=memul&_m=p10&direct=G", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(5000);
    console.log(`   API calls so far: ${apiCalls.length}`);
  } catch (e) {
    console.log(`   Error: ${e.message}`);
  }

  // Strategy 3: Try mobile version
  console.log("\n3. 모바일 매물 페이지...");
  try {
    const mobilePage = await context.newPage();
    await mobilePage.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    });

    mobilePage.on("request", (req) => {
      const url = req.url();
      if (url.includes("api") || url.includes("search") || url.includes("list") || url.includes(".asp")) {
        apiCalls.push({ url: url.substring(0, 200), method: req.method(), source: "mobile" });
        if (verbose) console.log(`  [M-REQ] ${req.method()} ${url.substring(0, 120)}`);
      }
    });

    mobilePage.on("response", async (res) => {
      const ct = res.headers()["content-type"] || "";
      if (ct.includes("json")) {
        try {
          const body = await res.text();
          jsonResponses.push({
            url: res.url().substring(0, 200),
            status: res.status(),
            bodyLength: body.length,
            bodyPreview: body.substring(0, 500),
            source: "mobile",
          });
        } catch {}
      }
    });

    await mobilePage.goto("https://m.r114.com/?_c=memul", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await mobilePage.waitForTimeout(5000);

    // Try clicking on search/filter buttons
    const searchBtn = await mobilePage.$('a[href*="memul"], button:has-text("검색"), a:has-text("매물")');
    if (searchBtn) {
      await searchBtn.click().catch(() => {});
      await mobilePage.waitForTimeout(3000);
    }

    console.log(`   Mobile API calls: ${apiCalls.filter((a) => a.source === "mobile").length}`);
    await mobilePage.close();
  } catch (e) {
    console.log(`   Mobile error: ${e.message}`);
  }

  // Strategy 4: Try map page
  console.log("\n4. 지도 매물 페이지...");
  try {
    await page.goto("https://www.r114.com/?_c=map", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(8000);
    console.log(`   API calls total: ${apiCalls.length}`);
  } catch (e) {
    console.log(`   Map error: ${e.message}`);
  }

  // Print results
  console.log("\n=== API 호출 발견 ===");
  const uniqueUrls = [...new Set(apiCalls.map((a) => a.url))];
  uniqueUrls.forEach((u, i) => {
    const call = apiCalls.find((a) => a.url === u);
    console.log(`${i + 1}. [${call.method}] ${u}`);
    if (call.postData) console.log(`   POST: ${call.postData.substring(0, 200)}`);
  });

  console.log("\n=== JSON 응답 ===");
  jsonResponses
    .filter((r) => !r.url.includes("google") && !r.url.includes("analytics"))
    .forEach((r, i) => {
      console.log(`${i + 1}. [${r.status}] ${r.url} (${r.bodyLength}b)`);
      console.log(`   Preview: ${r.bodyPreview.substring(0, 200)}`);
    });

  await browser.close();
}

sniff().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
