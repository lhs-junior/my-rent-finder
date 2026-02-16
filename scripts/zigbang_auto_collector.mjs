#!/usr/bin/env node

/**
 * Zigbang (직방) Real Estate Automated Collector with Multi-Strategy Fallback
 *
 * Tries 4 strategies in order:
 *   1. Direct API call (no browser)
 *   2. Playwright network intercept
 *   3. Playwright browser-context API call
 *   4. DOM parsing
 *
 * Stops at the first strategy that succeeds.
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "node:fs";
import path from "node:path";

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
const rentMax = getIntArg("--rent-max", 80);
const depositMax = getIntArg("--deposit-max", 6000);
const minArea = getIntArg("--min-area", 40);
const outputRaw = getArg("--output-raw", "scripts/zigbang_raw_samples.jsonl");
const outputMeta = getArg("--output-meta", "scripts/zigbang_capture_results.json");
const headless = !hasFlag("--headed");
const verbose = hasFlag("--verbose");

// Zigbang uses 원 (won), our CLI uses 만원 -> multiply by 10000
const rentMaxWon = rentMax * 10000;
const depositMaxWon = depositMax * 10000;

console.log(`[zigbang] Target: ${sigungu}`);
console.log(`[zigbang] Sample cap: ${sampleCap}`);
console.log(`[zigbang] Filters: rent<=${rentMax}만원(${rentMaxWon}원), deposit<=${depositMax}만원(${depositMaxWon}원), area>=${minArea}m2`);
console.log(`[zigbang] Headless: ${headless}`);
console.log("");

// ============================================================================
// District Coordinates
// ============================================================================

const COORDS_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "zigbang_district_coords.json",
);

let districtCoords = {};
try {
  const raw = fs.readFileSync(COORDS_PATH, "utf8");
  districtCoords = JSON.parse(raw);
} catch (err) {
  console.error(`[zigbang] ERROR: Cannot load district coords: ${err.message}`);
  process.exit(1);
}

const district = districtCoords[sigungu];
if (!district) {
  console.error(`[zigbang] ERROR: Unknown district: ${sigungu}`);
  console.error(`[zigbang] Available: ${Object.keys(districtCoords).join(", ")}`);
  process.exit(1);
}

// ============================================================================
// Geohash Encoding
// ============================================================================

function encodeGeohash(lat, lng, precision = 5) {
  const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180;
  let hash = "";
  let isLng = true;
  let bit = 0;
  let ch = 0;
  while (hash.length < precision) {
    if (isLng) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { ch |= (1 << (4 - bit)); minLng = mid; } else { maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { ch |= (1 << (4 - bit)); minLat = mid; } else { maxLat = mid; }
    }
    isLng = !isLng;
    bit++;
    if (bit === 5) { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min = 1000, max = 3000) {
  return sleep(Math.floor(Math.random() * (max - min + 1)) + min);
}

function withTimeout(promise, ms, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

function log(msg) {
  console.log(`[zigbang] ${msg}`);
}

function vlog(msg) {
  if (verbose) console.log(`[zigbang]   ${msg}`);
}

function makeRecord(payload, requestUrl, sourceUrl = "", responseStatus = 200) {
  return {
    platform_code: "zigbang",
    collected_at: new Date().toISOString(),
    source_url: sourceUrl,
    request_url: requestUrl,
    response_status: responseStatus,
    payload_json: payload,
  };
}

/**
 * Extract listing fields from a raw Zigbang item for filtering.
 * Zigbang API responses use various field names across versions.
 */
function extractListingFields(item) {
  const rent = item.rent ?? item.월세 ?? item.rentPrice ?? item.rent_price ?? null;
  const deposit = item.deposit ?? item.보증금 ?? item.depositPrice ?? item.deposit_price ?? item.price ?? null;
  // 전용면적 can be an object { m2: 16.53, p: "5" } or a plain number
  const rawArea = item.size_m2 ?? item.전용면적_m2 ?? item.service_area
    ?? item.exclusiveArea ?? item.exclusive_area ?? item.area ?? null;
  const 전용 = item.전용면적;
  const area = (rawArea !== null && rawArea !== undefined)
    ? rawArea
    : (전용 && typeof 전용 === "object") ? 전용.m2 : 전용 ?? null;
  const address = item.address ?? item.주소 ?? item.local1 ?? item.jibunAddress ?? "";
  const title = item.title ?? item.제목 ?? item.description ?? "";

  // Location: prefer random_location (display location), then location
  const loc = item.random_location ?? item.location ?? null;
  const lat = loc?.lat ?? null;
  const lng = loc?.lng ?? loc?.lon ?? null;

  return { rent, deposit, area, address, title, lat, lng, raw: item };
}

/**
 * Apply search-condition filters to collected listings.
 */
function filterListings(listings) {
  const before = listings.length;
  const reasons = { rent: 0, deposit: 0, area: 0, location: 0 };
  const filtered = listings.filter((item) => {
    const f = extractListingFields(item);

    // Rent filter (in 만원)
    if (f.rent !== null && f.rent !== undefined) {
      const rentVal = Number(f.rent);
      const rentManwon = rentVal > 1000 ? rentVal / 10000 : rentVal;
      if (Number.isFinite(rentManwon) && rentManwon > rentMax) { reasons.rent++; return false; }
    }

    // Deposit filter (in 만원)
    if (f.deposit !== null && f.deposit !== undefined) {
      const depVal = Number(f.deposit);
      const depManwon = depVal > 100000 ? depVal / 10000 : depVal;
      if (Number.isFinite(depManwon) && depManwon > depositMax) { reasons.deposit++; return false; }
    }

    // Area filter (in m2)
    if (f.area !== null && f.area !== undefined) {
      const areaVal = Number(f.area);
      if (Number.isFinite(areaVal) && areaVal < minArea) { reasons.area++; return false; }
    }

    // Location filter: only keep items within target district's bounding box
    if (district.bbox && f.lat !== null && f.lng !== null) {
      const PAD = 0.005;
      const { sw_lat, sw_lng, ne_lat, ne_lng } = district.bbox;
      if (f.lat < sw_lat - PAD || f.lat > ne_lat + PAD || f.lng < sw_lng - PAD || f.lng > ne_lng + PAD) {
        reasons.location++;
        return false;
      }
    }

    return true;
  });

  const after = filtered.length;
  if (before !== after) {
    log(`Filtered: ${before} -> ${after} (rent:${reasons.rent}, deposit:${reasons.deposit}, area:${reasons.area}, location:${reasons.location})`);
  }

  return filtered;
}

// ============================================================================
// Common HTTP headers for Zigbang API requests
// ============================================================================

const ZIGBANG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  Origin: "https://www.zigbang.com",
  Referer: "https://www.zigbang.com/",
};

// ============================================================================
// Strategy 1: Direct API Call (no browser)
// ============================================================================

async function strategyDirectApi() {
  log("Strategy 1: Direct API call (no browser)");

  const geohash = encodeGeohash(district.lat, district.lng, 5);
  vlog(`Geohash for ${sigungu}: ${geohash} (lat=${district.lat}, lng=${district.lng})`);

  // Step 1: Get item IDs from multiple property type endpoints
  // Search: villa, officetel first (more likely >= 40m2), then oneroom
  const propertyTypes = ["villa", "officetel", "oneroom"];
  let allItems = [];

  for (const ptype of propertyTypes) {
    const v2Url =
      `https://apis.zigbang.com/v2/items/${ptype}` +
      `?geohash=${geohash}` +
      `&depositMin=0&depositMax=${depositMaxWon}` +
      `&rentMin=0&rentMax=${rentMaxWon}` +
      `&salesTypes[0]=%EC%9B%94%EC%84%B8` +
      `&domain=zigbang` +
      `&checkAnyItemWith498=true`;

    vlog(`v2 ${ptype} URL: ${v2Url}`);

    try {
      const resp = await withTimeout(fetch(v2Url, { headers: ZIGBANG_HEADERS }), 15000, `v2 ${ptype}`);
      if (resp.ok) {
        const body = await resp.json();
        const items = body?.items ?? body?.item_ids ?? [];
        if (Array.isArray(items)) {
          vlog(`  ${ptype}: ${items.length} items`);
          allItems.push(...items);
        }
      } else {
        vlog(`  ${ptype}: HTTP ${resp.status}`);
      }
    } catch (err) {
      vlog(`  ${ptype}: ${err.message}`);
    }
  }

  vlog(`Total items from all property types: ${allItems.length}`);

  if (allItems.length === 0) {
    return {
      success: false,
      listings: [],
      error: "v2 APIs returned no items across all property types",
      details: { propertyTypes },
    };
  }

  // Pre-filter v2 items: remove items with known size_m2 < minArea
  // v2 response items often include size_m2 which lets us skip small rooms early
  const preFiltered = allItems.filter((it) => {
    if (typeof it !== "object" || it === null) return true; // keep plain IDs
    const sz = it.size_m2 ?? it.전용면적_m2 ?? null;
    if (sz !== null && sz !== undefined && Number.isFinite(Number(sz)) && Number(sz) < minArea) {
      return false; // too small
    }
    return true;
  });

  vlog(`Pre-filter by area (>=${minArea}m2): ${allItems.length} -> ${preFiltered.length} items`);

  // Extract item IDs; limit to reasonable batch for detail API
  const maxDetailBatch = Math.max(sampleCap * 5, 60);
  const itemIds = preFiltered
    .map((it) => (typeof it === "object" && it !== null ? it.itemId ?? it.item_id ?? it.id : it))
    .filter((id) => id !== null && id !== undefined)
    .slice(0, maxDetailBatch);

  vlog(`Got ${itemIds.length} item IDs from v2 (batch limit: ${maxDetailBatch})`);

  if (itemIds.length === 0) {
    return {
      success: false,
      listings: [],
      error: "v2 API returned items but no extractable IDs",
      details: { sampleItem: allItems[0] },
    };
  }

  // Step 2: Get item details in batches (API rejects large payloads)
  const detailUrl = "https://apis.zigbang.com/house/property/v1/items/list";
  const BATCH_SIZE = 15;
  let detailedItems = [];

  // Ensure IDs are numeric (not objects or strings)
  const numericIds = itemIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  vlog(`Numeric IDs: ${numericIds.length} (sample: [${numericIds.slice(0, 5).join(", ")}])`);

  for (let i = 0; i < numericIds.length; i += BATCH_SIZE) {
    const batch = numericIds.slice(i, i + BATCH_SIZE);
    vlog(`Detail batch ${Math.floor(i / BATCH_SIZE) + 1}: posting ${batch.length} IDs`);

    try {
      const detailResponse = await withTimeout(
        fetch(detailUrl, {
          method: "POST",
          headers: {
            ...ZIGBANG_HEADERS,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ domain: "zigbang", item_ids: batch }),
        }),
        30000,
        "detail API",
      );

      if (detailResponse.ok) {
        const detailBody = await detailResponse.json();
        const batchItems = detailBody?.items ?? detailBody?.list ?? [];
        if (Array.isArray(batchItems)) {
          detailedItems.push(...batchItems);
          vlog(`  Got ${batchItems.length} items`);
        }
      } else {
        const errText = await detailResponse.text().catch(() => "");
        vlog(`  Detail batch returned ${detailResponse.status}: ${errText.substring(0, 200)}`);
      }
    } catch (err) {
      vlog(`  Detail batch error: ${err.message}`);
    }
  }

  if (detailedItems.length === 0) {
    // Fall back to v2 items (no detail available)
    log(`Detail API returned no items, using v2 data only`);
    const partialListings = filterListings(allItems).slice(0, sampleCap);
    return {
      success: partialListings.length > 0,
      listings: partialListings,
      error: "detail API returned no items, returning filtered v2 items",
      details: {
        v2Items: allItems.length,
        source: "v2_only",
      },
    };
  }

  vlog(`Got ${detailedItems.length} detailed items from detail API`);

  // Apply filters and cap
  const filtered = filterListings(detailedItems);
  const capped = filtered.slice(0, sampleCap);

  return {
    success: true,
    listings: capped,
    details: {
      v2Items: allItems.length,
      detailItems: detailedItems.length,
      afterFilter: filtered.length,
      returned: capped.length,
      geohash,
      source: "v2+detail",
    },
  };
}

// ============================================================================
// Strategy 2: Playwright Network Intercept
// ============================================================================

async function strategyNetworkIntercept() {
  log("Strategy 2: Playwright network intercept");

  const mapUrl = `https://www.zigbang.com/home/oneroom/map?lat=${district.lat}&lng=${district.lng}&zoom=15`;
  vlog(`Navigating to: ${mapUrl}`);

  const browser = await chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });

  let collectedListings = [];

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1400, height: 900 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });

    const page = await context.newPage();
    const interceptedResponses = [];

    // Listen for all JSON responses from zigbang APIs
    page.on("response", async (response) => {
      const url = response.url();
      try {
        if (!url.includes("zigbang.com") && !url.includes("apis.zigbang")) return;

        const status = response.status();
        if (status !== 200) return;

        const contentType = response.headers()["content-type"] || "";
        if (!contentType.includes("json")) return;

        const body = await response.json();
        interceptedResponses.push({ url, status, body });

        vlog(`Intercepted: ${url.substring(0, 120)}...`);
      } catch {
        // Ignore parse errors on non-JSON responses
      }
    });

    await withTimeout(
      page.goto(mapUrl, { waitUntil: "networkidle", timeout: 45000 }),
      60000,
      "page navigation",
    );

    // Wait for SPA to settle and API calls to fire
    await sleep(5000);

    // Scroll/interact to trigger more data loads
    try {
      await page.mouse.wheel(0, 100);
      await sleep(2000);
      await page.mouse.wheel(0, -100);
      await sleep(3000);
    } catch {
      // Interaction failures are non-fatal
    }

    vlog(`Intercepted ${interceptedResponses.length} API responses`);

    // Extract listings from intercepted responses
    // IMPORTANT: Only extract from listing-specific endpoints to avoid
    // picking up subway stations, banners, settings, etc.
    const LISTING_URL_PATTERNS = [
      "/items/onerooms",
      "/items/villa",
      "/items/officetel",
      "/items/list",
      "/v2/items/oneroom",
      "/v2/items/villa",
      "/v3/items",
    ];

    for (const resp of interceptedResponses) {
      const body = resp.body;
      if (!body || typeof body !== "object") continue;

      // Only process listing-related endpoints
      const isListingEndpoint = LISTING_URL_PATTERNS.some((p) => resp.url.includes(p));
      if (!isListingEndpoint) continue;

      // /house/property/v1/items/list returns { items: [...] } with full detail
      // /house/property/v1/items/onerooms returns { items: [...] } with item_id + coords
      // Both use the "items" key
      const candidates = [
        body.items,
        body.item_ids,
        body.list,
        body.data?.items,
        body.data?.list,
        body.result?.items,
        body.sections?.flatMap?.((s) => s.items || []),
      ];

      for (const arr of candidates) {
        if (Array.isArray(arr) && arr.length > 0) {
          // Validate items look like actual listings (have item_id or rent/deposit fields)
          const looksLikeListings = arr.some(
            (it) =>
              it.item_id !== undefined ||
              it.rent !== undefined ||
              it.deposit !== undefined ||
              it.sales_type !== undefined ||
              it.service_type !== undefined ||
              it.random_location !== undefined,
          );
          if (looksLikeListings) {
            collectedListings.push(...arr);
          }
        }
      }
    }

    // Deduplicate by item_id if present
    if (collectedListings.length > 0 && collectedListings[0]?.item_id) {
      const seen = new Set();
      collectedListings = collectedListings.filter((item) => {
        const id = item.item_id ?? item.id;
        if (id !== undefined && seen.has(id)) return false;
        if (id !== undefined) seen.add(id);
        return true;
      });
    }

    vlog(`Extracted ${collectedListings.length} unique listings from intercepted data`);

    await browser.close();

    if (collectedListings.length === 0) {
      return {
        success: false,
        listings: [],
        error: "No listings extracted from intercepted responses",
        details: { interceptedCount: interceptedResponses.length },
      };
    }

    const filtered = filterListings(collectedListings);
    const capped = filtered.slice(0, sampleCap);

    return {
      success: true,
      listings: capped,
      details: {
        interceptedResponses: interceptedResponses.length,
        rawListings: collectedListings.length,
        afterFilter: filtered.length,
        returned: capped.length,
      },
    };
  } catch (err) {
    try { await browser.close(); } catch { /* ignore */ }
    return {
      success: false,
      listings: [],
      error: err.message,
      details: { collectedBeforeError: collectedListings.length },
    };
  }
}

// ============================================================================
// Strategy 3: Playwright Browser-Context API Call
// ============================================================================

async function strategyBrowserApi() {
  log("Strategy 3: Playwright browser-context API call");

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
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1400, height: 900 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });

    const page = await context.newPage();

    // Navigate to zigbang main page to establish cookies/session
    vlog("Navigating to zigbang main page for session...");
    await withTimeout(
      page.goto("https://www.zigbang.com", { waitUntil: "networkidle", timeout: 30000 }),
      45000,
      "main page load",
    );

    await sleep(3000);

    const geohash = encodeGeohash(district.lat, district.lng, 5);
    vlog(`Using geohash: ${geohash}`);

    // Call v2 API from browser context
    const v2Url =
      `https://apis.zigbang.com/v2/items/oneroom` +
      `?geohash=${geohash}` +
      `&depositMin=0&depositMax=${depositMaxWon}` +
      `&rentMin=0&rentMax=${rentMaxWon}` +
      `&salesTypes[0]=%EC%9B%94%EC%84%B8` +
      `&domain=zigbang` +
      `&checkAnyItemWith498=true`;

    vlog(`Fetching v2 from browser context: ${v2Url}`);

    const v2Result = await withTimeout(
      page.evaluate(async (url) => {
        try {
          const res = await fetch(url, {
            headers: {
              Accept: "application/json, text/plain, */*",
              "Accept-Language": "ko-KR,ko;q=0.9",
            },
            credentials: "include",
          });
          const text = await res.text();
          return { status: res.status, body: text, ok: res.ok };
        } catch (err) {
          return { status: 0, body: null, ok: false, error: err.message };
        }
      }, v2Url),
      30000,
      "browser v2 fetch",
    );

    if (!v2Result.ok || !v2Result.body) {
      await browser.close();
      return {
        success: false,
        listings: [],
        error: `Browser v2 fetch failed: status=${v2Result.status}, error=${v2Result.error || "no body"}`,
      };
    }

    let v2Body;
    try {
      v2Body = JSON.parse(v2Result.body);
    } catch {
      await browser.close();
      return {
        success: false,
        listings: [],
        error: "Failed to parse v2 response JSON from browser context",
      };
    }

    const items = v2Body?.items ?? v2Body?.item_ids ?? [];
    const itemIds = (Array.isArray(items) ? items : [])
      .map((it) => (typeof it === "object" && it !== null ? it.item_id ?? it.id : it))
      .filter((id) => id !== null && id !== undefined)
      .slice(0, sampleCap * 3);

    vlog(`Got ${itemIds.length} IDs from browser v2`);

    if (itemIds.length === 0) {
      await browser.close();
      return {
        success: false,
        listings: [],
        error: "Browser v2 returned no item IDs",
        details: { v2BodyKeys: typeof v2Body === "object" ? Object.keys(v2Body) : typeof v2Body },
      };
    }

    // Fetch v3 details from browser context
    const v3Url = "https://apis.zigbang.com/v3/items?domain=zigbang";

    const v3Result = await withTimeout(
      page.evaluate(async ({ url, ids }) => {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/plain, */*",
            },
            credentials: "include",
            body: JSON.stringify({ item_ids: ids }),
          });
          const text = await res.text();
          return { status: res.status, body: text, ok: res.ok };
        } catch (err) {
          return { status: 0, body: null, ok: false, error: err.message };
        }
      }, { url: v3Url, ids: itemIds }),
      30000,
      "browser v3 fetch",
    );

    await browser.close();

    let allListings = [];

    if (v3Result.ok && v3Result.body) {
      try {
        const v3Body = JSON.parse(v3Result.body);
        const detailed = v3Body?.items ?? v3Body ?? [];
        if (Array.isArray(detailed) && detailed.length > 0) {
          allListings = detailed;
          vlog(`Got ${allListings.length} detailed items from browser v3`);
        }
      } catch {
        vlog("Failed to parse v3 response from browser context");
      }
    }

    // Fall back to v2 items if v3 failed
    if (allListings.length === 0) {
      allListings = Array.isArray(items) ? items : [];
      vlog(`Falling back to ${allListings.length} v2 items`);
    }

    if (allListings.length === 0) {
      return { success: false, listings: [], error: "No listings from browser context API" };
    }

    const filtered = filterListings(allListings);
    const capped = filtered.slice(0, sampleCap);

    return {
      success: true,
      listings: capped,
      details: {
        v2Items: allItems.length,
        v3Items: allListings.length,
        afterFilter: filtered.length,
        returned: capped.length,
        source: "browser_context",
      },
    };
  } catch (err) {
    try { await browser.close(); } catch { /* ignore */ }
    return {
      success: false,
      listings: [],
      error: err.message,
    };
  }
}

// ============================================================================
// Strategy 4: DOM Parsing
// ============================================================================

async function strategyDomParse() {
  log("Strategy 4: DOM parsing");

  const mapUrl = `https://www.zigbang.com/home/oneroom/map?lat=${district.lat}&lng=${district.lng}&zoom=15`;
  vlog(`Navigating to: ${mapUrl}`);

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
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1400, height: 900 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });

    const page = await context.newPage();

    await withTimeout(
      page.goto(mapUrl, { waitUntil: "networkidle", timeout: 45000 }),
      60000,
      "DOM page navigation",
    );

    // Wait for SPA to render listing elements
    await sleep(6000);

    // Try clicking on map cluster markers to open listing panels
    const clusterSelectors = [
      '[class*="cluster"]',
      '[class*="marker"]',
      '[class*="pin"]',
      '[class*="item-marker"]',
    ];

    for (const sel of clusterSelectors) {
      try {
        const elements = await page.locator(sel).all();
        if (elements.length > 0) {
          vlog(`Found ${elements.length} elements matching "${sel}", clicking first...`);
          await elements[0].click({ timeout: 3000 });
          await sleep(3000);
          break;
        }
      } catch {
        // selector not found, try next
      }
    }

    // Parse listing cards from DOM
    const listingSelectors = [
      ".card-item",
      ".list-item",
      "[class*='item-card']",
      "[class*='listing']",
      "[class*='room-item']",
      "[class*='CardItem']",
      "[class*='ListItem']",
      "[data-testid*='item']",
      "[data-testid*='card']",
      "li[class*='item']",
    ];

    let parsedListings = [];

    for (const sel of listingSelectors) {
      try {
        const cards = await page.locator(sel).all();
        if (cards.length === 0) continue;

        vlog(`Found ${cards.length} cards with selector "${sel}"`);

        for (const card of cards.slice(0, sampleCap * 2)) {
          try {
            const text = await card.innerText({ timeout: 2000 });
            if (!text || text.trim().length < 5) continue;

            // Try to extract structured data from card text
            const item = parseDomCardText(text, sel);
            if (item) parsedListings.push(item);
          } catch {
            // individual card parse failure is non-fatal
          }
        }

        if (parsedListings.length > 0) break; // found listings, stop trying selectors
      } catch {
        // selector failed, try next
      }
    }

    // If no cards found, try a broader approach: extract all visible text that looks like listings
    if (parsedListings.length === 0) {
      vlog("No card selectors matched, trying broad text extraction...");

      try {
        const bodyText = await page.evaluate(() => document.body.innerText);
        const lines = bodyText.split("\n").filter((l) => l.trim().length > 0);

        // Look for lines that contain price patterns (e.g., "월세 50/500", "보증금 500만원")
        const pricePattern = /(월세|보증금|전세|deposit|rent|\d+만|\d+\/\d+)/i;
        const pricyLines = lines.filter((l) => pricePattern.test(l));

        vlog(`Found ${pricyLines.length} price-related text lines`);

        for (const line of pricyLines.slice(0, sampleCap * 2)) {
          const item = parseDomCardText(line, "broad_text");
          if (item) parsedListings.push(item);
        }
      } catch {
        vlog("Broad text extraction failed");
      }
    }

    await browser.close();

    if (parsedListings.length === 0) {
      return {
        success: false,
        listings: [],
        error: "No listings parsed from DOM",
      };
    }

    // Deduplicate
    const seen = new Set();
    parsedListings = parsedListings.filter((item) => {
      const key = `${item.address || ""}|${item.rent || ""}|${item.deposit || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const filtered = filterListings(parsedListings);
    const capped = filtered.slice(0, sampleCap);

    return {
      success: true,
      listings: capped,
      details: {
        rawParsed: parsedListings.length,
        afterFilter: filtered.length,
        returned: capped.length,
        source: "dom",
      },
    };
  } catch (err) {
    try { await browser.close(); } catch { /* ignore */ }
    return {
      success: false,
      listings: [],
      error: err.message,
    };
  }
}

/**
 * Parse a listing card's text content into a structured object.
 * Zigbang card text typically contains: price info, area, address, floor.
 */
function parseDomCardText(text, selectorSource = "") {
  if (!text || text.trim().length < 5) return null;

  const item = { _source: "dom", _selector: selectorSource, _rawText: text.trim() };

  // Price pattern: "월세 50/500" or "50/500"
  const slashPrice = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (slashPrice) {
    item.deposit = Number(slashPrice[1]);
    item.rent = Number(slashPrice[2]);
  }

  // Alternative: "보증금 500만원" / "월세 50만원"
  const depositMatch = text.match(/보증금\s*(\d+)/);
  if (depositMatch && !item.deposit) item.deposit = Number(depositMatch[1]);

  const rentMatch = text.match(/월세\s*(\d+)/);
  if (rentMatch && !item.rent) item.rent = Number(rentMatch[1]);

  // Area: "15.2m2" or "15.2㎡" or "15.2평"
  const areaMatch = text.match(/([\d.]+)\s*(m2|㎡|m²)/i);
  if (areaMatch) {
    item.area = Number(areaMatch[1]);
  } else {
    const pyeongMatch = text.match(/([\d.]+)\s*평/);
    if (pyeongMatch) {
      // 1평 = 3.306m2
      item.area = Number((Number(pyeongMatch[1]) * 3.306).toFixed(1));
    }
  }

  // Address patterns
  const addrMatch = text.match(/(서울[^\n,]*(?:구|동|로|길)[^\n,]*)/);
  if (addrMatch) item.address = addrMatch[1].trim();

  // Floor
  const floorMatch = text.match(/(\d+)\s*층/);
  if (floorMatch) item.floor = Number(floorMatch[1]);

  // Only return if we got at least some price info
  if (item.rent !== undefined || item.deposit !== undefined || item.address) {
    return item;
  }

  return null;
}

// ============================================================================
// Main Orchestrator
// ============================================================================

async function collectZigbang() {
  const startTime = Date.now();
  const rawStream = fs.createWriteStream(outputRaw, { flags: "w" });

  const strategies = [
    { name: "directApi", fn: strategyDirectApi, timeout: 30000 },
    { name: "networkIntercept", fn: strategyNetworkIntercept, timeout: 60000 },
    { name: "browserApi", fn: strategyBrowserApi, timeout: 60000 },
    { name: "domParse", fn: strategyDomParse, timeout: 60000 },
  ];

  const strategyResults = [];
  let winningStrategy = null;
  let finalListings = [];

  for (const strat of strategies) {
    const stratStart = Date.now();

    log(`--- Trying strategy: ${strat.name} ---`);

    let result;
    try {
      result = await withTimeout(strat.fn(), strat.timeout, strat.name);
    } catch (err) {
      result = {
        success: false,
        listings: [],
        error: err.message,
      };
    }

    const durationMs = Date.now() - stratStart;

    const record = {
      name: strat.name,
      tried: true,
      success: result.success,
      listings: result.listings?.length ?? 0,
      error: result.error || null,
      details: result.details || null,
      durationMs,
    };

    strategyResults.push(record);

    if (result.success) {
      log(`Strategy "${strat.name}" succeeded: ${result.listings.length} listings in ${durationMs}ms`);
      winningStrategy = strat.name;
      finalListings = result.listings;
      break;
    } else {
      log(`Strategy "${strat.name}" failed: ${result.error || "unknown"} (${durationMs}ms)`);
    }
  }

  // Mark untried strategies
  for (const strat of strategies) {
    if (!strategyResults.find((r) => r.name === strat.name)) {
      strategyResults.push({
        name: strat.name,
        tried: false,
        success: false,
        listings: 0,
        error: null,
        durationMs: 0,
      });
    }
  }

  // Write raw JSONL
  const sourceUrl = `https://www.zigbang.com/home/oneroom/map?lat=${district.lat}&lng=${district.lng}&zoom=15`;
  for (const listing of finalListings) {
    const record = makeRecord(
      listing,
      winningStrategy === "directApi"
        ? `https://apis.zigbang.com/v2/items/oneroom?geohash=${encodeGeohash(district.lat, district.lng, 5)}`
        : sourceUrl,
      sourceUrl,
      200,
    );
    rawStream.write(JSON.stringify(record) + "\n");
  }

  rawStream.end();

  // Determine data quality
  let dataQualityGrade = "EMPTY";
  if (finalListings.length >= 10) {
    dataQualityGrade = "GOOD";
  } else if (finalListings.length > 0) {
    dataQualityGrade = "PARTIAL";
  }

  const totalDurationMs = Date.now() - startTime;

  const metadata = {
    runId: `zigbang_${Date.now()}`,
    success: finalListings.length > 0,
    sigungu,
    sampleCap,
    filters: {
      rentMax,
      depositMax,
      minArea,
    },
    strategies: strategyResults,
    winningStrategy,
    totalListings: finalListings.length,
    dataQuality: { grade: dataQualityGrade },
    timestamp: new Date().toISOString(),
    durationMs: totalDurationMs,
  };

  fs.writeFileSync(outputMeta, JSON.stringify(metadata, null, 2));

  // Summary
  console.log("");
  log("=== Collection Complete ===");
  log(`Success: ${metadata.success}`);
  log(`Winning strategy: ${winningStrategy || "none"}`);
  log(`Total listings: ${finalListings.length}`);
  log(`Data quality: ${dataQualityGrade}`);
  log(`Duration: ${Math.round(totalDurationMs / 1000)}s`);
  log(`Raw data: ${outputRaw}`);
  log(`Metadata: ${outputMeta}`);
  console.log("");

  for (const sr of strategyResults) {
    const status = sr.tried ? (sr.success ? "OK" : "FAIL") : "SKIP";
    const detail = sr.tried ? `${sr.listings} listings, ${sr.durationMs}ms` : "";
    const err = sr.error ? ` (${sr.error.substring(0, 80)})` : "";
    log(`  ${status} ${sr.name}: ${detail}${err}`);
  }

  return metadata;
}

// ============================================================================
// Entry Point
// ============================================================================

collectZigbang().catch((err) => {
  console.error(`[zigbang] Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
