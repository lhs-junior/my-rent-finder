/**
 * E2E QA: 모바일 필터 UI
 *
 * 검증 항목:
 * TC1  데스크탑(1280px)에서 하단 시트 자체가 숨겨지는지
 * TC2  모바일(390px)에서 하단 시트가 보이는지
 * TC3  모바일에서 "필터" 버튼이 하단 시트 핸들에 보이는지
 * TC4  필터 버튼 클릭 시 필터 오버레이 모달이 열리는지
 * TC5  오버레이에 거래유형 select, 월세 input, 찜만보기 버튼이 있는지
 * TC6  초기화 버튼 클릭 시 오버레이가 유지되고 필드가 리셋되는지
 * TC7  적용 버튼 클릭 시 오버레이가 닫히는지
 * TC8  오버레이 바깥(배경) 클릭 시 오버레이가 닫히는지
 */

import { chromium } from "playwright";

const BASE_URL = "http://localhost:5173";
const DESKTOP_W = 1280;
const MOBILE_W = 390;
const MOBILE_H = 844; // iPhone 14

const results = [];

function record(tc, name, cmd, expected, actual, pass, warn = null) {
  results.push({ tc, name, cmd, expected, actual, pass, warn });
  const icon = pass ? "PASS" : "FAIL";
  console.log(`[${icon}] ${tc}: ${name}`);
  if (!pass) console.log(`  Expected: ${expected}\n  Actual  : ${actual}`);
  if (warn) console.log(`  WARNING : ${warn}`);
}

async function waitForSelector(page, selector, timeout = 5000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch {
    return false;
  }
}

async function collectConsoleErrors(page) {
  const errors = [];
  page.on("console", msg => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

async function runTests() {
  const browser = await chromium.launch({ headless: true });
  const consoleErrors = [];

  try {
    // ─── TC1: 데스크탑에서 하단 시트 숨겨짐 ──────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: DESKTOP_W, height: 900 } });
      const page = await ctx.newPage();
      page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(`[desktop] ${msg.text()}`); });

      await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });

      const sheet = await page.$(".map-bottom-sheet");
      let visible = false;
      if (sheet) {
        visible = await sheet.isVisible();
      }

      record(
        "TC1", "데스크탑(1280px)에서 하단 시트 숨겨짐",
        `goto ${BASE_URL} @ 1280px → check .map-bottom-sheet visibility`,
        "display: none (not visible)",
        sheet ? `visible=${visible}` : "element not found in DOM",
        !visible
      );

      await ctx.close();
    }

    // ─── TC2: 모바일에서 하단 시트 보임 ──────────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: MOBILE_W, height: MOBILE_H } });
      const page = await ctx.newPage();
      page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(`[mobile] ${msg.text()}`); });

      await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });

      const sheet = await page.$(".map-bottom-sheet");
      let visible = false;
      if (sheet) {
        visible = await sheet.isVisible();
      }

      record(
        "TC2", "모바일(390px)에서 하단 시트 보임",
        `goto ${BASE_URL} @ 390px → check .map-bottom-sheet visibility`,
        "display: flex (visible)",
        sheet ? `visible=${visible}` : "element not found in DOM",
        visible
      );

      await ctx.close();
    }

    // ─── TC3–TC8: 모바일 필터 인터랙션 ──────────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: MOBILE_W, height: MOBILE_H } });
      const page = await ctx.newPage();
      page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(`[mobile-filter] ${msg.text()}`); });

      await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });

      // TC3: 필터 버튼 존재 및 가시성
      const filterBtn = await page.$(".map-bottom-filter-btn");
      let filterBtnVisible = false;
      if (filterBtn) filterBtnVisible = await filterBtn.isVisible();

      record(
        "TC3", "모바일에서 하단 시트 핸들에 필터 버튼 보임",
        "check .map-bottom-filter-btn visibility",
        "visible=true",
        filterBtn ? `visible=${filterBtnVisible}` : "element not found",
        filterBtnVisible
      );

      // TC4: 필터 버튼 클릭 → 오버레이 열림
      if (filterBtnVisible) {
        await filterBtn.click();
        // 오버레이가 display:block + 패널 슬라이드업 — 300ms 대기
        await page.waitForTimeout(400);
      }

      const overlay = await page.$(".map-mobile-filter-overlay");
      let overlayVisible = false;
      if (overlay) overlayVisible = await overlay.isVisible();

      record(
        "TC4", "필터 버튼 클릭 시 오버레이 모달 열림",
        "click .map-bottom-filter-btn → .map-mobile-filter-overlay visible",
        "overlayVisible=true",
        overlay ? `visible=${overlayVisible}` : "element not found",
        overlayVisible
      );

      // TC5: 오버레이 내 요소 확인 (거래유형 select, 최소 월세 input, 찜만보기 버튼)
      // Note: desktop left panel also has these elements (hidden). Scope to .map-mobile-filter-panel.
      if (overlayVisible) {
        const leaseTypeSelect = await page.$('.map-mobile-filter-panel select[aria-label="거래 유형"]');
        const rentInput = await page.$('.map-mobile-filter-panel input[aria-label="최소 월세"]');
        const favBtn = await page.$(".map-mobile-filter-panel .map-favorites-only-btn");

        const leaseOk = leaseTypeSelect !== null && await leaseTypeSelect.isVisible();
        const rentOk = rentInput !== null && await rentInput.isVisible();
        const favOk = favBtn !== null && await favBtn.isVisible();

        record(
          "TC5", "오버레이에 거래유형 select, 월세 input, 찜만보기 버튼 존재",
          "check aria-label selects/inputs and .map-favorites-only-btn inside overlay",
          "leaseOk=true, rentOk=true, favOk=true",
          `leaseOk=${leaseOk}, rentOk=${rentOk}, favOk=${favOk}`,
          leaseOk && rentOk && favOk
        );
      } else {
        record(
          "TC5", "오버레이에 거래유형 select, 월세 input, 찜만보기 버튼 존재",
          "check elements inside overlay",
          "overlay must be open",
          "SKIPPED — overlay not open (TC4 failed)",
          false
        );
      }

      // TC6: 초기화 버튼 클릭 — 입력 값 채운 뒤 초기화 후 오버레이 유지 확인
      if (overlayVisible) {
        // 거래유형을 월세로 설정 (scope to panel to avoid hidden desktop duplicate)
        await page.selectOption('.map-mobile-filter-panel select[aria-label="거래 유형"]', "월세");
        await page.fill('.map-mobile-filter-panel input[aria-label="최소 월세"]', "30");
        await page.waitForTimeout(100);

        const resetBtn = await page.$(".map-mobile-filter-reset");
        let resetBtnVisible = resetBtn && await resetBtn.isVisible();

        if (resetBtnVisible) {
          await resetBtn.click();
          await page.waitForTimeout(200);
        }

        // 초기화 후 오버레이가 여전히 열려있어야 함
        const overlayAfterReset = await page.$(".map-mobile-filter-overlay");
        const stillVisible = overlayAfterReset && await overlayAfterReset.isVisible();

        // 거래유형 값이 리셋됐는지 확인 (onFilterChange({}) 호출 → filters={} → select value="")
        const leaseVal = await page.$eval('.map-mobile-filter-panel select[aria-label="거래 유형"]', el => el.value).catch(() => "N/A");

        record(
          "TC6", "초기화 버튼 클릭 시 오버레이 유지 + 필터 리셋",
          "set lease_type='월세', min_rent='30' → click .map-mobile-filter-reset → overlay still open, lease_type=''",
          "overlayStillVisible=true, leaseVal=''",
          `overlayStillVisible=${stillVisible}, leaseVal='${leaseVal}'`,
          stillVisible && leaseVal === ""
        );
      } else {
        record("TC6", "초기화 버튼 클릭 시 오버레이 유지 + 필터 리셋",
          "click reset button", "overlay must be open", "SKIPPED — overlay not open", false);
      }

      // TC7: 적용 버튼 클릭 → 오버레이 닫힘
      // 오버레이가 현재 닫혔을 수 있으니(TC6 reset은 닫지 않음) 상태 확인 후 재오픈
      let currentOverlayVisible = false;
      {
        const ov = await page.$(".map-mobile-filter-overlay");
        currentOverlayVisible = ov ? await ov.isVisible() : false;
      }

      if (!currentOverlayVisible) {
        // 재오픈
        const fb = await page.$(".map-bottom-filter-btn");
        if (fb && await fb.isVisible()) {
          await fb.click();
          await page.waitForTimeout(400);
          const ov = await page.$(".map-mobile-filter-overlay");
          currentOverlayVisible = ov ? await ov.isVisible() : false;
        }
      }

      if (currentOverlayVisible) {
        const applyBtn = await page.$(".map-mobile-filter-apply");
        if (applyBtn && await applyBtn.isVisible()) {
          await applyBtn.click();
          await page.waitForTimeout(300);
        }
        const ov = await page.$(".map-mobile-filter-overlay");
        const closedAfterApply = ov ? !(await ov.isVisible()) : true;

        record(
          "TC7", "적용 버튼 클릭 시 오버레이 닫힘",
          "click .map-mobile-filter-apply → overlay not visible",
          "overlayVisible=false",
          `closedAfterApply=${closedAfterApply}`,
          closedAfterApply
        );
      } else {
        record("TC7", "적용 버튼 클릭 시 오버레이 닫힘",
          "click apply button", "overlay must be open", "SKIPPED — could not reopen overlay", false);
      }

      // TC8: 오버레이 바깥(배경) 클릭 → 오버레이 닫힘
      // 오버레이 재오픈
      {
        const fb = await page.$(".map-bottom-filter-btn");
        if (fb && await fb.isVisible()) {
          await fb.click();
          await page.waitForTimeout(400);
        }
      }

      {
        const ov = await page.$(".map-mobile-filter-overlay");
        const ovVisible = ov ? await ov.isVisible() : false;

        if (ovVisible) {
          // 오버레이 배경 클릭: 패널 바깥쪽 좌상단 좌표
          await page.mouse.click(10, 10);
          await page.waitForTimeout(300);

          const ovAfter = await page.$(".map-mobile-filter-overlay");
          const closedAfterBg = ovAfter ? !(await ovAfter.isVisible()) : true;

          record(
            "TC8", "오버레이 바깥(배경) 클릭 시 닫힘",
            "click at (10,10) on overlay background → overlay not visible",
            "closedAfterBg=true",
            `closedAfterBg=${closedAfterBg}`,
            closedAfterBg
          );
        } else {
          record("TC8", "오버레이 바깥(배경) 클릭 시 닫힘",
            "click overlay background", "overlay must be open", "SKIPPED — could not reopen overlay", false);
        }
      }

      await ctx.close();
    }

  } finally {
    await browser.close();
  }

  // ─── 결과 출력 ────────────────────────────────────────────────────
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  const failed = total - passed;

  console.log("\n========================================");
  console.log("QA Test Report: 모바일 필터 UI");
  console.log("========================================");
  console.log(`Total: ${total}  Passed: ${passed}  Failed: ${failed}`);
  console.log("");

  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.tc}: ${r.name}`);
    if (!r.pass) {
      console.log(`  Command : ${r.cmd}`);
      console.log(`  Expected: ${r.expected}`);
      console.log(`  Actual  : ${r.actual}`);
    }
    if (r.warn) console.log(`  WARNING : ${r.warn}`);
  }

  if (consoleErrors.length > 0) {
    console.log("\n--- Console Errors (WARNING) ---");
    consoleErrors.slice(0, 20).forEach(e => console.log(" ", e));
  } else {
    console.log("\n--- Console Errors: none ---");
  }

  const verdict = failed === 0 ? "PASS" : "FAIL";
  console.log(`\nFinal Verdict: ${verdict}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(2);
});
