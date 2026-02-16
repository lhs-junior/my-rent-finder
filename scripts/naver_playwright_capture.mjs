#!/usr/bin/env node

/**
 * Naver Real Estate STEALTH Automation Network Capture
 * 사용자가 브라우저를 조작하는 동안 네트워크 응답을 자동 캡처
 */

import { chromium } from "playwright";
import fs from "node:fs";

// ============================================================================
// CLI Arguments
// ============================================================================

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const sigungu = getArg("--sigungu", "노원구");
const sampleCap = parseInt(getArg("--sample-cap", "20"), 10);
const outputRaw = getArg("--output-raw", "scripts/naver_raw_samples.jsonl");
const outputMeta = getArg(
  "--output-meta",
  "scripts/naver_capture_results.json",
);
const waitTime = parseInt(getArg("--wait-time", "90"), 10) * 1000; // seconds to ms
const headless = !hasFlag("--headed");

console.log(`🎯 Target: ${sigungu}`);
console.log(`📊 Sample cap: ${sampleCap}`);
console.log(`⏱️  User interaction time: ${waitTime / 1000}s`);
console.log(`🖥️  Headless: ${headless}\n`);

// ============================================================================
// Network Capture
// ============================================================================

async function captureNaverData() {
  const startTime = Date.now();
  const capturedResponses = [];
  const rawStream = fs.createWriteStream(outputRaw, { flags: "w" });

  console.log("🚀 Launching browser...\n");
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  // Intercept ALL JSON network responses
  page.on("response", async (response) => {
    const url = response.url();

    try {
      const status = response.status();
      if (status !== 200) return;

      const contentType = response.headers()["content-type"] || "";
      if (!contentType.includes("json")) return;

      const body = await response.json();

      // Log all JSON responses
      console.log(`  📡 ${url.substring(0, 100)}...`);

      const record = {
        platform_code: "naver",
        collected_at: new Date().toISOString(),
        source_url: page.url(),
        request_url: url,
        response_status: status,
        response_headers: response.headers(),
        payload_json: body,
      };

      capturedResponses.push(record);
      rawStream.write(JSON.stringify(record) + "\n");
    } catch (err) {
      // Ignore parse errors (binary responses, etc.)
    }
  });

  // Navigate to Naver Real Estate
  console.log("🌐 Navigating to Naver Real Estate...\n");

  const targetUrl = "https://new.land.naver.com/houses";
  await page.goto(targetUrl, { waitUntil: "networkidle" });

  console.log("⏳ Initial page load complete\n");
  await page.waitForTimeout(2000);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("👤 USER INTERACTION MODE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("브라우저가 열렸습니다. 다음 작업을 수행해주세요:");
  console.log("");
  console.log(`1. 검색창에서 "${sigungu}" 검색`);
  console.log("2. 거래 유형: 월세 선택");
  console.log("3. 매물 유형: 빌라/연립 + 단독/다가구 포함");
  console.log("4. 가격 필터: 보증금 ≤ 6000만원, 월세 ≤ 80만원");
  console.log("5. 면적 필터: 40m² 이상");
  console.log("6. 지도를 확대하고 매물 클릭하여 상세 정보 확인");
  console.log(`7. 최소 ${sampleCap}개 매물 확인`);
  console.log("");
  console.log("네트워크 응답이 자동으로 캡처됩니다.");
  console.log(`작업 완료 후 ${waitTime / 1000}초 대기 후 자동 종료됩니다.`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Wait for user interaction
  console.log(
    `⏱️  Waiting ${waitTime / 1000} seconds for user interaction...\n`,
  );

  await page.waitForTimeout(waitTime);

  console.log(`\n📊 Captured ${capturedResponses.length} responses\n`);

  rawStream.end();

  console.log("🔒 Closing browser...\n");
  await browser.close();

  // Save metadata
  const metadata = {
    runId: `naver_${Date.now()}`,
    success: true,
    sigungu,
    sampleCap,
    responsesCapture: capturedResponses.length,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };

  fs.writeFileSync(outputMeta, JSON.stringify(metadata, null, 2));

  console.log("✅ Capture complete!");
  console.log(`   Responses: ${capturedResponses.length}`);
  console.log(`   Duration: ${Math.round(metadata.durationMs / 1000)}s`);
  console.log(`   Raw data: ${outputRaw}`);
  console.log(`   Metadata: ${outputMeta}`);
  console.log("");
  console.log("다음 단계:");
  console.log(`   node scripts/naver_normalize.mjs --input ${outputRaw}`);

  return metadata;
}

// ============================================================================
// Main
// ============================================================================

captureNaverData().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
