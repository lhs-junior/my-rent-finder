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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getExistingWithImagesAndFields } from "./lib/known_listings.mjs";

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

const sigungu = getArg("--sigungu", "노원구");
const sampleCap = normalizeSampleCap(getArg("--sample-cap", "100"), 100);
const rentMax = getIntArg("--rent-max", 100); // 만원
const depositMax = getIntArg("--deposit-max", 10000); // 만원
const minAreaM2 = getIntArg("--min-area", 40); // m²
const outputRaw = getArg("--output-raw", "scripts/peterpanz_raw_samples.jsonl");
const outputMeta = getArg("--output-meta", "scripts/peterpanz_capture_results.json");
const verbose = hasFlag("--verbose");
const QUERY_GRID_LEVELS = [4, 6];
const QUERY_PAGES_PER_CENTER = 3;
const QUERY_CENTER_LAT_PAD = 0.014;
const QUERY_CENTER_LNG_PAD = 0.018;
const API_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "x-peterpanz-version": "5.3",
  "x-peterpanz-page-id": "villa",
  "x-peterpanz-os": "pc",
  "Referer": "https://www.peterpanz.com/",
  "Origin": "https://www.peterpanz.com",
};

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
  "중구":     { lat: 37.5594, lng: 127.0139 },
  "종로구":   { lat: 37.5790, lng: 127.0126 },
};

const DISTRICT_BBOX = {
  "노원구":   { sw_lat: 37.6200, sw_lng: 127.0500, ne_lat: 37.6900, ne_lng: 127.1150 },
  "중랑구":   { sw_lat: 37.5700, sw_lng: 127.0550, ne_lat: 37.6350, ne_lng: 127.1200 },
  "동대문구": { sw_lat: 37.5550, sw_lng: 127.0100, ne_lat: 37.5950, ne_lng: 127.0850 },
  "광진구":   { sw_lat: 37.5200, sw_lng: 127.0550, ne_lat: 37.5700, ne_lng: 127.1100 },
  "성북구":   { sw_lat: 37.5700, sw_lng: 127.0000, ne_lat: 37.6000, ne_lng: 127.0700 },
  "성동구":   { sw_lat: 37.5400, sw_lng: 127.0100, ne_lat: 37.5850, ne_lng: 127.0750 },
  "중구":     { sw_lat: 37.5450, sw_lng: 127.0000, ne_lat: 37.5800, ne_lng: 127.0300 },
  "종로구":   { sw_lat: 37.5650, sw_lng: 127.0000, ne_lat: 37.5950, ne_lng: 127.0300 },
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

function dedupeStrings(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function toOriginImageUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  return url.replace(/_thumb(\.[a-z0-9]+)(\?.*)?$/i, "_origin$1$2");
}

function extractImagePaths(rawImages) {
  if (!rawImages) return [];
  if (Array.isArray(rawImages)) {
    return rawImages.map((img) => img?.path || img?.url || img?.img_path || img).filter(Boolean);
  }
  if (typeof rawImages === "object") {
    return Object.values(rawImages).flatMap((value) => extractImagePaths(value));
  }
  return [];
}

export function collectPeterpanzImageUrls(item) {
  return dedupeStrings([
    ...extractImagePaths(item?.image_urls_origin),
    ...extractImagePaths(item?.image_urls),
    ...extractImagePaths(item?.images),
    item?.info?.thumbnail,
  ]
    .filter(Boolean)
    .map(toOriginImageUrl));
}

function collectJsonLdImageValues(node, out) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const value of node) collectJsonLdImageValues(value, out);
    return;
  }
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (typeof node !== "object") return;

  if (node.image) collectJsonLdImageValues(node.image, out);
  if (node.thumbnailUrl) collectJsonLdImageValues(node.thumbnailUrl, out);
  if (node.url && /img\.peterpanz\.com/i.test(String(node.url))) {
    out.push(node.url);
  }
}

export function extractPeterpanzDetailImageUrlsFromHtml(html) {
  const source = String(html || "");
  if (!source) return [];

  const candidates = [];

  for (const match of source.matchAll(/houseImages\s*=\s*(\[[\s\S]*?\]);/g)) {
    try {
      const parsed = JSON.parse(match[1]);
      for (const image of parsed) {
        if (image?.deleted_at) continue;
        candidates.push(image?.img_path || image?.path || image?.url);
      }
    } catch {
      // ignore malformed inline data
    }
  }

  for (const match of source.matchAll(/<script[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi)) {
    const rawJson = String(match[1] || "").trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      collectJsonLdImageValues(parsed, candidates);
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }

  for (const match of source.matchAll(/https:\/\/img\.peterpanz\.com\/photo\/\d{8}\/\d+\/[^"'`\s<>]+/g)) {
    candidates.push(match[0]);
  }

  return dedupeStrings(candidates.map(toOriginImageUrl).filter(Boolean));
}

/**
 * HTML에서 이미지 URL + 상세 필드(description_text, bathroom_count, building_year 등)를 한 번에 추출.
 * var aptInfo = {...} 인라인 JSON을 파싱하는 것이 핵심.
 */
export function extractPeterpanzDetailDataFromHtml(html) {
  const source = String(html || "");
  const imageUrls = extractPeterpanzDetailImageUrlsFromHtml(source);

  let aptInfo = null;
  const aptMatch = source.match(/var\s+aptInfo\s*=\s*(\{[\s\S]*?\});\s*(?:var\s|let\s|const\s|<\/script>)/);
  if (aptMatch) {
    try { aptInfo = JSON.parse(aptMatch[1]); } catch { /* ignore */ }
  }

  if (!aptInfo) return { imageUrls };

  const descRaw = aptInfo.description || aptInfo.pp_details || null;
  const description_text = descRaw && String(descRaw).trim() ? String(descRaw).trim() : null;

  const bathroom_count = aptInfo.bathroom_count != null ? Number(aptInfo.bathroom_count) : null;

  // building_date: "2001-09-29" → 2001, build_year가 null인 경우 fallback
  const buildingDateRaw = aptInfo.build_year || aptInfo.building_date || null;
  const building_year = buildingDateRaw ? parseInt(String(buildingDateRaw), 10) : null;

  const moveText = String(aptInfo.move_text || aptInfo.move_date || "").trim();
  const available_date = moveText || null;

  const jibun_address = String(aptInfo.jibun_address || "").trim() || null;

  const direction = String(aptInfo.direction || "").trim() || null;

  // agent_name: JSON-LD Product의 offers.offeredBy.name
  let agent_name = null;
  for (const m of source.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const d = JSON.parse(m[1]);
      if (d?.offers?.offeredBy?.name) {
        agent_name = String(d.offers.offeredBy.name).trim() || null;
        break;
      }
    } catch { /* ignore */ }
  }

  return { imageUrls, description_text, bathroom_count, building_year, available_date, jibun_address, direction, agent_name };
}

export async function fetchPeterpanzDetailData(hidx, options = {}) {
  const listingId = String(hidx || "").trim();
  if (!listingId) return { imageUrls: [] };

  const fetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : fetch;
  const resp = await fetchImpl(`https://www.peterpanz.com/house/${encodeURIComponent(listingId)}`, {
    headers: { "User-Agent": API_HEADERS["User-Agent"], Accept: "text/html" },
    redirect: "follow",
    signal: options.signal ?? AbortSignal.timeout(12000),
  });

  if (!resp.ok) throw new Error(`detail_http_${resp.status}`);

  const html = await resp.text();
  return extractPeterpanzDetailDataFromHtml(html);
}

// backward compat — backfill_peterpanz_images.mjs 등에서 사용
export async function fetchPeterpanzDetailImageUrls(hidx, options = {}) {
  const data = await fetchPeterpanzDetailData(hidx, options);
  return data.imageUrls;
}

export async function enrichPeterpanzListingsWithDetailImages(items, { knownIds = new Set(), imageFetcher = fetchPeterpanzDetailData } = {}) {
  let enrichedCount = 0;
  let skippedKnown = 0;

  for (const item of items) {
    if (!item?.hidx) continue;

    const hasImages = collectPeterpanzImageUrls(item).length > 0;
    const isKnown = knownIds.has(String(item.hidx));

    // known 매물이고 이미지도 있으면 skip (추가 필드는 DB에 이미 있을 것)
    if (isKnown && hasImages) {
      skippedKnown++;
      continue;
    }

    try {
      const detail = await imageFetcher(item.hidx);

      // 이미지 병합 (없을 때만)
      if (!hasImages && detail.imageUrls?.length > 0) {
        item.image_urls_origin = detail.imageUrls;
        item.info = { ...(item.info || {}) };
        if (!item.info.thumbnail) item.info.thumbnail = detail.imageUrls[0];
      }

      // 추가 필드 병합
      if (detail.description_text) item.description_text = detail.description_text;
      if (detail.bathroom_count != null) item.bathroom_count = detail.bathroom_count;
      if (detail.building_year != null) item.building_year = detail.building_year;
      if (detail.available_date) item.available_date = detail.available_date;
      if (detail.jibun_address) item.jibun_address = detail.jibun_address;
      if (detail.direction && !item.info?.direction) {
        item.info = { ...(item.info || {}), direction: detail.direction };
      }
      if (detail.agent_name) item.agent_name = detail.agent_name;

      enrichedCount += 1;
      await sleep(120);
    } catch (error) {
      vlog(`detail fetch failed for ${item.hidx}: ${error.message}`);
    }
  }

  if (skippedKnown > 0) log(`Skipped ${skippedKnown} known listings (detail fetch)`);
  return { enrichedCount };
}

/**
 * Build PeterPanz villa page URL with filter parameters.
 */
function _buildPeterpanzUrl() {
  const center = JSON.stringify({
    y: district.lat, _lat: district.lat,
    x: district.lng, _lng: district.lng,
  });
  const filter = buildFilterForBbox(bbox);
  return `https://www.peterpanz.com/villa?zoomLevel=14&center=${encodeURIComponent(center)}&dong=&gungu=&filter=${encodeURIComponent(filter)}`;
}

/**
 * Build direct API URL for houses list.
 */
function buildFilterForBbox(queryBbox) {
  const filterParts = [
    `latitude:${queryBbox.sw_lat.toFixed(6)}~${queryBbox.ne_lat.toFixed(6)}`,
    `longitude:${queryBbox.sw_lng.toFixed(6)}~${queryBbox.ne_lng.toFixed(6)}`,
    `checkDeposit:0~${depositMax * 10000}`,
    `checkMonth:0~${rentMax * 10000}`,
    `checkRealSize:${minAreaM2}~999`,
    'contractType;["월세"]',
    'roomType;["투룸","원룸","쓰리룸","쓰리룸+"]',
    'buildingType;["빌라/주택"]',
  ];
  return filterParts.join("||");
}

function buildApiUrl({
  center = district,
  queryBbox = bbox,
  pageIndex = 1,
  pageSize = 50,
  dong = "",
  gungu = "",
} = {}) {
  const centerText = JSON.stringify({
    y: center.lat, _lat: center.lat,
    x: center.lng, _lng: center.lng,
  });

  const filter = buildFilterForBbox(queryBbox);
  const params = new URLSearchParams({
    zoomLevel: "14",
    center: centerText,
    dong,
    gungu,
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

function buildNarrowQueryBbox(center) {
  return {
    sw_lat: center.lat - QUERY_CENTER_LAT_PAD,
    sw_lng: center.lng - QUERY_CENTER_LNG_PAD,
    ne_lat: center.lat + QUERY_CENTER_LAT_PAD,
    ne_lng: center.lng + QUERY_CENTER_LNG_PAD,
  };
}

async function reverseGeocodeDistrictPoint(lat, lng) {
  const res = await fetch(`https://api.peterpanz.com/geo/addr_dong/${lat}/${lng}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  const parts = String(body?.data || "")
    .split(/\s+/)
    .filter(Boolean);
  return {
    full: body?.data || "",
    sigungu: parts[1] || "",
    dong: parts[2] || "",
  };
}

export function buildGridProbePoints(queryBbox, gridSize) {
  const points = [];
  for (let row = 0; row < gridSize; row += 1) {
    for (let col = 0; col < gridSize; col += 1) {
      const lat = queryBbox.sw_lat + ((queryBbox.ne_lat - queryBbox.sw_lat) * (row + 0.5)) / gridSize;
      const lng = queryBbox.sw_lng + ((queryBbox.ne_lng - queryBbox.sw_lng) * (col + 0.5)) / gridSize;
      points.push({
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
      });
    }
  }
  return points;
}

async function collectDistrictQueryCenters() {
  const centersByDong = new Map();
  const seenDong = new Set();
  for (const gridSize of QUERY_GRID_LEVELS) {
    let addedThisPass = 0;
    for (const point of buildGridProbePoints(bbox, gridSize)) {
      const region = await reverseGeocodeDistrictPoint(point.lat, point.lng).catch(() => null);
      if (!region || region.sigungu !== sigungu || !region.dong || seenDong.has(region.dong)) continue;
      seenDong.add(region.dong);
      centersByDong.set(region.dong, {
        lat: point.lat,
        lng: point.lng,
        dong: region.dong,
        full: region.full,
      });
      addedThisPass += 1;
      await sleep(80);
    }
    if (centersByDong.size > 0 && addedThisPass === 0) break;
  }

  const centers = Array.from(centersByDong.values());
  if (centers.length > 0) {
    return centers;
  }

  const fallbackRegion = await reverseGeocodeDistrictPoint(district.lat, district.lng).catch(() => null);
  return [{
    lat: district.lat,
    lng: district.lng,
    dong: fallbackRegion?.dong || "",
    full: fallbackRegion?.full || `${sigungu}`,
  }];
}

/**
 * Extract individual house items from the API response.
 * The response groups houses as: houses.recommend.image[], houses.withoutFee.image[], etc.
 */
function getHouseImageCount(item) {
  return Array.isArray(item?.images?.S) ? item.images.S.filter((img) => img?.path).length : 0;
}

function scoreHouseVariant(item) {
  let score = 0;
  score += getHouseImageCount(item) * 100;
  if (item?.info?.thumbnail) score += 20;
  if (item?.location?.address?.text) score += 10;
  if (item?.location?.coordinate?.latitude && item?.location?.coordinate?.longitude) score += 5;
  if (item?.price?.deposit != null || item?.price?.monthly_fee != null) score += 5;
  if (item?.info?.real_size != null) score += 5;
  return score;
}

function mergeHouseVariants(existing, candidate) {
  const existingScore = scoreHouseVariant(existing);
  const candidateScore = scoreHouseVariant(candidate);
  const primary = candidateScore > existingScore ? candidate : existing;
  const secondary = primary === candidate ? existing : candidate;
  const primaryImageCount = getHouseImageCount(primary);
  const secondaryImageCount = getHouseImageCount(secondary);

  return {
    ...secondary,
    ...primary,
    attribute: { ...(secondary.attribute || {}), ...(primary.attribute || {}) },
    info: { ...(secondary.info || {}), ...(primary.info || {}) },
    type: { ...(secondary.type || {}), ...(primary.type || {}) },
    price: { ...(secondary.price || {}), ...(primary.price || {}) },
    floor: { ...(secondary.floor || {}), ...(primary.floor || {}) },
    location: {
      ...(secondary.location || {}),
      ...(primary.location || {}),
      coordinate: {
        ...(secondary.location?.coordinate || {}),
        ...(primary.location?.coordinate || {}),
      },
      address: {
        ...(secondary.location?.address || {}),
        ...(primary.location?.address || {}),
      },
    },
    additional_options: {
      ...(secondary.additional_options || {}),
      ...(primary.additional_options || {}),
    },
    images: primaryImageCount >= secondaryImageCount ? primary.images : secondary.images,
  };
}

export function extractHousesFromResponse(data) {
  const housesById = new Map();

  if (!data?.houses) return [];

  for (const group of Object.values(data.houses)) {
    if (!group || typeof group !== "object") continue;
    // Each group has sub-arrays: image[], text[], etc.
    for (const items of Object.values(group)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item?.hidx) continue;
        const key = String(item.hidx);
        if (!housesById.has(key)) {
          housesById.set(key, item);
          continue;
        }
        housesById.set(key, mergeHouseVariants(housesById.get(key), item));
      }
    }
  }

  return Array.from(housesById.values());
}

/**
 * Apply search condition filters to captured listings.
 */
export function filterPeterpanzListings(items, {
  sigungu: targetSigungu = sigungu,
  bbox: targetBbox = bbox,
  rentMax: targetRentMax = rentMax,
  depositMax: targetDepositMax = depositMax,
  minAreaM2: targetMinAreaM2 = minAreaM2,
} = {}) {
  const before = items.length;
  const reasons = { rent: 0, deposit: 0, area: 0, type: 0, sigungu: 0, location: 0 };

  const filtered = items.filter((item) => {
    // Contract type filter (월세 only)
    const contractType = item.type?.contract_type;
    if (contractType && contractType !== "월세") {
      reasons.type++;
      return false;
    }

    // Rent filter (원 → 만원)
    const monthlyFee = item.price?.monthly_fee;
    if (monthlyFee != null && monthlyFee > 0 && monthlyFee / 10000 > targetRentMax) {
      reasons.rent++;
      return false;
    }

    // Deposit filter (원 → 만원)
    const deposit = item.price?.deposit;
    if (deposit != null && deposit > 0 && deposit / 10000 > targetDepositMax) {
      reasons.deposit++;
      return false;
    }

    // Area filter (m²)
    const realSize = item.info?.real_size;
    if (realSize != null && realSize > 0 && realSize < targetMinAreaM2) {
      reasons.area++;
      return false;
    }

    // Exact district filter — 실제 행정구역명(XXX구/군/시)인 경우만 문자열 비교
    // "서울숲권역"처럼 커스텀 권역명은 bbox 필터링으로 대체
    const isAdminDistrict = /[구군시]$/.test(targetSigungu);
    const itemSigungu = String(item.location?.address?.sigungu || "").trim();
    if (isAdminDistrict && itemSigungu && itemSigungu !== targetSigungu) {
      reasons.sigungu++;
      return false;
    }

    // 권역명이거나 주소 sigungu 없을 때 → bbox로 필터링
    if ((!itemSigungu || !isAdminDistrict) && targetBbox && item.location?.coordinate) {
      const PAD = 0.008;
      const lat = parseFloat(item.location.coordinate.latitude);
      const lng = parseFloat(item.location.coordinate.longitude);
      if (
        Number.isFinite(lat) && Number.isFinite(lng) &&
        (lat < targetBbox.sw_lat - PAD || lat > targetBbox.ne_lat + PAD ||
         lng < targetBbox.sw_lng - PAD || lng > targetBbox.ne_lng + PAD)
      ) {
        reasons.location++;
        return false;
      }
    }

    return true;
  });

  if (before !== filtered.length) {
    log(`Filtered: ${before} -> ${filtered.length} (type:${reasons.type}, rent:${reasons.rent}, deposit:${reasons.deposit}, area:${reasons.area}, sigungu:${reasons.sigungu}, location:${reasons.location})`);
  }

  return filtered;
}

function filterListings(items) {
  return filterPeterpanzListings(items, { sigungu, bbox, rentMax, depositMax, minAreaM2 });
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
  log("");

  try {
    // ---- District center sweep ----
    const queryCenters = await collectDistrictQueryCenters();
    if (queryCenters.length > 0) {
      vlog(`Query centers: ${queryCenters.map((center) => center.dong || `${center.lat},${center.lng}`).join(", ")}`);
    }

    const housesById = new Map();
    const requestUrlById = new Map();
    const pageSize = 50;
    let queryCount = 0;

    for (const center of queryCenters) {
      const queryBbox = buildNarrowQueryBbox(center);
      for (let pageIndex = 1; pageIndex <= QUERY_PAGES_PER_CENTER; pageIndex += 1) {
        const url = buildApiUrl({
          center,
          queryBbox,
          pageIndex,
          pageSize,
          dong: center.dong || "",
          gungu: sigungu,
        });
        queryCount += 1;
        vlog(`Fetching ${center.dong || `${center.lat},${center.lng}`} page ${pageIndex}...`);

        const res = await fetch(url, { headers: API_HEADERS });
        if (!res.ok) {
          log(`API HTTP ${res.status} on ${center.dong || sigungu} page ${pageIndex}`);
          break;
        }

        const body = await res.json();
        const items = extractHousesFromResponse(body);
        const totalCount = body.totalCount || 0;

        let newCount = 0;
        for (const item of items) {
          if (!item?.hidx) continue;
          const key = String(item.hidx);
          if (!housesById.has(key)) {
            housesById.set(key, item);
            requestUrlById.set(key, url);
            newCount += 1;
            continue;
          }
          housesById.set(key, mergeHouseVariants(housesById.get(key), item));
        }

        vlog(`${center.dong || sigungu} page ${pageIndex}: ${items.length} items (${newCount} new), totalCount: ${totalCount}`);
        if (items.length === 0) break;
        if (newCount === 0 && pageIndex > 1) break;
        await sleep(250);
      }
    }

    const allHouses = Array.from(housesById.values());
    log(`Total fetched: ${allHouses.length} unique items`);

    // ---- Filter ----
    const filtered = filterListings(allHouses);
    const selected = Number.isFinite(sampleCap) ? filtered.slice(0, sampleCap) : filtered;
    log(`After filter: ${filtered.length} items`);
    if (selected.length !== filtered.length) {
      log(`After sample cap: ${selected.length} items`);
    }

    if (selected.length > 0) {
      log(`Detail fetch: enriching ${selected.length} listings (images + description/bathroom/year/address/agent)`);
      const allHidx = selected.filter((item) => item?.hidx).map((item) => String(item.hidx));
      const knownIds = await getExistingWithImagesAndFields("peterpanz", allHidx, ["description_text"], { maxAgeHours: 72 });
      const enriched = await enrichPeterpanzListingsWithDetailImages(selected, { knownIds });
      const missingImageAfter = selected.filter((item) => collectPeterpanzImageUrls(item).length === 0).length;
      log(`Detail fetch: enriched ${enriched.enrichedCount}, image-missing ${missingImageAfter}`);
    }

    // ---- Write raw JSONL ----
    for (const item of selected) {
      const record = {
        platform_code: "peterpanz",
        collected_at: new Date().toISOString(),
        source_url: `https://www.peterpanz.com/house/${item.hidx}`,
        request_url: requestUrlById.get(String(item.hidx)) || "",
        response_status: 200,
        sigungu,
        payload_json: item,
      };
      rawStream.write(JSON.stringify(record) + "\n");
    }

    rawStream.end();

    // ---- Write metadata ----
    let dataQualityGrade = "EMPTY";
    if (filtered.length >= 10) dataQualityGrade = "GOOD";
    else if (filtered.length > 0) dataQualityGrade = "PARTIAL";

    const totalDurationMs = Date.now() - startTime;

    const metadata = {
      runId: `peterpanz_${Date.now()}`,
      success: selected.length > 0,
      sigungu,
      sampleCap,
      filters: { rentMax, depositMax, minAreaM2 },
      queryCenters: queryCenters.map((center) => center.dong || center.full || `${center.lat},${center.lng}`),
      queryCount,
      totalFetched: allHouses.length,
      afterFilter: filtered.length,
      totalListings: selected.length,
      dataQuality: { grade: dataQualityGrade },
      timestamp: new Date().toISOString(),
      durationMs: totalDurationMs,
    };

    fs.writeFileSync(outputMeta, JSON.stringify(metadata, null, 2));

    log("");
    log("=== Collection Complete ===");
    log(`Success: ${metadata.success}`);
    log(`Total listings: ${selected.length}`);
    log(`Data quality: ${dataQualityGrade}`);
    log(`Duration: ${Math.round(totalDurationMs / 1000)}s`);
    log(`Raw data: ${outputRaw}`);
    log(`Metadata: ${outputMeta}`);

    if (selected.length > 0) {
      log("");
      log("Sample listings:");
      for (const item of selected.slice(0, 5)) {
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

if (isDirectRun) {
  collectPeterpanz().catch((err) => {
    console.error(`[peterpanz] Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}
