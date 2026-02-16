#!/usr/bin/env node
/**
 * KB부동산 인증 상태 확인 — 기존 탭만 사용 (새 탭 안 열음)
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== KB부동산 인증 상태 확인 ===\n");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  console.log("✓ Chrome CDP 연결");

  // 기존 kbland.kr 탭 찾기
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes("kbland.kr")) {
        page = p;
        break;
      }
    }
    if (page) break;
  }

  if (!page) {
    console.log("✗ kbland.kr 탭 없음. 먼저 Chrome에서 kbland.kr을 열어주세요.");
    return;
  }
  console.log(`✓ 기존 탭: ${page.url()}\n`);

  // 1. 쿠키 확인
  const context = page.context();
  const cookies = await context.cookies("https://kbland.kr");
  const apiCookies = await context.cookies("https://api.kbland.kr");
  console.log(`1. 쿠키:`);
  console.log(`   kbland.kr: ${cookies.length}개`);
  const authCookies = cookies.filter(c =>
    c.name.includes("token") || c.name.includes("auth") || c.name.includes("session") ||
    c.name.includes("jwt") || c.name.includes("login") || c.name.includes("user") ||
    c.name.includes("JSESSION") || c.name.includes("kb") || c.name.includes("KB")
  );
  if (authCookies.length > 0) {
    console.log(`   🔑 인증 쿠키 ${authCookies.length}개:`);
    authCookies.forEach(c => console.log(`      ${c.name} = ${c.value.substring(0, 40)}...`));
  } else {
    console.log(`   ⚠ 인증 관련 쿠키 없음 (분석용 쿠키만)`);
  }
  console.log(`   api.kbland.kr: ${apiCookies.length}개`);

  // 2. localStorage / sessionStorage 확인
  const storageInfo = await page.evaluate(() => {
    const result = { localStorage: {}, sessionStorage: {} };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        result.localStorage[key] = val ? val.substring(0, 100) : null;
      }
    } catch (e) { result.localStorageError = e.message; }
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        const val = sessionStorage.getItem(key);
        result.sessionStorage[key] = val ? val.substring(0, 100) : null;
      }
    } catch (e) { result.sessionStorageError = e.message; }
    return result;
  });

  console.log(`\n2. localStorage: ${Object.keys(storageInfo.localStorage).length}개`);
  for (const [k, v] of Object.entries(storageInfo.localStorage)) {
    const isAuth = /token|auth|login|user|session|jwt|cert|인증|kb/i.test(k);
    console.log(`   ${isAuth ? "🔑" : "  "} ${k} = ${v}`);
  }

  console.log(`\n3. sessionStorage: ${Object.keys(storageInfo.sessionStorage).length}개`);
  for (const [k, v] of Object.entries(storageInfo.sessionStorage)) {
    const isAuth = /token|auth|login|user|session|jwt|cert|인증|kb/i.test(k);
    console.log(`   ${isAuth ? "🔑" : "  "} ${k} = ${v}`);
  }

  // 3. 현재 페이지에서 로그인 상태 확인
  const loginState = await page.evaluate(() => {
    // 로그인 버튼 존재 여부
    const loginBtn = document.querySelector('[class*="login"], [class*="Login"], a[href*="login"]');
    const loginText = document.body.innerText.includes("로그인하기") || document.body.innerText.includes("로그인");
    const myPageBtn = document.querySelector('[class*="mypage"], [class*="myPage"]');
    const logoutBtn = document.body.innerText.includes("로그아웃");

    return {
      hasLoginButton: !!loginBtn,
      hasLoginText: loginText,
      hasMyPageButton: !!myPageBtn,
      hasLogoutText: logoutBtn,
      loginBtnText: loginBtn?.textContent?.trim()?.substring(0, 50),
    };
  });

  console.log("\n4. 로그인 상태:");
  console.log(`   로그인 버튼: ${loginState.hasLoginButton ? "있음" : "없음"} ${loginState.loginBtnText || ""}`);
  console.log(`   "로그인" 텍스트: ${loginState.hasLoginText ? "있음" : "없음"}`);
  console.log(`   마이페이지 버튼: ${loginState.hasMyPageButton ? "있음" : "없음"}`);
  console.log(`   "로그아웃" 텍스트: ${loginState.hasLogoutText ? "있음" : "없음"}`);
  console.log(`   ▶ ${loginState.hasLogoutText || loginState.hasMyPageButton ? "✓ 로그인됨" : "✗ 로그인 안됨"}`);

  // 4. propList API 테스트 (기존 탭에서)
  console.log("\n5. propList API 테스트 (기존 탭 컨텍스트):");
  const apiTest = await page.evaluate(async () => {
    const body = {
      selectCode: "1,2,3", zoomLevel: 16,
      startLat: 37.646, startLng: 127.043,
      endLat: 37.662, endLng: 127.070,
      "물건종류": "03,05", "거래유형": "3",
      "보증금시작값": "", "보증금종료값": "",
      "월세시작값": "", "월세종료값": "",
      "면적시작값": "", "면적종료값": "",
    };

    const results = [];
    const endpoints = [
      "/land-property/propList/stutCdFilter/list",
      "/land-property/propList/list",
      "/land-property/propList/mapList",
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(`https://api.kbland.kr${ep}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });
        const text = await res.text();
        const json = JSON.parse(text);
        results.push({
          endpoint: ep,
          status: res.status,
          code: json?.dataHeader?.resultCode,
          msg: json?.dataHeader?.message,
          dataKeys: json?.dataBody?.data ? Object.keys(json.dataBody.data) : null,
          dataLength: Array.isArray(json?.dataBody?.data) ? json.dataBody.data.length : null,
          preview: text.substring(0, 200),
        });
      } catch (e) {
        results.push({ endpoint: ep, error: e.message });
      }
    }
    return results;
  });

  for (const r of apiTest) {
    if (r.error) {
      console.log(`   ${r.endpoint}: ERROR ${r.error}`);
    } else {
      const status = r.code === "10000" ? "✓ SUCCESS" : `✗ ${r.code} ${r.msg}`;
      console.log(`   ${r.endpoint}: ${status}`);
      if (r.dataLength != null) console.log(`     데이터: ${r.dataLength}건`);
      if (r.dataKeys) console.log(`     키: ${r.dataKeys.join(", ")}`);
    }
  }

  // 5. 네트워크에서 실제로 어떤 API가 호출되는지 확인
  console.log("\n6. 현재 URL에서 사이트가 사용하는 API 패턴 확인:");
  const pageUrl = page.url();
  console.log(`   현재 URL: ${pageUrl}`);

  // 현재 지도 페이지인지 확인
  if (pageUrl.includes("/map")) {
    console.log("   지도 페이지 감지 — 현재 보이는 매물 정보 확인");
    const mapInfo = await page.evaluate(() => {
      // 매물 마커/카운트 확인
      const floatingBtn = document.querySelector('[class*="floating"], [class*="floting"]');
      const markerDivs = document.querySelectorAll('[class*="btnWithIco"]');
      return {
        floatingText: floatingBtn?.textContent?.trim()?.substring(0, 100),
        markerCount: markerDivs.length,
        visibleMarkers: Array.from(markerDivs).slice(0, 5).map(d => d.textContent?.trim()?.substring(0, 30)),
      };
    });
    console.log(`   플로팅 버튼: ${mapInfo.floatingText || "없음"}`);
    console.log(`   매물 마커: ${mapInfo.markerCount}개`);
    if (mapInfo.visibleMarkers.length > 0) {
      mapInfo.visibleMarkers.forEach(m => console.log(`     - ${m}`));
    }
  }

  console.log("\n=== 확인 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
