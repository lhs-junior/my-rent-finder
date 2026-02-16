#!/usr/bin/env node

/**
 * PeterPanz (피터팬) Real Estate Automated Collector
 *
 * Strategy: Playwright stealth browser + map interaction → API response intercept
 *
 * PeterPanz loads listing data via `/houses/area/pc` API after the Naver Map
 * triggers a bounds-change. We navigate the SPA, simulate a map drag, and
 * intercept the JSON response.
 *
 * Required custom headers: x-peterpanz-version, x-peterpanz-page-id, x-peterpanz-os
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "node:fs";

chromium.use(StealthPlugin());

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

const sigungu = getArg("--sigungu", "노원구");
const sampleCap = normalizeSampleCap(getArg("--sample-cap", "100"), 100);
const rentMax = getIntArg("--rent-max", 80); // 만원
const depositMax = getIntArg("--deposit-max", 6000); // 만원
const minAreaM2 = getIntArg("--min-area", 40); // m²
const outputRaw = getArg("--output-raw", "scripts/peterpanz_raw_samples.jsonl");
const outputMeta = getArg("--output-meta", "scripts/peterpanz_capture_results.json");
const headless = !hasFlag("--headed");
const verbose = hasFlag("--verbose");

// ============================================================================
// District Coordinates & Bounding Boxes
// ============================================================================

const DISTRICT_COORDS = {
  "노원구":   { lat: 37.6542, lng: 127.0568 },
  "중랑구":   { lat: 37.5953, lng: 127.0937 },
  "동대문구": { lat: 37.5744, lng: 127.0396 },
  "광진구":   { lat: 37.5384, lng: 127.0822 },
  "성북구":   { lat: 37.5894, lng: 127.0167 },
  "성동구":   { lat: 37.5633, lng: 127.0371 },
  "중구":     { lat: 37.5641, lng: 126.9979 },
  "종로구":   { lat: 37.5735, lng: 126.9790 },
};

const DISTRICT_BBOX = {
  "노원구":   { sw_lat: 37.6200, sw_lng: 127.0200, ne_lat: 37.6900, ne_lng: 127.1000 },
  "중랑구":   { sw_lat: 37.5800, sw_lng: 127.0600, ne_lat: 37.6350, ne_lng: 127.1200 },
  "동대문구": { sw_lat: 37.5550, sw_lng: 127.0100, ne_lat: 37.5950, ne_lng: 127.0700 },
  "광진구":   { sw_lat: 37.5200, sw_lng: 127.0550, ne_lat: 37.5600, ne_lng: 127.1100 },
  "성북구":   { sw_lat: 37.5700, sw_lng: 126.9900, ne_lat: 37.6100, ne_lng: 127.0450 },
  "성동구":   { sw_lat: 37.5400, sw_lng: 127.0100, ne_lat: 37.5850, ne_lng: 127.0650 },
  "중구":     { sw_lat: 37.5450, sw_lng: 126.9700, ne_lat: 37.5800, ne_lng: 127.0200 },
  "종로구":   { sw_lat: 37.5500, sw_lng: 126.9500, ne_lat: 37.6000, ne_lng: 127.0100 },
};

const district = DISTRICT_COORDS[sigungu];
if (!district) {
  console.error(`[peterpanz] ERROR: Unknown district: ${sigungu}`);
  console.error(`[peterpanz] Available: ${Object.keys(DISTRICT_COORDS).join(", ")}`);
  process.exit(1);
}

const bbox = DISTRICT_BBOX[sigungu];

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg) {
  console.log(`[peterpanz] ${msg}`);
}

function vlog(msg) {
  if (verbose) console.log(`[peterpanz]   ${msg}`);
}

/**
 * Build PeterPanz villa page URL with filter parameters.
 */
function buildPeterpanzUrl() {
  const center = JSON.stringify({
    y: district.lat, _lat: district.lat,
    x: district.lng, _lng: district.lng,
  });

  const filterParts = [
    `latitude:${bbox.sw_lat}~${bbox.ne_lat}`,
    `longitude:${bbox.sw_lng}~${bbox.ne_lng}`,
    `checkDeposit:0~${depositMax * 10000}`,
    `checkMonth:0~${rentMax * 10000}`,
    `checkRealSize:${minAreaM2}~999`,
    'contractType;["월세"]',
    'roomType;["투룸","원룸","쓰리룸"]',
    'buildingType;["빌라/주택"]',
  ];

  const filter = filterParts.join("||");
  return `https://www.peterpanz.com/villa?zoomLevel=14&center=${encodeURIComponent(center)}&dong=&gungu=&filter=${encodeURIComponent(filter)}`;
}

/**
 * Build direct API URL for houses list.
 */
function buildApiUrl(pageIndex = 1, pageSize = 50) {
  const center = JSON.stringify({
    y: district.lat, _lat: district.lat,
    x: district.lng, _lng: district.lng,
  });

  const filterParts = [
    `latitude:${bbox.sw_lat}~${bbox.ne_lat}`,
    `longitude:${bbox.sw_lng}~${bbox.ne_lng}`,
    `checkDeposit:0~${depositMax * 10000}`,
    `checkMonth:0~${rentMax * 10000}`,
    `checkRealSize:${minAreaM2}~999`,
    'contractType;["월세"]',
    'roomType;["투룸","원룸","쓰리룸"]',
    'buildingType;["빌라/주택"]',
  ];

  const filter = filterParts.join("||");
  const params = new URLSearchParams({
    zoomLevel: "14",
    center,
    dong: "",
    gungu: "",
    filter,
    pageSize: String(pageSize),
    pageIndex: String(pageIndex),
    search: "",
    response_version: "5.3",
    filter_version: "5.1",
    order_by: "random",
  });
  return `https://api.peterpanz.com/houses/area/pc?${params.toString()}`;
}

/**
 * Extract individual house items from the API response.
 * The response groups houses as: houses.recommend.image[], houses.withoutFee.image[], etc.
 */
function extractHousesFromResponse(data) {
  const houses = [];
  const seen = new Set();

  if (!data?.houses) return houses;

  for (const group of Object.values(data.houses)) {
    if (!group || typeof group !== "object") continue;
    // Each group has sub-arrays: image[], text[], etc.
    for (const items of Object.values(group)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item?.hidx) continue;
        if (seen.has(item.hidx)) continue;
        seen.add(item.hidx);
        houses.push(item);
      }
    }
  }

  return houses;
}

/**
 * Apply search condition filters to captured listings.
 */
function filterListings(items) {
  const before = items.length;
  const reasons = { rent: 0, deposit: 0, area: 0, type: 0, location: 0 };

  const filtered = items.filter((item) => {
    // Contract type filter (월세 only)
    const contractType = item.type?.contract_type;
    if (contractType && contractType !== "월세") {
      reasons.type++;
      return false;
    }

    // Rent filter (원 → 만원)
    const monthlyFee = item.price?.monthly_fee;
    if (monthlyFee != null && monthlyFee > 0 && monthlyFee / 10000 > rentMax) {
      reasons.rent++;
      return false;
    }

    // Deposit filter (원 → 만원)
    const deposit = item.price?.deposit;
    if (deposit != null && deposit > 0 && deposit / 10000 > depositMax) {
      reasons.deposit++;
      return false;
    }

    // Area filter (m²)
    const realSize = item.info?.real_size;
    if (realSize != null && realSize > 0 && realSize < minAreaM2) {
      reasons.area++;
      return false;
    }

    // Location filter
    if (bbox && item.location?.coordinate) {
      const PAD = 0.008;
      const lat = parseFloat(item.location.coordinate.latitude);
      const lng = parseFloat(item.location.coordinate.longitude);
      if (
        Number.isFinite(lat) && Number.isFinite(lng) &&
        (lat < bbox.sw_lat - PAD || lat > bbox.ne_lat + PAD ||
         lng < bbox.sw_lng - PAD || lng > bbox.ne_lng + PAD)
      ) {
        reasons.location++;
        return false;
      }
    }

    return true;
  });

  if (before !== filtered.length) {
    log(`Filtered: ${before} -> ${filtered.length} (type:${reasons.type}, rent:${reasons.rent}, deposit:${reasons.deposit}, area:${reasons.area}, location:${reasons.location})`);
  }

  return filtered;
}

// ============================================================================
// Core Collection Logic
// ============================================================================

async function collectPeterpanz() {
  const startTime = Date.now();
  const rawStream = fs.createWriteStream(outputRaw, { flags: "w" });

  log(`Target: ${sigungu} (lat=${district.lat}, lng=${district.lng})`);
  log(`Sample cap: ${sampleCap}`);
  log(`Filters: rent<=${rentMax}만원, deposit<=${depositMax}만원, area>=${minAreaM2}m²`);
  log(`Headless: ${headless}`);
  log("");

  const browser = await chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });

    const page = await context.newPage();
    const pageUrl = buildPeterpanzUrl();
    log(`Page URL: ${pageUrl.slice(0, 120)}...`);

    // ---- Inject full filter params into SPA's API requests via route ----
    // The SPA strips contractType/checkMonth/checkDeposit/checkRealSize from its
    // own API requests. We intercept outgoing /houses/area/pc requests and inject
    // the missing filter params so the server returns pre-filtered results.
    const extraFilters = [
      `checkDeposit:0~${depositMax * 10000}`,
      `checkMonth:0~${rentMax * 10000}`,
      `checkRealSize:${minAreaM2}~999`,
      'contractType;["월세"]',
      'roomType;["투룸","원룸","쓰리룸"]',
    ].join("||");

    await page.route("**/houses/area/pc**", async (route) => {
      const origUrl = route.request().url();
      try {
        const u = new URL(origUrl);
        const currentFilter = u.searchParams.get("filter") || "";
        // Only inject if our filters aren't already present
        if (!currentFilter.includes("contractType")) {
          u.searchParams.set("filter", currentFilter + "||" + extraFilters);
          vlog(`Injected filters into API request`);
        }
        await route.continue({ url: u.toString() });
      } catch {
        await route.continue();
      }
    });

    // ---- Intercept API responses ----
    let interceptedHouses = [];

    page.on("response", async (response) => {
      const url = response.url();
      if (!url.includes("/houses/area/pc")) return;
      if (response.status() !== 200) return;
      try {
        const body = await response.json();
        const items = extractHousesFromResponse(body);
        interceptedHouses.push(...items);
        vlog(`Intercepted /houses/area/pc: ${items.length} items`);
      } catch { /* non-JSON */ }
    });

    // ---- Navigate & establish session ----
    log("Navigating to PeterPanz...");
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(5000);

    // Map drag triggers the SPA to call /houses/area/pc (now with injected filters)
    log("Triggering map interaction...");
    await page.mouse.move(720, 400);
    await page.mouse.down();
    await page.mouse.move(740, 415, { steps: 5 });
    await page.mouse.up();
    await sleep(5000);

    log(`After map interaction: ${interceptedHouses.length} items`);

    // ---- Additional map drags if we need more data ----
    if (interceptedHouses.length < sampleCap && interceptedHouses.length > 0) {
      log("Performing additional map drags for more data...");
      for (let attempt = 0; attempt < 2; attempt++) {
        const dx = (attempt + 1) * 30;
        await page.mouse.move(720, 400);
        await page.mouse.down();
        await page.mouse.move(720 + dx, 400 - dx, { steps: 5 });
        await page.mouse.up();
        await sleep(4000);
        if (interceptedHouses.length >= sampleCap * 2) break;
      }
      log(`After extra drags: ${interceptedHouses.length} items`);
    }

    const allHouses = interceptedHouses;

    // ---- Deduplicate ----
    const seen = new Set();
    const uniqueItems = allHouses.filter((item) => {
      if (seen.has(item.hidx)) return false;
      seen.add(item.hidx);
      return true;
    });
    log(`Total unique: ${uniqueItems.length}`);

    // ---- Filter ----
    const filtered = filterListings(uniqueItems);
    const capped = filtered.slice(0, sampleCap);
    log(`After filter + cap: ${capped.length} items`);

    // ========================================================================
    // Write raw JSONL
    // ========================================================================

    for (const item of capped) {
      const record = {
        platform_code: "peterpanz",
        collected_at: new Date().toISOString(),
        source_url: `https://www.peterpanz.com/house/${item.hidx}`,
        request_url: buildApiUrl(1, 50),
        response_status: 200,
        sigungu,
        payload_json: item,
      };
      rawStream.write(JSON.stringify(record) + "\n");
    }

    rawStream.end();
    await page.close();
    await browser.close();

    // ========================================================================
    // Write metadata
    // ========================================================================

    let dataQualityGrade = "EMPTY";
    if (capped.length >= 10) dataQualityGrade = "GOOD";
    else if (capped.length > 0) dataQualityGrade = "PARTIAL";

    const totalDurationMs = Date.now() - startTime;

    const metadata = {
      runId: `peterpanz_${Date.now()}`,
      success: capped.length > 0,
      sigungu,
      sampleCap,
      filters: { rentMax, depositMax, minAreaM2 },
      totalIntercepted: allHouses.length,
      totalUnique: uniqueItems.length,
      afterFilter: filtered.length,
      totalListings: capped.length,
      dataQuality: { grade: dataQualityGrade },
      timestamp: new Date().toISOString(),
      durationMs: totalDurationMs,
    };

    fs.writeFileSync(outputMeta, JSON.stringify(metadata, null, 2));

    log("");
    log("=== Collection Complete ===");
    log(`Success: ${metadata.success}`);
    log(`Total listings: ${capped.length}`);
    log(`Data quality: ${dataQualityGrade}`);
    log(`Duration: ${Math.round(totalDurationMs / 1000)}s`);
    log(`Raw data: ${outputRaw}`);
    log(`Metadata: ${outputMeta}`);

    // Sample listings
    if (capped.length > 0) {
      log("");
      log("Sample listings:");
      for (const item of capped.slice(0, 5)) {
        const rent = item.price?.monthly_fee ? Math.round(item.price.monthly_fee / 10000) : "?";
        const dep = item.price?.deposit ? Math.round(item.price.deposit / 10000) : "?";
        const area = item.info?.real_size || "?";
        const addr = item.location?.address?.text || "?";
        const title = item.info?.subject?.substring(0, 40) || "";
        log(`  - [${item.info?.room_type || "?"}] 보증금${dep}만/월세${rent}만 ${area}m² ${addr} "${title}..."`);
      }
    }

    return metadata;

  } catch (err) {
    try { await browser.close(); } catch { /* ignore */ }

    const totalDurationMs = Date.now() - startTime;
    const metadata = {
      runId: `peterpanz_${Date.now()}`,
      success: false,
      sigungu,
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

collectPeterpanz().catch((err) => {
  console.error(`[peterpanz] Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
