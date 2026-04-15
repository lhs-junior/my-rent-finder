#!/usr/bin/env node

/**
 * 부동산써브 (serve.co.kr) Real Estate Automated Collector
 *
 * Strategy: Playwright headless browser + passive API response capture
 *
 * serve.co.kr requires a browser session for the API (serveUuid cookie + axios
 * interceptors inject CORS headers). We navigate the SPA map page for each dong
 * and intercept getAtclList JSON responses.
 *
 * Flow:
 *   1. getLdongMap (fetch, no session) → discover dong codes with lat/lng
 *   2. For each dong: page.goto(map?lat=...&lng=...) → capture getAtclList responses
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// ============================================================================
// CLI Arguments
// ============================================================================

const modulePath = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === modulePath
  : false;
const args = isDirectRun ? process.argv.slice(2) : [];

function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function getIntArg(name, fallback = null) {
  const raw = getArg(name, null);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function normalizeSampleCap(raw, fallback = 100) {
  const parsed = Number(raw);
  if (raw === null || raw === undefined || Number.isNaN(parsed)) return fallback;
  if (parsed < 0) return fallback;
  if (!Number.isFinite(parsed) || parsed === 0) return Number.POSITIVE_INFINITY;
  return Math.floor(parsed);
}

const sigungu = getArg("--sigungu", "성동구");
const sampleCap = normalizeSampleCap(getArg("--sample-cap", "100"), 100);
const rentMax = getIntArg("--rent-max", 100); // 만원
const depositMax = getIntArg("--deposit-max", 10000); // 만원
const minAreaM2 = getIntArg("--min-area", 40); // m²
const outputRaw = getArg("--output-raw", "scripts/serve_raw_samples.jsonl");
const outputMeta = getArg("--output-meta", "scripts/serve_capture_results.json");
const verbose = hasFlag("--verbose");

const API_BASE = "https://www.serve.co.kr";
const CATEGORY_CODES = "HOU01,HOU02,HOU03,HOU04,HOU05,HOU06,HOU07,HOU08,HOU09";
const NAV_WAIT_MS = 3000;
// atcl 파라미터를 포함해야 목록 패널이 열리고 getAtclList가 트리거됨
const TRIGGER_ATCL = "331096536";

// ============================================================================
// 구 좌표 (bounds)
// ============================================================================

const DISTRICT_BBOX = {
  // 서울숲/뚝섬 기준 통합 권역 (구 경계 무관, 실거주 범위)
  "서울숲권역": { minLa: 37.5300, maxLa: 37.6350, minLo: 126.9900, maxLo: 127.1200 },
  // 개별 구 (하위 호환)
  "노원구":   { minLa: 37.6200, maxLa: 37.6900, minLo: 127.0200, maxLo: 127.1000 },
  "중랑구":   { minLa: 37.5800, maxLa: 37.6350, minLo: 127.0600, maxLo: 127.1200 },
  "동대문구": { minLa: 37.5550, maxLa: 37.5950, minLo: 127.0100, maxLo: 127.0700 },
  "광진구":   { minLa: 37.5200, maxLa: 37.5600, minLo: 127.0550, maxLo: 127.1100 },
  "성북구":   { minLa: 37.5700, maxLa: 37.6100, minLo: 126.9900, maxLo: 127.0450 },
  "성동구":   { minLa: 37.5400, maxLa: 37.5850, minLo: 127.0100, maxLo: 127.0650 },
  "중구":     { minLa: 37.5450, maxLa: 37.5800, minLo: 126.9700, maxLo: 127.0200 },
  "종로구":   { minLa: 37.5500, maxLa: 37.6000, minLo: 126.9500, maxLo: 127.0100 },
};

// ============================================================================
// Helpers
// ============================================================================

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (msg) => console.log(`[serve] ${msg}`);
const vlog = (msg) => { if (verbose) console.log(`[serve]   ${msg}`); };

// ============================================================================
// Step 1: Discover dong codes via getLdongMap (no session needed)
// ============================================================================

async function discoverDongCodes(targetSigungu) {
  const bbox = DISTRICT_BBOX[targetSigungu];
  if (!bbox) {
    throw new Error(`지원하지 않는 구: ${targetSigungu}. 가능: ${Object.keys(DISTRICT_BBOX).join(", ")}`);
  }

  const params = new URLSearchParams({
    tabNo: "2", zoomLvl: "14",
    minLaCrd: String(bbox.minLa), maxLaCrd: String(bbox.maxLa),
    minLoCrd: String(bbox.minLo), maxLoCrd: String(bbox.maxLo),
    ctgryCdListStr: CATEGORY_CODES, dealKindCdListStr: "B2",
    drcCdListStr: "", lnAmtYnCd: "", maxMmMcost: "", floorExpsrListStr: "",
    redCheck: "false", geoHashYn: "N",
  });

  const res = await fetch(`${API_BASE}/good/v1/map/getLdongMap?${params}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`getLdongMap HTTP ${res.status}`);

  const body = await res.json();
  const markers = body?.data?.resultList || [];

  const dongMap = new Map();
  for (const m of markers) {
    if (!m.ldongCd || !m.emdNm || m.sggNm !== targetSigungu) continue;
    const cnt = parseInt(m.atclCnt, 10) || 0;
    const existing = dongMap.get(m.ldongCd);
    if (!existing || cnt > existing.count) {
      dongMap.set(m.ldongCd, {
        code: m.ldongCd, emdNm: m.emdNm,
        name: `${m.sidoNm} ${m.sggNm} ${m.emdNm}`,
        lat: parseFloat(m.laCrd), lng: parseFloat(m.loCrd),
        count: cnt,
      });
    }
  }

  return Array.from(dongMap.values())
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);
}

// ============================================================================
// 매물 필터링
// ============================================================================

function filterListing(item) {
  if (item.dealKindCd && item.dealKindCd !== "B2") return false;
  const deposit = parseInt(item.bscTnthWuntAmt, 10);
  if (Number.isFinite(deposit) && deposit > depositMax) return false;
  const rent = parseInt(item.addTnthWuntAmt, 10);
  if (Number.isFinite(rent) && rent > rentMax) return false;
  const area = parseFloat(item.area2);
  if (Number.isFinite(area) && area > 0 && area < minAreaM2) return false;
  return true;
}

// ============================================================================
// Step 2: Playwright passive capture
// ============================================================================

async function collectServe() {
  const startTime = Date.now();
  const rawStream = fs.createWriteStream(outputRaw, { flags: "w" });

  log(`Target: ${sigungu}`);
  log(`Sample cap: ${sampleCap}`);
  log(`Filters: rent<=${rentMax}만원, deposit<=${depositMax}만원, area>=${minAreaM2}m²`);
  log("");

  let browser;
  try {
    // Step 1: Discover dongs
    const dongCodes = await discoverDongCodes(sigungu);
    log(`법정동 발견: ${dongCodes.length}개 (${dongCodes.map((d) => `${d.emdNm}[${d.count}]`).join(", ")})`);
    if (dongCodes.length === 0) throw new Error(`${sigungu}에 월세 매물 없음`);

    // Step 2: Launch browser (no resource blocking — Vue app needs full resources)
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    });

    // Block only tracking/analytics (NOT CSS/JS)
    await context.route(/google-analytics|doubleclick|airbridge|nelo\.naver/, (route) => route.abort());

    const globalSeenIds = new Set();
    const allListings = [];
    let totalApiCalls = 0;

    // Process each dong with a fresh page to ensure clean Vue state
    for (const dong of dongCodes) {
      if (allListings.length >= sampleCap) break;

      const page = await context.newPage();
      const dongItems = [];

      // Capture getAtclList responses with B2 filter
      page.on("response", async (response) => {
        if (!response.url().includes("getAtclList")) return;
        try {
          const body = await response.json();
          const items = body?.data?.resultList || [];
          totalApiCalls++;
          for (const item of items) {
            if (item.atclNo && item.dealKindCd === "B2") {
              dongItems.push(item);
            }
          }
        } catch {
          // ignore
        }
      });

      const navUrl = `${API_BASE}/good/map?m=2&lat=${dong.lat}&lng=${dong.lng}&atcl=${TRIGGER_ATCL}`;
      vlog(`${dong.emdNm} 로딩: ${navUrl}`);

      try {
        await page.goto(navUrl, { waitUntil: "networkidle", timeout: 25000 });
        await sleep(NAV_WAIT_MS);
      } catch (err) {
        vlog(`${dong.emdNm} 타임아웃: ${err.message}`);
      }

      // Process captured items
      let dongNewCount = 0;
      for (const item of dongItems) {
        const id = String(item.atclNo);
        if (globalSeenIds.has(id)) continue;
        if (!filterListing(item)) continue;
        globalSeenIds.add(id);
        allListings.push({ ...item, _dongName: dong.name });
        dongNewCount++;
        if (allListings.length >= sampleCap) break;
      }

      if (dongNewCount > 0) {
        log(`${dong.emdNm}: ${dongNewCount}건 수집 (누적 ${allListings.length}건)`);
      } else {
        vlog(`${dong.emdNm}: 신규 0건 (API응답 ${dongItems.length}건)`);
      }

      await page.close();
      await sleep(500);
    }

    await browser.close();
    browser = null;

    // Write JSONL
    for (const item of allListings) {
      const dongName = item._dongName || "";
      delete item._dongName;
      const record = {
        platform_code: "serve",
        collected_at: new Date().toISOString(),
        source_url: `https://www.serve.co.kr/map/?atcl=${item.atclNo}`,
        response_status: 200,
        sigungu,
        dong_name: dongName,
        payload_json: item,
      };
      rawStream.write(JSON.stringify(record) + "\n");
    }
    rawStream.end();

    // Metadata
    let dataQualityGrade = "EMPTY";
    if (allListings.length >= 10) dataQualityGrade = "GOOD";
    else if (allListings.length > 0) dataQualityGrade = "PARTIAL";

    const totalDurationMs = Date.now() - startTime;
    const metadata = {
      runId: `serve_${Date.now()}`,
      success: allListings.length > 0,
      sigungu, sampleCap,
      filters: { rentMax, depositMax, minAreaM2 },
      dongCodes: dongCodes.length,
      totalApiCalls,
      totalFetched: globalSeenIds.size,
      totalListings: allListings.length,
      dataQuality: { grade: dataQualityGrade },
      timestamp: new Date().toISOString(),
      durationMs: totalDurationMs,
    };
    fs.writeFileSync(outputMeta, JSON.stringify(metadata, null, 2));

    log("");
    log("=== Collection Complete ===");
    log(`Success: ${metadata.success}`);
    log(`Total listings: ${allListings.length}`);
    log(`Data quality: ${dataQualityGrade}`);
    log(`API calls: ${totalApiCalls}`);
    log(`Duration: ${Math.round(totalDurationMs / 1000)}s`);
    log(`Raw data: ${outputRaw}`);

    if (allListings.length > 0) {
      log("");
      log("Sample listings:");
      for (const item of allListings.slice(0, 5)) {
        const rent = item.addTnthWuntAmt || "?";
        const dep = item.bscTnthWuntAmt || "?";
        const area = item.area2 || "?";
        const addr = [item.sidoNm, item.sggNm, item.emdNm].filter(Boolean).join(" ") || "?";
        log(`  - [${item.ctgryCd2Nm || "?"}] 보증금${dep}만/월세${rent}만 ${area}m² ${addr}`);
      }
    }

    return metadata;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    const totalDurationMs = Date.now() - startTime;
    const metadata = {
      runId: `serve_${Date.now()}`,
      success: false, sigungu,
      error: err.message,
      totalListings: 0,
      dataQuality: { grade: "EMPTY" },
      timestamp: new Date().toISOString(),
      durationMs: totalDurationMs,
    };
    fs.writeFileSync(outputMeta, JSON.stringify(metadata, null, 2));
    rawStream.end();
    log(`Fatal error: ${err.message}`);
    console.error(err.stack);
    return metadata;
  }
}

// ============================================================================
// Entry Point
// ============================================================================

if (isDirectRun) {
  collectServe().catch((err) => {
    console.error(`[serve] Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}
