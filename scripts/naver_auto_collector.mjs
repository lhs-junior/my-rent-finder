#!/usr/bin/env node

/**
 * Naver Real Estate Automated Collector with Stealth
 * playwright-extra + stealth plugin으로 봇 탐지 우회
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "node:fs";

// Add stealth plugin
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

function normalizeSampleCap(raw, fallback = 20) {
  const parsed = Number(raw);
  if (raw === null || raw === undefined || Number.isNaN(parsed)) return fallback;
  if (parsed < 0) return fallback;
  if (!Number.isFinite(parsed) || parsed === 0) return Number.POSITIVE_INFINITY;
  return Math.floor(parsed);
}

function parseMoneyInput(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;

  // 내부 단위를 '만원'으로 통일.
  // 사용자가 원 단위(예: 800000)로 입력한 경우에도 만원으로 변환.
  if (parsed > 10000) return Math.round(parsed / 10000);
  return Math.round(parsed);
}

function normalizeTradeType(raw) {
  const normalized = String(raw || "").trim().toUpperCase();
  if (!normalized) return "B2";
  if (/(B2|월세|WOLSE)/.test(normalized)) return "B2";
  if (/(B1|전세|JEONSE)/.test(normalized)) return "B1";
  if (/(A1|매매|SALE|매입|매입완료|매매완료)/.test(normalized)) return "A1";
  return "B2";
}

const sigungu = getArg("--sigungu", "노원구");
const sampleCap = normalizeSampleCap(getArg("--sample-cap", "100"), 100);
const rentMax = parseMoneyInput(getArg("--rent-max", "80"), 800000);
const depositMax = parseMoneyInput(getArg("--deposit-max", "6000"), 60000000);
const minArea = getIntArg("--min-area", 40);
const minAreaSqm = minArea > 0 ? minArea : 40;
const realEstateTypes = getArg("--real-estate-types", "DDDGG:JWJT:SGJT:VL:YR:DSD");
const tradeType = normalizeTradeType(getArg("--trade-type", "B2"));
const outputRaw = getArg("--output-raw", "scripts/naver_raw_samples.jsonl");
const outputMeta = getArg(
  "--output-meta",
  "scripts/naver_capture_results.json",
);
const headless = !hasFlag("--headed");
const verbose = hasFlag("--verbose");
const filterProbe = hasFlag("--filter-probe");
const filterProbeOnly = hasFlag("--filter-probe-only");
const filterProbeDelayMs = getIntArg("--filter-probe-delay-ms", 900);

console.log(`🎯 Target: ${sigungu}`);
console.log(`📊 Sample cap: ${sampleCap}`);
console.log(`💰 Filters: 월세<=${Math.round(rentMax || 0)}만원, 보증금<=${Math.round(depositMax || 0)}만원, 면적>=${minAreaSqm}㎡`);
console.log(`🏘️  Trade/property: ${tradeType} / ${realEstateTypes}`);
console.log(`🧪 Filter probe: ${filterProbe ? "ON" : "OFF"} / only: ${filterProbeOnly ? "ON" : "OFF"}`);
console.log(`🕵️  Stealth mode: ENABLED`);
console.log(`🖥️  Headless: ${headless}\n`);

// ============================================================================
// District Code Mapping
// ============================================================================

let districtCodes = {};
try {
  const raw = fs.readFileSync("scripts/naver_district_codes.json", "utf8");
  districtCodes = JSON.parse(raw);
} catch (err) {
  console.error("❌ Cannot load district codes:", err.message);
  process.exit(1);
}

const cortarNo = districtCodes[sigungu];
if (!cortarNo) {
  console.error(`❌ Unknown district: ${sigungu}`);
  console.error(`Available: ${Object.keys(districtCodes).join(", ")}`);
  process.exit(1);
}

// ============================================================================
// Helper Functions
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min = 1000, max = 3000) {
  return sleep(Math.floor(Math.random() * (max - min + 1)) + min);
}

async function humanClick(page, selector, options = {}) {
  try {
    await page.waitForSelector(selector, { timeout: 5000, ...options });
    await randomDelay(300, 800);
    await page.click(selector);
    await randomDelay(500, 1500);
    return true;
  } catch (err) {
    if (verbose) console.log(`  ⚠️  Click failed: ${selector}`);
    return false;
  }
}

async function humanType(page, selector, text) {
  try {
    await page.waitForSelector(selector, { timeout: 5000 });
    await randomDelay(300, 800);
    await page.fill(selector, text);
    await randomDelay(500, 1000);
    return true;
  } catch (err) {
    if (verbose) console.log(`  ⚠️  Type failed: ${selector}`);
    return false;
  }
}

function extractMapStateFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const ms = u.searchParams.get("ms");
    const [lat, lon, zoomRaw] = ms ? ms.split(",") : [];
    return {
      lat: lat ? Number(lat) : null,
      lon: lon ? Number(lon) : null,
      zoom:
        Number.isFinite(Number(zoomRaw)) && Number(zoomRaw) > 0
          ? Number(zoomRaw)
          : null,
      realEstateType: u.searchParams.get("a") || realEstateTypes,
      priceType: u.searchParams.get("e") || "RETAIL",
    };
  } catch {
    return {
      lat: null,
      lon: null,
      zoom: null,
      realEstateType: realEstateTypes,
      priceType: "RETAIL",
    };
  }
}

function buildArticleFilterProfile(overrides = {}) {
  const requestedRentMax = Number(overrides.rentMax ?? rentMax);
  const requestedDepositMax = Number(overrides.depositMax ?? depositMax);
  const requestedMinArea = Number(overrides.minAreaSqm ?? minAreaSqm);

  return {
    tradeType: normalizeTradeType(overrides.tradeType || tradeType),
    rentMax: Number.isFinite(requestedRentMax) && requestedRentMax > 0
      ? Math.floor(requestedRentMax)
      : rentMax,
    priceMax: Number.isFinite(requestedDepositMax) && requestedDepositMax > 0
      ? Math.floor(requestedDepositMax)
      : depositMax,
    areaMin: Number.isFinite(requestedMinArea) && requestedMinArea > 0
      ? Math.floor(requestedMinArea)
      : minAreaSqm,
    realEstateType:
      String(
        overrides.realEstateType || overrides.realEstateTypes || realEstateTypes || "",
      ) || realEstateTypes,
    order: overrides.order || "rank",
    priceType: overrides.priceType || undefined,
  };
}

function buildArticleApiQuery(state, overrides = {}) {
  const filterProfile = buildArticleFilterProfile(overrides);
  const normalizedPriceType = String(
    filterProfile.priceType || state.priceType || "RETAIL",
  );

  const realEstateType = String(
    overrides.realEstateType ||
      overrides.realEstateTypes ||
      filterProfile.realEstateType ||
      state.realEstateType ||
      realEstateTypes,
  );

  const query = new URLSearchParams({
    cortarNo: String(cortarNo),
    order: filterProfile.order,
    realEstateType,
    tradeType: filterProfile.tradeType,
    tag: "::::::::",
    rentPriceMin: "0",
    rentPriceMax: String(filterProfile.rentMax),
    priceMin: String(0),
    priceMax: String(filterProfile.priceMax),
    areaMin: String(filterProfile.areaMin),
    areaMax: String(900000000),
    oldBuildYears: "",
    recentlyBuildYears: "",
    minHouseHoldCount: "",
    maxHouseHoldCount: "",
    showArticle: "false",
    sameAddressGroup: "false",
    minMaintenanceCost: "",
    maxMaintenanceCost: "",
    priceType: normalizedPriceType,
    directions: "",
    page: "1",
    articleState: "",
  });

  if (state.zoom !== null && Number.isFinite(state.zoom)) {
    query.set("zoom", String(Math.round(state.zoom)));
  }

  return {
    url: `https://new.land.naver.com/api/articles?${query.toString()}`,
    query,
    profile: filterProfile,
  };
}

function buildArticleApiUrl(state, overrides = {}) {
  return buildArticleApiQuery(state, overrides).url;
}

async function captureDirectArticleAPI(page, capturedResponses, rawStream, overrides = {}) {
  const state = extractMapStateFromUrl(page.url());
  const result = {
    collectedPages: 0,
    totalListings: 0,
    success: false,
    requestLog: [],
    filters: buildArticleFilterProfile(overrides),
  };
  const stateSnapshot = {
    rawEstateType: String(state.realEstateType || realEstateTypes),
    priceType: String(state.priceType || "RETAIL"),
    zoom: state.zoom,
    ms: [state.lat, state.lon, state.zoom].filter((v) => v !== null).join(","),
  };
  result.stateSnapshot = stateSnapshot;

  const buildResult = buildArticleApiQuery(state, overrides);
  let baseUrl = buildResult.url;
  const baseParsed = new URL(baseUrl);
  if (verbose) {
    console.log(
      `🔎 API query profile: tradeType=${buildResult.profile.tradeType}, rentMax=${buildResult.profile.rentMax}, priceMax=${buildResult.profile.priceMax}, areaMin=${buildResult.profile.areaMin}, realEstateType=${buildResult.profile.realEstateType}`,
    );
  }

  const isFilterMismatch = (targetUrl) => {
    const q = new URL(targetUrl).searchParams;
    return {
      tradeType: q.get("tradeType") !== String(buildResult.profile.tradeType),
      rentPriceMax: q.get("rentPriceMax") !== String(buildResult.profile.rentMax),
      priceMax: q.get("priceMax") !== String(buildResult.profile.priceMax),
      areaMin: q.get("areaMin") !== String(buildResult.profile.areaMin),
      realEstateType: q.get("realEstateType") !== String(buildResult.profile.realEstateType),
    };
  };

  const maxPages = Math.max(
    1,
    Math.min(
      Number.isFinite(Number(overrides.maxPages))
        ? Math.floor(Number(overrides.maxPages))
        : 4,
      sampleCap,
    ),
  );
  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    baseParsed.searchParams.set("page", String(pageNo));
    const targetUrl = baseParsed.toString();

    try {
      const fetchResult = await page.evaluate(async (url) => {
        try {
          const res = await fetch(url, {
            headers: {
              "Accept": "application/json, text/plain, */*",
              "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            },
            credentials: "include",
          });
          const text = await res.text();
          return { status: res.status, body: text, ok: res.ok };
        } catch (err) {
          return { status: 0, body: null, ok: false, error: err.message };
        }
      }, targetUrl);

      const responseStatus = fetchResult.status;
      const rawBody = fetchResult.body;
      let body = null;
      let parseError = null;

      if (rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch (err) {
          parseError = String(err?.message || "JSON_PARSE_ERROR");
        }
      }

      if (responseStatus !== 200) {
        const mismatch = isFilterMismatch(targetUrl);
        const requestLog = {
          page: pageNo,
          requestUrl: targetUrl,
          status: responseStatus,
          mismatch,
          isMismatch: Object.values(mismatch).some(Boolean),
          responsePayloadError: !!parseError || !!body?.error,
          responseError: body && typeof body === "object" ? body.error : null,
          responseMessage: parseError || (body ? body.message : null),
        };
        result.requestLog.push(requestLog);

        if (verbose) {
          const errCode = requestLog.responseError?.code || requestLog.responseMessage || "unknown";
          console.log(`⚠️  API not OK: ${responseStatus} / ${errCode}`);
        }
        break;
      }

      if (parseError) {
        if (verbose) console.log(`⚠️  API payload parse failed: ${parseError}`);
      }

      const articleList = Array.isArray(body?.articleList)
        ? body.articleList
        : [];
      result.collectedPages += 1;
      result.totalListings += articleList.length;
      const mismatch = isFilterMismatch(targetUrl);
      const requestLog = {
        page: pageNo,
        requestUrl: targetUrl,
        status: responseStatus,
        mismatch,
        isMismatch: Object.values(mismatch).some(Boolean),
        responsePayloadError: !!parseError || !!body?.error,
      };
      result.requestLog.push(requestLog);

      const record = {
        platform_code: "naver",
        collected_at: new Date().toISOString(),
        source_url: page.url(),
        request_url: targetUrl,
        response_status: responseStatus,
        response_headers: {},
        payload_json: body,
      };

      capturedResponses.push(record);
      rawStream.write(JSON.stringify(record) + "\n");

      if (verbose) {
        const mismatchSummary = requestLog.isMismatch ? "⚠️(필터미스)" : "✅";
        console.log(
          `${mismatchSummary} API page ${pageNo}: ${articleList.length} listings`,
        );
      }

      if (!body?.isMoreData) {
        break;
      }
      if (articleList.length === 0 && pageNo > 1) {
        break;
      }
      await randomDelay(600, 1400);
    } catch (err) {
      if (verbose) console.log(`⚠️  API fetch failed: ${err?.message || err}`);
      break;
    }
  }

  result.success = result.collectedPages > 0;
  return result;
}

// ============================================================================
// Network Capture
// ============================================================================

async function captureNaverData() {
  const startTime = Date.now();
  const capturedResponses = [];
  const rawStream = fs.createWriteStream(outputRaw, { flags: "w" });

  console.log("🚀 Launching stealth browser...\n");

  const browser = await chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });

  const page = await context.newPage();

  // ── Route interception: inject filter params into the page's own API calls ──
  // The Naver SPA makes XHR calls to /api/articles and /api/articles/clusters
  // without our search condition params. We intercept and inject them.
  const filterParams = {
    tradeType: "B2",
    rentPriceMin: "0",
    rentPriceMax: String(rentMax),
    priceMin: "0",
    priceMax: String(depositMax),
    areaMin: String(minAreaSqm),
    realEstateType: realEstateTypes,
  };

  await page.route("**/api/articles?**", (route) => {
    const req = route.request();
    const originalUrl = new URL(req.url());
    for (const [key, value] of Object.entries(filterParams)) {
      originalUrl.searchParams.set(key, value);
    }
    if (verbose) {
      console.log(`  🔀 Route intercept /api/articles → injected filters`);
    }
    route.continue({ url: originalUrl.toString() });
  });

  await page.route("**/api/articles/clusters?**", (route) => {
    const req = route.request();
    const originalUrl = new URL(req.url());
    for (const [key, value] of Object.entries(filterParams)) {
      originalUrl.searchParams.set(key, value);
    }
    if (verbose) {
      console.log(`  🔀 Route intercept /api/articles/clusters → injected filters`);
    }
    route.continue({ url: originalUrl.toString() });
  });

  // Intercept ALL JSON responses
  page.on("response", async (response) => {
    const url = response.url();

    try {
      const status = response.status();
      if (status !== 200) return;

      const contentType = response.headers()["content-type"] || "";
      if (!contentType.includes("json")) return;

      const body = await response.json();

      if (verbose) console.log(`  📡 ${url.substring(0, 100)}...`);

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
      // Ignore parse errors
    }
  });

  // Navigate to Naver Real Estate
  console.log("🌐 Navigating to Naver Real Estate...\n");

  // Include all filter params in the URL so the page's own API calls include them
  const urlParams = new URLSearchParams({
    cortarNo,
    realEstateType: realEstateTypes,
    tradeType: "B2",
    rentPriceMin: "0",
    rentPriceMax: String(rentMax),
    priceMin: "0",
    priceMax: String(depositMax),
    areaMin: String(minAreaSqm),
  });
  const regionDirectUrl = `https://new.land.naver.com/houses?${urlParams.toString()}`;
  let pageReadyForUi = false;
  let lastGotoError = null;
  const gotoAttempts = [
    { waitUntil: "networkidle", timeout: 30000 },
    { waitUntil: "domcontentloaded", timeout: 45000 },
    { waitUntil: "domcontentloaded", timeout: 60000 },
  ];

  for (let i = 0; i < gotoAttempts.length; i++) {
    const attempt = gotoAttempts[i];
    try {
      await page.goto(regionDirectUrl, {
        waitUntil: attempt.waitUntil,
        timeout: attempt.timeout,
      });
      pageReadyForUi = true;
      break;
    } catch (err) {
      lastGotoError = err;
      if (i + 1 < gotoAttempts.length) {
        console.log(`⚠️  NAVER 페이지 진입 재시도 ${i + 1}/${gotoAttempts.length}: ${String(err?.message || err)}`);
        await randomDelay(800, 1500);
      }
    }
  }

  if (!pageReadyForUi) {
    console.log("⚠️  네이버 페이지 진입 실패. 직접 API 폴백으로 수집을 진행합니다.\n");
    if (verbose) {
      console.log(`   원인: ${String(lastGotoError?.message || lastGotoError || "unknown")}`);
    }
  } else {
    await randomDelay(2000, 3000);

    // Search for district
    console.log(`🔍 Searching for ${sigungu}...\n`);

    const searchSuccess = await humanClick(page, 'button[aria-label="검색"]');
    if (searchSuccess) {
      await humanType(page, "#land_search", sigungu);
      await randomDelay(1000, 2000);

      // Click first suggestion
      await humanClick(page, ".search_list_item");
      console.log("✅ District selected\n");
    }

    // Apply filters
    console.log("🎚️  Applying filters...\n");

    // Trade type: 월세
    await humanClick(page, 'button:has-text("거래")');
    await humanClick(page, 'label:has-text("월세")');

    // Wait for map to load
    await randomDelay(2000, 3000);

    // Zoom in to show listings
    console.log("🔍 Zooming in to load listings...\n");

    for (let i = 0; i < 3; i++) {
      await humanClick(page, '.map_control--zoom[aria-label="지도확대"]');
      await randomDelay(1500, 2500);
    }
  }

  // Click on map markers to load details
  console.log("🖱️  Clicking listings...\n");

  let clickedCount = 0;
  const maxAttempts = Number.isFinite(sampleCap) ? sampleCap * 2 : 320; // Try more than needed
  let apiCollect = null;
  const filterProbeSteps = [
    { label: "step1: 기본", overrides: {} },
    { label: "step2: 거래유형(B2)", overrides: { tradeType: "B2" } },
    {
      label: "step3: 월세 <= 설정값",
      overrides: { tradeType: "B2", rentMax },
    },
    {
      label: "step4: 월세 <= / 보증금 <= 설정값",
      overrides: { tradeType: "B2", rentMax, depositMax },
    },
    {
      label: "step5: 월세 / 보증금 / 면적 설정값",
      overrides: {
        tradeType: "B2",
        rentMax,
        depositMax,
        minAreaSqm,
      },
    },
    {
      label: "step6: 전체(거래유형 + 실거래유형)",
      overrides: {
        tradeType,
        rentMax,
        depositMax,
        minAreaSqm,
        realEstateType: realEstateTypes,
      },
    },
  ];

  const runFilterProbe = async () => {
    console.log("🧪 필터 단계별 조회 probe 시작\n");
    for (const step of filterProbeSteps) {
      await randomDelay(filterProbeDelayMs, filterProbeDelayMs + 300);
      if (verbose) {
        console.log(`   ${step.label}`);
      }
      await captureDirectArticleAPI(page, capturedResponses, rawStream, {
        ...step.overrides,
        maxPages: 1,
      });
    }
  };

  if (filterProbe || filterProbeOnly) {
    await runFilterProbe();
    if (filterProbeOnly) {
      apiCollect = {
        collectedPages: 0,
        totalListings: 0,
        success: false,
        requestLog: [],
        filters: buildArticleFilterProfile(),
        stateSnapshot: extractMapStateFromUrl(page.url()),
        probeMode: true,
      };
    }
  }

  for (
    let attempt = 0;
    attempt < maxAttempts && clickedCount < sampleCap;
    attempt++
  ) {
    if (!pageReadyForUi) break;
    try {
      // Find all markers
      const markers = await page
        .locator('.marker_count, .marker_inner, [class*="marker"]')
        .all();

      if (markers.length === 0) {
        console.log("  ℹ️  No markers found, scrolling map...");
        await page.mouse.wheel(0, 200);
        await randomDelay(1000, 2000);
        continue;
      }

      // Click random marker
      const randomIndex = Math.floor(Math.random() * markers.length);
      await markers[randomIndex].click({ timeout: 2000 });
      await randomDelay(2000, 3000);

      clickedCount++;
      console.log(`  ✅ Clicked listing ${clickedCount}/${sampleCap}`);

      // Scroll map slightly to load new markers
      if (clickedCount % 5 === 0) {
        await page.mouse.wheel(
          Math.random() * 100 - 50,
          Math.random() * 100 - 50,
        );
        await randomDelay(1000, 2000);
      }
    } catch (err) {
      if (verbose) console.log(`  ⚠️  Click attempt ${attempt + 1} failed`);
      await randomDelay(500, 1000);
    }
  }

  console.log("🛰️  네이버 API list endpoint 수집 시도...");
  if (!apiCollect) {
    apiCollect = await captureDirectArticleAPI(page, capturedResponses, rawStream);
  }

  if (!apiCollect.success) {
    console.log("⚠️  API 수집이 비어있거나 실패했습니다. 클릭 캡처 위주로 진행합니다.");
  }

  const finalState = extractMapStateFromUrl(page.url());

  console.log(`\n📊 Captured ${capturedResponses.length} responses\n`);

  rawStream.end();

  console.log("🔒 Closing browser...\n");
  await browser.close();

  // Count passively captured article responses (page's own XHR calls)
  const capturedArticleResponses = capturedResponses.filter((r) => {
    const url = r.request_url || "";
    return (
      url.includes("/api/articles?") &&
      !url.includes("/articles/clusters") &&
      !url.includes("/articles/interest") &&
      r.response_status === 200
    );
  });
  const capturedArticleCount = capturedArticleResponses.length;

  // Count actual article items in captured responses
  let capturedArticleItems = 0;
  for (const resp of capturedArticleResponses) {
    const body = resp.payload_json;
    if (body && typeof body === "object") {
      const articles = body.articleList ?? body.articles ?? [];
      if (Array.isArray(articles)) capturedArticleItems += articles.length;
    }
  }

  if (capturedArticleCount > 0) {
    console.log(`📡 Passively captured ${capturedArticleCount} article API responses with ${capturedArticleItems} items`);
  }

  // Save metadata
  const hasData = apiCollect.success || clickedCount > 0 || capturedArticleItems > 0;
  const totalArticles = apiCollect.totalListings + capturedArticleItems;
  const dataQualityGrade = (apiCollect.success && apiCollect.totalListings >= 10)
    ? "GOOD"
    : (totalArticles >= 10)
      ? "GOOD"
      : (totalArticles > 0 || clickedCount > 0)
        ? "PARTIAL"
        : "EMPTY";

  const metadata = {
    runId: `naver_${Date.now()}`,
    success: hasData,
    dataQuality: {
      grade: dataQualityGrade,
      apiSuccess: apiCollect.success,
      apiListings: apiCollect.totalListings,
      clickedListings: clickedCount,
      capturedArticleResponses: capturedArticleCount,
      capturedArticleItems,
      totalArticles,
      capturedResponses: capturedResponses.length,
    },
    sigungu,
    cortarNo,
    sampleCap,
    filters: buildArticleFilterProfile(),
    requestSource: {
      directRegionUrl: regionDirectUrl,
      filterProbe,
      filterProbeOnly,
      filterProbeDelayMs,
    },
    regionState: finalState,
    apiCollect,
    responsesCapture: capturedResponses.length,
    clickedListings: clickedCount,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };

  fs.writeFileSync(outputMeta, JSON.stringify(metadata, null, 2));

  console.log("✅ Capture complete!");
  console.log(`   Quality: ${dataQualityGrade}`);
  console.log(`   Responses: ${capturedResponses.length}`);
  console.log(`   Listings clicked: ${clickedCount}`);
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
