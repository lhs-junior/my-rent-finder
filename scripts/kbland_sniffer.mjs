#!/usr/bin/env node

/**
 * KB부동산 Sniffer (CDP 방식)
 * - 이미 실행 중인 Whale 브라우저에 CDP로 연결
 * - kbland.kr 탐색하면서 네트워크 요청/응답 캡처
 * - DOM 구조 분석
 * - 사전 조건: Chrome --remote-debugging-port=9222 실행 + kbland.kr 로그인 완료
 */

import { chromium } from "playwright";
import fs from "node:fs";

const verbose = process.argv.includes("--verbose");

async function sniff() {
  console.log("=== KB부동산 Sniffer (CDP) ===\n");

  // 1. CDP 연결
  let browser;
  try {
    browser = await chromium.connectOverCDP("http://localhost:9222");
    console.log("✓ Chrome 브라우저 연결 성공");
  } catch (e) {
    console.error("❌ Chrome 브라우저에 연결할 수 없습니다.");
    console.error("Chrome을 디버깅 모드로 재시작해 주세요:");
    console.error("/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222");
    process.exit(1);
  }

  const contexts = browser.contexts();
  console.log(`  브라우저 컨텍스트: ${contexts.length}개`);
  const context = contexts[0];

  // 새 탭 열기
  const page = await context.newPage();
  console.log("✓ 새 탭 생성\n");

  // 2. 네트워크 캡처 설정
  const apiCalls = [];
  const jsonResponses = [];

  page.on("request", (req) => {
    const url = req.url();
    if (
      url.includes(".js") || url.includes(".css") || url.includes(".png") ||
      url.includes(".jpg") || url.includes(".gif") || url.includes(".woff") ||
      url.includes(".svg") || url.includes(".ico") || url.includes("google") ||
      url.includes("analytics") || url.includes("facebook") || url.includes("doubleclick")
    ) return;

    if (url.includes("kbland") || url.includes("kbstar") || url.includes("api")) {
      const entry = {
        url: url.substring(0, 300),
        method: req.method(),
        resourceType: req.resourceType(),
      };
      if (req.method() === "POST") {
        try { entry.postData = req.postData()?.substring(0, 500); } catch {}
      }
      apiCalls.push(entry);
      if (verbose) console.log(`  [REQ] ${req.method()} ${url.substring(0, 150)}`);
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    const ct = res.headers()["content-type"] || "";
    if (!ct.includes("json") && !ct.includes("html")) return;
    if (url.includes(".js") || url.includes("google") || url.includes("analytics")) return;

    if (url.includes("kbland") || url.includes("kbstar") || url.includes("api")) {
      try {
        const body = await res.text();
        if (body.length > 10 && body.length < 1000000) {
          const entry = {
            url: url.substring(0, 300),
            status: res.status(),
            contentType: ct,
            bodyLength: body.length,
            bodyPreview: body.substring(0, 2000),
          };

          // JSON 파싱 시도
          try {
            const json = JSON.parse(body);
            entry.isJson = true;
            entry.jsonKeys = Object.keys(json);
            // 매물 데이터 같은 배열 찾기
            for (const [k, v] of Object.entries(json)) {
              if (Array.isArray(v) && v.length > 0) {
                entry.listKey = k;
                entry.listCount = v.length;
                entry.firstItem = JSON.stringify(v[0], null, 2).substring(0, 1000);
              }
            }
          } catch {}

          jsonResponses.push(entry);
          if (verbose) console.log(`  [RES] ${res.status()} ${url.substring(0, 150)} (${body.length}b)`);
        }
      } catch {}
    }
  });

  // 3. kbland.kr 메인 페이지 접속
  console.log("1. kbland.kr 메인 페이지 접속...");
  try {
    await page.goto("https://kbland.kr", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(5000);
    console.log(`   URL: ${page.url()}`);
    console.log(`   Title: ${await page.title()}`);
  } catch (e) {
    console.log(`   메인 페이지 에러: ${e.message}`);
  }

  // 4. 현재 페이지의 쿠키/로그인 상태 확인
  console.log("\n2. 로그인 상태 확인...");
  try {
    const cookies = await context.cookies("https://kbland.kr");
    console.log(`   쿠키 수: ${cookies.length}개`);
    const authCookies = cookies.filter(c =>
      c.name.toLowerCase().includes("session") ||
      c.name.toLowerCase().includes("token") ||
      c.name.toLowerCase().includes("auth") ||
      c.name.toLowerCase().includes("login") ||
      c.name.toLowerCase().includes("jwt") ||
      c.name.toLowerCase().includes("user")
    );
    if (authCookies.length > 0) {
      console.log(`   인증 관련 쿠키: ${authCookies.map(c => c.name).join(", ")}`);
    } else {
      console.log("   인증 쿠키 없음 - 로그인이 필요할 수 있습니다");
    }
  } catch (e) {
    console.log(`   쿠키 확인 실패: ${e.message}`);
  }

  // 5. DOM 구조 분석
  console.log("\n3. DOM 구조 분석...");
  try {
    const domInfo = await page.evaluate(() => {
      const result = {};

      // 주요 네비게이션 링크
      const links = Array.from(document.querySelectorAll("a[href]"));
      result.navLinks = links
        .filter(a => a.href.includes("kbland"))
        .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 50) }))
        .filter(a => a.text.length > 0)
        .slice(0, 30);

      // 검색 관련 input
      const inputs = Array.from(document.querySelectorAll("input"));
      result.inputs = inputs.map(i => ({
        type: i.type,
        placeholder: i.placeholder,
        name: i.name,
        id: i.id,
        className: i.className.substring(0, 100),
      })).slice(0, 20);

      // 버튼들
      const buttons = Array.from(document.querySelectorAll("button"));
      result.buttons = buttons
        .map(b => ({
          text: b.textContent.trim().substring(0, 50),
          className: b.className.substring(0, 100),
          id: b.id,
        }))
        .filter(b => b.text.length > 0)
        .slice(0, 30);

      // iframe 확인
      const iframes = Array.from(document.querySelectorAll("iframe"));
      result.iframes = iframes.map(f => ({
        src: f.src,
        id: f.id,
        className: f.className,
      }));

      // 중요한 div/section 구조
      const sections = Array.from(document.querySelectorAll("[class*='menu'], [class*='nav'], [class*='tab'], [class*='search'], [class*='filter'], [class*='map'], [class*='list']"));
      result.sections = sections
        .map(s => ({
          tag: s.tagName,
          className: s.className.substring(0, 150),
          childCount: s.children.length,
          text: s.textContent.trim().substring(0, 100),
        }))
        .slice(0, 30);

      // body 텍스트 (처음 2000자)
      result.bodyTextPreview = document.body.innerText.substring(0, 2000);

      return result;
    });

    console.log(`   네비게이션 링크: ${domInfo.navLinks.length}개`);
    for (const link of domInfo.navLinks.slice(0, 10)) {
      console.log(`     ${link.text} → ${link.href}`);
    }

    console.log(`   검색 입력: ${domInfo.inputs.length}개`);
    for (const inp of domInfo.inputs) {
      console.log(`     [${inp.type}] placeholder="${inp.placeholder}" id="${inp.id}"`);
    }

    console.log(`   버튼: ${domInfo.buttons.length}개`);
    for (const btn of domInfo.buttons.slice(0, 10)) {
      console.log(`     "${btn.text}" class="${btn.className.substring(0, 50)}"`);
    }

    console.log(`   iframe: ${domInfo.iframes.length}개`);
    for (const iframe of domInfo.iframes) {
      console.log(`     src="${iframe.src}" id="${iframe.id}"`);
    }

    // 중요 섹션
    if (domInfo.sections.length > 0) {
      console.log(`   주요 섹션: ${domInfo.sections.length}개`);
      for (const s of domInfo.sections.slice(0, 10)) {
        console.log(`     <${s.tag}> class="${s.className.substring(0, 60)}" children=${s.childCount}`);
      }
    }

    // bodyText 미리보기
    console.log(`\n   Body 텍스트 (처음 500자):`);
    console.log(`   ${domInfo.bodyTextPreview.substring(0, 500).replace(/\n/g, " | ")}`);

  } catch (e) {
    console.log(`   DOM 분석 실패: ${e.message}`);
  }

  // 6. 매물 검색 페이지 접속 시도
  const searchUrls = [
    "https://kbland.kr/map",
    "https://kbland.kr/map?type=villa",
    "https://kbland.kr/map?xy=37.6542,127.0568,14",
  ];

  for (let i = 0; i < searchUrls.length; i++) {
    console.log(`\n${4 + i}. 접속 시도: ${searchUrls[i]}`);
    try {
      await page.goto(searchUrls[i], {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(5000);
      console.log(`   실제 URL: ${page.url()}`);
      console.log(`   API 호출 총: ${apiCalls.length}건`);

      // 페이지 텍스트 확인
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
      console.log(`   Body: ${bodyText.replace(/\n/g, " | ").substring(0, 300)}`);
    } catch (e) {
      console.log(`   에러: ${e.message}`);
    }
  }

  // 7. 스크린샷에서 본 URL 패턴 시도 (성북구 다가구주택)
  console.log("\n7. 매물 직접 URL 시도...");
  const directUrls = [
    "https://kbland.kr/se",
    "https://kbland.kr/se?type=multi",
    "https://kbland.kr/pages/map/mapView.html",
  ];

  for (const url of directUrls) {
    try {
      console.log(`   시도: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(3000);
      console.log(`   → ${page.url()}`);
    } catch (e) {
      console.log(`   → 실패: ${e.message}`);
    }
  }

  // 8. 결과 출력
  console.log("\n=== API 호출 발견 ===");
  const uniqueUrls = [...new Set(apiCalls.map((a) => a.url))];
  uniqueUrls.forEach((u, i) => {
    const call = apiCalls.find((a) => a.url === u);
    console.log(`${i + 1}. [${call.method}] ${u}`);
    if (call.postData) console.log(`   POST: ${call.postData.substring(0, 300)}`);
  });

  console.log("\n=== JSON 응답 ===");
  jsonResponses.forEach((r, i) => {
    console.log(`\n${i + 1}. [${r.status}] ${r.url} (${r.bodyLength}b)`);
    if (r.jsonKeys) console.log(`   keys: ${r.jsonKeys.join(", ")}`);
    if (r.listKey) console.log(`   LIST: key="${r.listKey}" count=${r.listCount}`);
    if (r.firstItem) console.log(`   firstItem: ${r.firstItem.substring(0, 300)}`);
    console.log(`   preview: ${r.bodyPreview.substring(0, 300)}`);
  });

  // 결과 저장
  const output = {
    apiCalls,
    jsonResponses,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(
    "scripts/kbland_sniffed_data.json",
    JSON.stringify(output, null, 2),
  );
  console.log("\n📁 Saved: scripts/kbland_sniffed_data.json");

  // 탭만 닫기
  await page.close();
  console.log("✓ 탭 닫기 완료 (브라우저는 유지됨)");
}

sniff().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
