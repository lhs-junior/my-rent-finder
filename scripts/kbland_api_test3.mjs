#!/usr/bin/env node
/**
 * KB부동산 API 테스트 3 - CDP 브라우저 세션으로 인증 API 호출
 * 목표: 로그인된 Chrome 세션의 쿠키를 사용하여 매물 리스트 API 호출
 */

import { chromium } from "playwright";

async function main() {
  console.log("=== KB API 테스트 3: CDP 인증 세션 활용 ===\n");

  // 1. CDP 연결
  let browser;
  try {
    browser = await chromium.connectOverCDP("http://localhost:9222");
    console.log("✓ Chrome 연결 성공");
  } catch (e) {
    console.error("Chrome CDP 연결 실패:", e.message);
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts[0];
  const page = await context.newPage();
  console.log("✓ 새 탭 생성\n");

  try {
    // 2. kbland.kr 접속 (쿠키 로드)
    console.log("1. kbland.kr 접속...");
    await page.goto("https://kbland.kr", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    // 3. 쿠키 확인
    const cookies = await context.cookies("https://kbland.kr");
    console.log(`   쿠키: ${cookies.length}개`);
    cookies.forEach(c => console.log(`   - ${c.name}: ${c.value.substring(0, 30)}...`));

    // 4. api.kbland.kr 쿠키도 확인
    const apiCookies = await context.cookies("https://api.kbland.kr");
    console.log(`\n   API 쿠키: ${apiCookies.length}개`);
    apiCookies.forEach(c => console.log(`   - ${c.name}: ${c.value.substring(0, 30)}...`));

    // 5. 브라우저 컨텍스트에서 fetch 호출 (인증 쿠키 포함)
    console.log("\n2. 브라우저 fetch로 매물 API 호출...");

    // 노원구 좌표
    const filterBody = {
      selectCode: "1,2,3",
      zoomLevel: 16,
      startLat: 37.625, startLng: 127.030,
      endLat: 37.680, endLng: 127.085,
      물건종류: "03,05",
      거래유형: "3",
      매매시작값: "", 매매종료값: "",
      보증금시작값: "", 보증금종료값: "",
      월세시작값: "", 월세종료값: "",
      면적시작값: "", 면적종료값: "",
      준공년도시작값: "", 준공년도종료값: "",
      방수: "", 욕실수: "",
      세대수시작값: "", 세대수종료값: "",
      관리비시작값: "", 관리비종료값: "",
      용적률시작값: "", 용적률종료값: "",
      건폐율시작값: "", 건폐율종료값: "",
      전세가율시작값: "", 전세가율종료값: "",
      매매전세차시작값: "", 매매전세차종료값: "",
      월세수익률시작값: "", 월세수익률종료값: "",
      구조: "", 주차: "", 엘리베이터: "", 보안옵션: "",
    };

    // 테스트할 엔드포인트들
    const endpoints = [
      { label: "stutCdFilter/list", path: "/land-property/propList/stutCdFilter/list", body: filterBody },
      { label: "propList/list", path: "/land-property/propList/list", body: filterBody },
      { label: "propList/propList", path: "/land-property/propList/propList", body: filterBody },
      { label: "propList/mapList", path: "/land-property/propList/mapList", body: filterBody },
      { label: "propList + 클러스터식별자", path: "/land-property/propList/stutCdFilter/list", body: { ...filterBody, 클러스터식별자: "510212111" } },
      { label: "propList/nonComplexList", path: "/land-property/propList/nonComplexList", body: filterBody },
    ];

    for (const ep of endpoints) {
      console.log(`\n  --- ${ep.label} ---`);
      const result = await page.evaluate(async ({ url, body }) => {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            credentials: "include",
          });
          const text = await res.text();
          return { status: res.status, size: text.length, text: text.substring(0, 2000) };
        } catch (e) {
          return { error: e.message };
        }
      }, { url: `https://api.kbland.kr${ep.path}`, body: ep.body });

      if (result.error) {
        console.log(`  ERROR: ${result.error}`);
        continue;
      }
      console.log(`  Status: ${result.status} | Size: ${result.size}b`);
      try {
        const json = JSON.parse(result.text);
        const code = json.dataHeader?.resultCode;
        const msg = json.dataHeader?.message;
        console.log(`  Result: ${code} - ${msg}`);
        if (code === "10000") {
          const data = json.dataBody?.data;
          if (Array.isArray(data)) {
            console.log(`  ✓ Items: ${data.length}개`);
            if (data[0]) {
              console.log(`  Keys: ${Object.keys(data[0]).join(", ")}`);
              console.log(`  First: ${JSON.stringify(data[0]).substring(0, 500)}`);
            }
          } else if (typeof data === "object" && data) {
            console.log(`  Keys: ${Object.keys(data).join(", ")}`);
            for (const [k, v] of Object.entries(data)) {
              if (Array.isArray(v)) {
                console.log(`  Array "${k}": ${v.length}개`);
                if (v[0]) {
                  console.log(`    Keys: ${Object.keys(v[0]).join(", ")}`);
                  console.log(`    First: ${JSON.stringify(v[0]).substring(0, 500)}`);
                }
              }
            }
          }
          // dataBody 전체도 확인
          if (json.dataBody) {
            for (const [k, v] of Object.entries(json.dataBody)) {
              if (k !== "data" && k !== "resultCode" && Array.isArray(v) && v.length > 0) {
                console.log(`  dataBody.${k}: ${v.length}개`);
                console.log(`    First: ${JSON.stringify(v[0]).substring(0, 500)}`);
              }
            }
          }
        }
      } catch {
        console.log(`  Raw: ${result.text.substring(0, 300)}`);
      }
    }

    // 6. 네트워크 캡처 방식: 지도에서 마커 클릭 시 API 캡처
    console.log("\n\n3. 네트워크 캡처 방식 테스트...");
    console.log("   지도 페이지로 이동 후 매물 API 요청 캡처");

    const capturedResponses = [];
    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("propList") || url.includes("property") || url.includes("매물")) {
        try {
          const body = await res.text();
          capturedResponses.push({ url, status: res.status(), size: body.length, preview: body.substring(0, 500) });
          console.log(`   [CAPTURED] ${url.substring(0, 100)} (${body.length}b)`);
        } catch {}
      }
    });

    // 노원구 좌표로 지도 이동
    await page.goto("https://kbland.kr/map?xy=37.6542,127.0568,16", {
      waitUntil: "domcontentloaded", timeout: 20000,
    });
    await page.waitForTimeout(5000);

    console.log(`\n   캡처된 매물 API: ${capturedResponses.length}건`);
    for (const r of capturedResponses) {
      console.log(`   ${r.url.substring(0, 80)} → ${r.status} (${r.size}b)`);
      console.log(`   ${r.preview.substring(0, 200)}`);
    }

    // 7. 현재 페이지에서 매물 관련 요소 클릭 시도
    console.log("\n4. 지도 마커/매물 관련 요소 탐색...");
    const mapElements = await page.evaluate(() => {
      // 매물 관련 버튼/탭
      const buttons = Array.from(document.querySelectorAll("button, a, [role='button']"));
      const relevant = buttons.filter(b => {
        const text = (b.textContent || "").trim();
        return text.includes("매물") || text.includes("월세") || text.includes("빌라") ||
               text.includes("다가구") || text.includes("원투룸") || text.includes("집찾는");
      }).map(b => ({
        tag: b.tagName,
        text: (b.textContent || "").trim().substring(0, 50),
        class: b.className?.substring?.(0, 80) || "",
        id: b.id,
      }));

      // 지도 위 마커/SVG
      const markers = document.querySelectorAll("[class*='marker'], [class*='cluster'], svg circle, svg rect");

      return {
        relevantButtons: relevant,
        markerCount: markers.length,
        bodyText: document.body.innerText.substring(0, 500),
      };
    });

    console.log(`   매물 관련 버튼: ${mapElements.relevantButtons.length}개`);
    for (const b of mapElements.relevantButtons) {
      console.log(`   <${b.tag}> "${b.text}" class="${b.class}"`);
    }
    console.log(`   마커/클러스터: ${mapElements.markerCount}개`);
    console.log(`   Body: ${mapElements.bodyText.replace(/\n/g, " | ").substring(0, 300)}`);

  } finally {
    await page.close().catch(() => {});
    console.log("\n✓ 탭 닫기 완료");
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
