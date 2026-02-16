#!/usr/bin/env node

/**
 * Dabang (다방) Real Estate Automated Collector
 *
 * Strategy: Playwright stealth browser + API response intercept
 *
 * Dabang's bot detection blocks Node.js fetch (TLS fingerprinting),
 * so we navigate with a real browser and capture API responses.
 *
 * Categories scraped:
 *   - onetwo: 원룸/투룸
 *   - house: 주택/빌라
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
const rentMax = getIntArg("--rent-max", 80);       // 만원
const depositMax = getIntArg("--deposit-max", 6000); // 만원
const minAreaM2 = getIntArg("--min-area", 40);       // m²
const outputRaw = getArg("--output-raw", "scripts/dabang_raw_samples.jsonl");
const outputMeta = getArg("--output-meta", "scripts/dabang_capture_results.json");
const headless = !hasFlag("--headed");
const verbose = hasFlag("--verbose");
const fetchDetail = !hasFlag("--no-detail");

// 40m² ÷ 3.306 ≈ 12평
const minPyeong = Math.max(1, Math.floor(minAreaM2 / 3.306));

// ============================================================================
// District Coordinates
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

// Bounding boxes for location filtering (same as zigbang)
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
  console.error(`[dabang] ERROR: Unknown district: ${sigungu}`);
  console.error(`[dabang] Available: ${Object.keys(DISTRICT_COORDS).join(", ")}`);
  process.exit(1);
}

const bbox = DISTRICT_BBOX[sigungu];

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  console.log(`[dabang] ${msg}`);
}

function vlog(msg) {
  if (verbose) console.log(`[dabang]   ${msg}`);
}

/**
 * Parse priceTitle "500/45" → { deposit: 500, rent: 45 } (만원 단위)
 * Handles: "500/45", "1억5000/70", "3억/30"
 */
function parsePriceTitle(priceTitle) {
  if (!priceTitle) return { deposit: null, rent: null };

  const match = priceTitle.match(/^([0-9억,.]+)\s*\/\s*([0-9,.]+)$/);
  if (!match) return { deposit: null, rent: null };

  let depositStr = match[1];
  let rentStr = match[2];

  // Parse deposit: handle 억 unit
  let deposit = 0;
  const ukMatch = depositStr.match(/(\d+)억\s*(\d*)/);
  if (ukMatch) {
    deposit = parseInt(ukMatch[1], 10) * 10000;
    if (ukMatch[2]) deposit += parseInt(ukMatch[2], 10);
  } else {
    deposit = parseFloat(depositStr.replace(/,/g, ""));
  }

  const rent = parseFloat(rentStr.replace(/,/g, ""));

  return {
    deposit: Number.isFinite(deposit) ? deposit : null,
    rent: Number.isFinite(rent) ? rent : null,
  };
}

/**
 * Parse roomDesc "2층, 36.09m², 관리비 3만" → { area: 36.09, floor: "2층" }
 */
function parseRoomDesc(roomDesc) {
  if (!roomDesc) return { area: null, floor: null };

  const areaMatch = roomDesc.match(/([\d,.]+)\s*m²/);
  const area = areaMatch ? parseFloat(areaMatch[1].replace(/,/g, "")) : null;

  const floorMatch = roomDesc.match(/(반지하|옥탑|\d+층|저층|중층|고층)/);
  const floor = floorMatch ? floorMatch[1] : null;

  return { area, floor };
}

/**
 * Apply search-condition filters to captured listings.
 */
function filterListings(listings) {
  const before = listings.length;
  const reasons = { rent: 0, deposit: 0, area: 0, location: 0 };

  const filtered = listings.filter((item) => {
    const price = parsePriceTitle(item.priceTitle);
    const desc = parseRoomDesc(item.roomDesc);

    // Rent filter (만원)
    if (price.rent !== null && price.rent > rentMax) {
      reasons.rent++;
      return false;
    }

    // Deposit filter (만원)
    if (price.deposit !== null && price.deposit > depositMax) {
      reasons.deposit++;
      return false;
    }

    // Area filter (m²)
    if (desc.area !== null && desc.area < minAreaM2) {
      reasons.area++;
      return false;
    }

    // Location filter: check if randomLocation falls within target district bbox
    if (bbox && item.randomLocation) {
      const PAD = 0.008; // slightly larger pad for dabang's randomized coords
      const { lat, lng } = item.randomLocation;
      if (
        lat < bbox.sw_lat - PAD || lat > bbox.ne_lat + PAD ||
        lng < bbox.sw_lng - PAD || lng > bbox.ne_lng + PAD
      ) {
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
// Dabang URL Builder
// ============================================================================

/**
 * Build dabang map page URL with filter params.
 * The SPA translates these URL params into internal API calls.
 *
 * Categories:
 *   - onetwo: 원룸/투룸
 *   - house: 주택/빌라
 */
function buildDabangUrl(category) {
  const params = new URLSearchParams();
  params.set("sellingTypeList", JSON.stringify(["MONTHLY_RENT"]));
  params.set("depositRangeMax", String(depositMax));
  params.set("priceRangeMax", String(rentMax));
  params.set("pyeongRangeMin", String(minPyeong));
  params.set("roomFloorList", JSON.stringify(["GROUND_FIRST", "GROUND_SECOND_OVER"]));
  params.set("m_lat", String(district.lat));
  params.set("m_lng", String(district.lng));
  params.set("m_zoom", "14"); // zoom 14 for tighter district focus

  return `https://www.dabangapp.com/map/${category}?${params.toString()}`;
}

// ============================================================================
// Core Collection Logic
// ============================================================================

async function collectDabang() {
  const startTime = Date.now();
  const rawStream = fs.createWriteStream(outputRaw, { flags: "w" });

  log(`Target: ${sigungu} (lat=${district.lat}, lng=${district.lng})`);
  log(`Sample cap: ${sampleCap}`);
  log(`Filters: rent<=${rentMax}만원, deposit<=${depositMax}만원, area>=${minAreaM2}m² (${minPyeong}평)`);
  log(`Headless: ${headless}, Detail fetch: ${fetchDetail}`);
  log("");

  // Categories to scrape
  const categories = ["onetwo", "house"];
  let allCaptured = [];
  const categoryStats = {};

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

    for (const category of categories) {
      const pageUrl = buildDabangUrl(category);
      log(`--- Category: ${category} ---`);
      vlog(`URL: ${pageUrl}`);

      const page = await context.newPage();
      const capturedRoomLists = [];
      let totalFromApi = 0;
      let capturedBboxUrl = null; // Store for pagination

      // ---- page.route(): Inject filters into outgoing /bbox requests ----
      // The SPA sends pyeongRange.min=0 regardless of URL params,
      // so we intercept and override the filters JSON.
      const filterOverrides = {
        depositRange: { min: 0, max: depositMax },
        priceRange: { min: 0, max: rentMax },
        pyeongRange: { min: minPyeong, max: 999999 },
      };

      await page.route("**/api/v5/room-list/**/bbox?**", (route) => {
        const req = route.request();
        try {
          const originalUrl = new URL(req.url());
          const filtersRaw = originalUrl.searchParams.get("filters");

          if (filtersRaw) {
            const filters = JSON.parse(decodeURIComponent(filtersRaw));
            Object.assign(filters, filterOverrides);
            originalUrl.searchParams.set("filters", JSON.stringify(filters));
            vlog(`Route injected filters: pyeong>=${minPyeong}, deposit<=${depositMax}, rent<=${rentMax}`);
          }

          // Store the modified URL for pagination later
          capturedBboxUrl = originalUrl.toString();

          route.continue({ url: originalUrl.toString() });
        } catch {
          route.continue();
        }
      });

      // ---- Intercept /bbox API responses ----
      page.on("response", async (response) => {
        const url = response.url();
        if (!url.includes("/bbox")) return;
        if (response.status() !== 200) return;

        try {
          const body = await response.json();
          if (body?.result?.roomList) {
            const roomList = body.result.roomList;
            totalFromApi = body.result.total || totalFromApi;
            capturedRoomLists.push(...roomList);
            vlog(`Captured /bbox response: ${roomList.length} items (total: ${body.result.total}, page: ${body.result.page})`);
          }
        } catch {
          // non-JSON or parse error - ignore
        }
      });

      try {
        // Navigate to dabang map page - SPA will fire /bbox API call
        // Use domcontentloaded to avoid networkidle timeout (SPA keeps loading)
        await withTimeout(
          page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 }),
          45000,
          `${category} page navigation`,
        );

        // Wait for initial /bbox API call to fire and complete
        await sleep(6000);

        // ---- Pagination: fetch additional pages via browser context ----
        // The API returns 24 items per page. If we need more, request page 2, 3...
        if (capturedBboxUrl && capturedRoomLists.length < sampleCap * 3) {
          const maxPages = Math.min(5, Math.ceil((sampleCap * 3) / 24));

          for (let pg = 2; pg <= maxPages; pg++) {
            if (capturedRoomLists.length >= sampleCap * 3) break;

            try {
              const pgUrl = new URL(capturedBboxUrl);
              pgUrl.searchParams.set("page", String(pg));
              const fetchUrl = pgUrl.toString();

              vlog(`Fetching page ${pg} via browser context...`);

              const pgResult = await withTimeout(
                page.evaluate(async (url) => {
                  try {
                    const res = await fetch(url, {
                      headers: {
                        "accept": "application/json, text/plain, */*",
                        "d-api-version": "5.0.0",
                        "d-app-version": "1",
                        "d-call-type": "web",
                        "csrf": "token",
                      },
                      credentials: "include",
                    });
                    if (!res.ok) return { ok: false, status: res.status };
                    const data = await res.json();
                    return { ok: true, data };
                  } catch (err) {
                    return { ok: false, error: err.message };
                  }
                }, fetchUrl),
                15000,
                `page ${pg} fetch`,
              );

              if (pgResult.ok && pgResult.data?.result?.roomList) {
                const pgItems = pgResult.data.result.roomList;
                capturedRoomLists.push(...pgItems);
                vlog(`  Page ${pg}: ${pgItems.length} items (hasMore: ${pgResult.data.result.hasMore})`);

                if (!pgResult.data.result.hasMore) break;
              } else {
                vlog(`  Page ${pg} failed: ${pgResult.status || pgResult.error || "no data"}`);
                break; // Stop pagination on failure
              }

              await sleep(1000 + Math.random() * 500);
            } catch (pgErr) {
              vlog(`  Page ${pg} error: ${pgErr.message}`);
              break;
            }
          }
        }

      } catch (navErr) {
        log(`Navigation warning for ${category}: ${navErr.message}`);
      }

      await page.close();

      // Deduplicate by id
      const seen = new Set();
      const uniqueItems = capturedRoomLists.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });

      categoryStats[category] = {
        captured: capturedRoomLists.length,
        unique: uniqueItems.length,
        totalFromApi,
      };

      log(`${category}: captured ${uniqueItems.length} unique items (API total: ${totalFromApi})`);

      // Tag items with category
      for (const item of uniqueItems) {
        item._category = category;
      }

      allCaptured.push(...uniqueItems);

      // Brief pause between categories
      if (categories.indexOf(category) < categories.length - 1) {
        await sleep(2000);
      }
    }

    // ========================================================================
    // Post-filter by search conditions
    // ========================================================================

    // Deduplicate across categories (same listing may appear in both)
    const globalSeen = new Set();
    allCaptured = allCaptured.filter((item) => {
      if (globalSeen.has(item.id)) return false;
      globalSeen.add(item.id);
      return true;
    });

    log(`Total unique across categories: ${allCaptured.length}`);

    const filtered = filterListings(allCaptured);
    const capped = filtered.slice(0, sampleCap);

    log(`After filter + cap: ${capped.length} items`);

    // ========================================================================
    // Optional: Fetch detail for each listing via browser context
    // ========================================================================

    let detailSuccessCount = 0;

    if (fetchDetail && capped.length > 0) {
      log(`Fetching detail for ${capped.length} listings via browser context...`);

      const detailPage = await context.newPage();

      // Navigate to dabang main to establish session
      try {
        await withTimeout(
          detailPage.goto("https://www.dabangapp.com", { waitUntil: "domcontentloaded", timeout: 20000 }),
          30000,
          "dabang main page",
        );
        await sleep(2000);
      } catch {
        vlog("Main page load for session - continuing anyway");
      }

      for (let i = 0; i < capped.length; i++) {
        const item = capped[i];
        const detailUrl = `https://www.dabangapp.com/api/v5/room/${item.id}`;

        vlog(`  [${i + 1}/${capped.length}] id:${item.id} ...`);

        try {
          const result = await withTimeout(
            detailPage.evaluate(async (url) => {
              try {
                const res = await fetch(url, {
                  headers: {
                    "accept": "application/json, text/plain, */*",
                    "d-api-version": "5.0.0",
                    "d-app-version": "1",
                    "d-call-type": "web",
                    "csrf": "token",
                  },
                  credentials: "include",
                });
                if (!res.ok) return { ok: false, status: res.status };
                const data = await res.json();
                return { ok: true, data };
              } catch (err) {
                return { ok: false, error: err.message };
              }
            }, detailUrl),
            15000,
            `detail ${item.id}`,
          );

          if (result.ok && result.data) {
            // Merge detail data into the list item
            item._detail = result.data;
            detailSuccessCount++;
            vlog(`    OK`);
          } else {
            vlog(`    Failed: ${result.status || result.error || "unknown"}`);
          }
        } catch (err) {
          vlog(`    Error: ${err.message}`);
        }

        // Rate limit
        await sleep(800 + Math.random() * 400);
      }

      await detailPage.close();
      log(`Detail fetch: ${detailSuccessCount}/${capped.length} succeeded`);
    }

    // ========================================================================
    // Write raw JSONL
    // ========================================================================

    for (const item of capped) {
      const record = {
        platform_code: "dabang",
        collected_at: new Date().toISOString(),
        source_url: `https://www.dabangapp.com/room/${item.id}`,
        request_url: buildDabangUrl(item._category || "onetwo"),
        response_status: 200,
        sigungu,
        payload_json: item._detail || item,
        // Also store the list-level data for the adapter
        list_data: {
          id: item.id,
          seq: item.seq,
          roomTypeName: item.roomTypeName,
          priceTitle: item.priceTitle,
          roomDesc: item.roomDesc,
          roomTitle: item.roomTitle,
          dongName: item.dongName,
          complexName: item.complexName,
          randomLocation: item.randomLocation,
          imgUrlList: item.imgUrlList,
          isDirect: item.isDirect,
        },
      };
      rawStream.write(JSON.stringify(record) + "\n");
    }

    rawStream.end();

    await browser.close();

    // ========================================================================
    // Write metadata
    // ========================================================================

    let dataQualityGrade = "EMPTY";
    if (capped.length >= 10) dataQualityGrade = "GOOD";
    else if (capped.length > 0) dataQualityGrade = "PARTIAL";

    const totalDurationMs = Date.now() - startTime;

    const metadata = {
      runId: `dabang_${Date.now()}`,
      success: capped.length > 0,
      sigungu,
      sampleCap,
      filters: { rentMax, depositMax, minAreaM2, minPyeong },
      categories: categoryStats,
      totalCaptured: allCaptured.length,
      afterFilter: filtered.length,
      totalListings: capped.length,
      detailFetched: detailSuccessCount,
      dataQuality: { grade: dataQualityGrade },
      timestamp: new Date().toISOString(),
      durationMs: totalDurationMs,
    };

    fs.writeFileSync(outputMeta, JSON.stringify(metadata, null, 2));

    // Summary
    log("");
    log("=== Collection Complete ===");
    log(`Success: ${metadata.success}`);
    log(`Total listings: ${capped.length}`);
    log(`Data quality: ${dataQualityGrade}`);
    log(`Duration: ${Math.round(totalDurationMs / 1000)}s`);
    log(`Raw data: ${outputRaw}`);
    log(`Metadata: ${outputMeta}`);
    log("");

    for (const [cat, stats] of Object.entries(categoryStats)) {
      log(`  ${cat}: ${stats.unique} unique / ${stats.totalFromApi} total in API`);
    }

    // Sample listings
    if (capped.length > 0) {
      log("");
      log("Sample listings:");
      for (const item of capped.slice(0, 3)) {
        const price = parsePriceTitle(item.priceTitle);
        const desc = parseRoomDesc(item.roomDesc);
        log(`  - [${item.roomTypeName}] ${item.priceTitle} (보증금${price.deposit}만/월세${price.rent}만) ${desc.area}m² ${item.dongName} "${item.roomTitle?.substring(0, 30)}..."`);
      }
    }

    return metadata;

  } catch (err) {
    try { await browser.close(); } catch { /* ignore */ }

    const totalDurationMs = Date.now() - startTime;
    const metadata = {
      runId: `dabang_${Date.now()}`,
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

collectDabang().catch((err) => {
  console.error(`[dabang] Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
