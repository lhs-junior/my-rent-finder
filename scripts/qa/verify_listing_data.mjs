#!/usr/bin/env node
/**
 * verify_listing_data.mjs
 *
 * Compares raw platform data (JSONL) against normalized adapter output (JSON)
 * to find MISSING, MISMATCH, and ANOMALY issues.
 *
 * Usage:
 *   node scripts/qa/verify_listing_data.mjs --run <run_directory>
 *   node scripts/qa/verify_listing_data.mjs --run scripts/parallel_collect_runs/latest
 *   node scripts/qa/verify_listing_data.mjs --raw foo.jsonl --normalized foo.json --platform dabang
 *   node scripts/qa/verify_listing_data.mjs --raw foo.jsonl --normalized foo.json --platform dabang --max-items 50
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    run:        { type: "string" },
    raw:        { type: "string" },
    normalized: { type: "string" },
    platform:   { type: "string" },
    "max-items":{ type: "string" },
    help:       { type: "boolean", short: "h" },
  },
  strict: false,
});

if (args.help) {
  console.log(`Usage:
  node scripts/qa/verify_listing_data.mjs --run <run_directory>
  node scripts/qa/verify_listing_data.mjs --raw <raw.jsonl> --normalized <output.json> --platform <platform>

Options:
  --run           Path to a parallel_collect_runs directory
  --raw           Path to raw JSONL file
  --normalized    Path to normalized adapter output JSON
  --platform      Platform filter (dabang, zigbang, peterpanz, daangn, naver)
  --max-items     Max items to verify per platform
  -h, --help      Show this help`);
  process.exit(0);
}

const MAX_ITEMS = args["max-items"] ? parseInt(args["max-items"], 10) : Infinity;

// ---------------------------------------------------------------------------
// Direction mapping
// ---------------------------------------------------------------------------

const DIRECTION_EN_TO_KO = {
  N: "북향", S: "남향", E: "동향", W: "서향",
  NE: "북동향", NW: "북서향", SE: "남동향", SW: "남서향",
};

const DIRECTION_ALIASES = {
  "남서향": "남서향", "남동향": "남동향", "북서향": "북서향", "북동향": "북동향",
  "남향": "남향", "북향": "북향", "동향": "동향", "서향": "서향",
};

function normalizeDirection(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (DIRECTION_EN_TO_KO[s]) return DIRECTION_EN_TO_KO[s];
  if (DIRECTION_ALIASES[s]) return DIRECTION_ALIASES[s];
  // Handle "남서" -> "남서향"
  if (s.length >= 1 && s.length <= 2 && !s.endsWith("향")) {
    const withSuffix = s + "향";
    if (DIRECTION_ALIASES[withSuffix]) return withSuffix;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Range checks (ANOMALY detection)
// ---------------------------------------------------------------------------

const RANGE_CHECKS = {
  area_exclusive_m2: { min: 0.01, max: 300, label: "전용면적" },
  area_gross_m2:     { min: 0.01, max: 500, label: "공급면적" },
  rent_amount:       { min: 0.01, max: 2000, label: "월세" },
  deposit_amount:    { min: 0, max: 100000, label: "보증금" },
  floor:             { check: (v) => v === 0, label: "층수", anomalyDesc: "floor=0 (invalid)" },
  total_floor:       { min: 0.01, max: 100, label: "총층수" },
  room_count:        { min: 0.01, max: 20, label: "방수" },
  bathroom_count:    { min: 0.01, max: 10, label: "욕실수" },
  lat:               { min: 33, max: 39, label: "위도" },
  lng:               { min: 124, max: 132, label: "경도" },
};

function checkAnomaly(field, value) {
  const rule = RANGE_CHECKS[field];
  if (!rule || value == null) return null;
  const v = Number(value);
  if (isNaN(v)) return `${rule.label}: NaN`;
  if (rule.check) {
    if (rule.check(v)) return rule.anomalyDesc || `${rule.label}: out of range`;
    return null;
  }
  if (v < rule.min || v > rule.max) {
    return `${rule.label}: ${v} not in [${rule.min}, ${rule.max}]`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Comparison tolerance
// ---------------------------------------------------------------------------

function priceMatch(rawVal, normVal) {
  if (rawVal == null || normVal == null) return null; // can't compare
  return Number(rawVal) === Number(normVal);
}

function areaMatch(rawVal, normVal) {
  if (rawVal == null || normVal == null) return null;
  return Math.abs(Number(rawVal) - Number(normVal)) <= 0.5;
}

function floorMatch(rawVal, normVal) {
  if (rawVal == null || normVal == null) return null;
  return Number(rawVal) === Number(normVal);
}

function coordMatch(rawVal, normVal) {
  if (rawVal == null || normVal == null) return null;
  return Math.abs(Number(rawVal) - Number(normVal)) <= 0.01;
}

function directionMatch(rawVal, normVal) {
  if (rawVal == null || normVal == null) return null;
  const rn = normalizeDirection(rawVal);
  const nn = normalizeDirection(normVal);
  return rn === nn;
}

// ---------------------------------------------------------------------------
// Platform-specific raw field extraction
// ---------------------------------------------------------------------------

function deepGet(obj, pathStr) {
  if (!obj || !pathStr) return undefined;
  const parts = pathStr.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function firstDefined(obj, ...paths) {
  for (const p of paths) {
    const v = deepGet(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

// --- Dabang ---

function parseDabangPriceTitle(priceTitle) {
  if (!priceTitle) return { deposit: null, rent: null };
  const m = String(priceTitle).match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (!m) return { deposit: null, rent: null };
  return { deposit: Number(m[1]), rent: Number(m[2]) };
}

function parseDabangRoomDesc(roomDesc) {
  if (!roomDesc) return { floor: null, area: null, maintenance: null };
  const desc = String(roomDesc);
  let floor = null;
  let area = null;
  let maintenance = null;

  // floor: "5층" or "고층" or "저층" or "1층"
  const floorMatch_ = desc.match(/(\d+)\s*층/);
  if (floorMatch_) {
    floor = parseInt(floorMatch_[1], 10);
  } else if (desc.includes("고층")) {
    floor = "고";
  } else if (desc.includes("저층")) {
    floor = "저";
  } else if (desc.includes("중층")) {
    floor = "중";
  }

  // area: "40m²" or "44.37m²"
  const areaMatch_ = desc.match(/([\d.]+)\s*m²/);
  if (areaMatch_) {
    area = parseFloat(areaMatch_[1]);
  }

  // maintenance: "관리비 10만" or "관리비 0.5만"
  const maintMatch_ = desc.match(/관리비\s*([\d.]+)\s*만/);
  if (maintMatch_) {
    maintenance = parseFloat(maintMatch_[1]);
  }

  return { floor, area, maintenance };
}

function extractDabangRaw(raw) {
  const pj = raw.payload_json || {};
  const ld = raw.list_data || {};
  const priceTitle = pj.priceTitle || ld.priceTitle;
  const { deposit, rent } = parseDabangPriceTitle(priceTitle);
  const roomDesc = pj.roomDesc || ld.roomDesc;
  const { floor, area } = parseDabangRoomDesc(roomDesc);

  const roomTypeName = pj.roomTypeName || ld.roomTypeName;
  let room_count = null;
  if (roomTypeName) {
    if (roomTypeName.includes("원룸")) room_count = 1;
    else if (roomTypeName.includes("투룸")) room_count = 2;
    else if (roomTypeName.includes("쓰리룸")) room_count = 3;
    else if (roomTypeName.includes("포룸")) room_count = 4;
  }

  return {
    source_ref: String(pj.id || ld.id || pj.seq || ld.seq || ""),
    rent_amount: rent,
    deposit_amount: deposit,
    area_exclusive_m2: area,
    area_gross_m2: null,
    floor: typeof floor === "number" ? floor : null,
    total_floor: null,
    direction: null,
    lat: firstDefined(pj, "randomLocation.lat") ?? firstDefined(ld, "randomLocation.lat"),
    lng: firstDefined(pj, "randomLocation.lng") ?? firstDefined(ld, "randomLocation.lng"),
    room_count,
    bathroom_count: null,
    title: pj.roomTitle || ld.roomTitle || null,
  };
}

// --- Zigbang ---

function extractZigbangRaw(raw) {
  const pj = raw.payload_json || {};
  const rent = firstDefined(pj, "rent", "price.rent");
  const deposit = firstDefined(pj, "deposit", "price.deposit");

  let areaExcl = firstDefined(pj, "전용면적.m2");
  let areaGross = firstDefined(pj, "공급면적.m2", "size_m2", "area");

  let floor = firstDefined(pj, "floor.floor", "floor_string");
  let totalFloor = firstDefined(pj, "floor.allFloors", "building_floor");

  // Parse floor strings
  if (typeof floor === "string") {
    if (floor === "반지하") floor = -1;
    else if (floor === "옥탑") floor = 999;
    else if (/^\d+$/.test(floor)) floor = parseInt(floor, 10);
    else if (floor === "저" || floor === "중" || floor === "고") floor = null; // vague
    else floor = null;
  }
  if (typeof totalFloor === "string") {
    totalFloor = /^\d+$/.test(totalFloor) ? parseInt(totalFloor, 10) : null;
  }

  const direction = pj.roomDirection || pj.direction || null;
  const bathroomCount = pj.bathroomCount ? parseInt(pj.bathroomCount, 10) : null;

  return {
    source_ref: String(pj.item_id || pj.itemId || ""),
    rent_amount: rent != null ? Number(rent) : null,
    deposit_amount: deposit != null ? Number(deposit) : null,
    area_exclusive_m2: areaExcl != null ? Number(areaExcl) : null,
    area_gross_m2: areaGross != null ? Number(areaGross) : null,
    floor: typeof floor === "number" ? floor : null,
    total_floor: typeof totalFloor === "number" ? totalFloor : null,
    direction: normalizeDirection(direction),
    lat: firstDefined(pj, "random_location.lat", "location.lat", "randomLocation.lat"),
    lng: firstDefined(pj, "random_location.lng", "location.lng", "randomLocation.lng"),
    room_count: null, // not directly available as a number
    bathroom_count: bathroomCount,
    title: pj.title || null,
  };
}

// --- PeterPanz ---

function extractPeterpanzRaw(raw) {
  const pj = raw.payload_json || {};
  // Prices in WON, convert to 만원
  const rentWon = firstDefined(pj, "price.monthly_fee");
  const depositWon = firstDefined(pj, "price.deposit");
  const rent = rentWon != null ? Math.round(Number(rentWon) / 10000) : null;
  const deposit = depositWon != null ? Math.round(Number(depositWon) / 10000) : null;

  const areaExcl = firstDefined(pj, "info.real_size");
  const areaGross = firstDefined(pj, "info.supplied_size");
  const floor = firstDefined(pj, "floor.target");
  const totalFloor = firstDefined(pj, "floor.total");
  const roomCount = firstDefined(pj, "info.room_count", "info.bedroom_count");

  const elevator = firstDefined(pj, "additional_options.have_elevator");
  const parking = firstDefined(pj, "additional_options.have_parking_lot");

  const maintenanceCost = firstDefined(pj, "price.maintenance_cost");

  return {
    source_ref: String(pj.hidx || ""),
    rent_amount: rent,
    deposit_amount: deposit,
    area_exclusive_m2: areaExcl != null ? Number(areaExcl) : null,
    area_gross_m2: areaGross != null ? Number(areaGross) : null,
    floor: floor != null ? Number(floor) : null,
    total_floor: totalFloor != null ? Number(totalFloor) : null,
    direction: null, // peterpanz has no direction field in raw
    lat: firstDefined(pj, "location.coordinate.latitude"),
    lng: firstDefined(pj, "location.coordinate.longitude"),
    room_count: roomCount != null ? Number(roomCount) : null,
    bathroom_count: null,
    title: firstDefined(pj, "info.subject") || null,
  };
}

// --- Daangn ---

function extractDaangnRaw(raw) {
  const pj = raw.payload_json || {};
  const ld = raw.list_data || {};

  const rent = firstDefined(pj, "rent") ?? null;
  const deposit = firstDefined(pj, "deposit") ?? null;
  const area = firstDefined(pj, "area") ?? null;
  const supplyArea = pj.supplyArea ? parseFloat(pj.supplyArea) : null;

  let floor = firstDefined(pj, "floor", "floorLevel") ?? firstDefined(ld, "floor");
  let totalFloor = firstDefined(pj, "topFloor", "total_floor") ?? firstDefined(ld, "topFloor", "total_floor");

  // totalFloor can be "3층" string
  if (typeof totalFloor === "string") {
    const m = totalFloor.match(/(\d+)/);
    totalFloor = m ? parseInt(m[1], 10) : null;
  }
  if (typeof floor === "string") {
    const m = floor.match(/(\d+)/);
    floor = m ? parseInt(m[1], 10) : null;
  }
  if (typeof floor === "number" && floor >= 0) { /* ok */ }
  else if (floor != null) floor = Number(floor) || null;

  const direction = firstDefined(pj, "direction", "directionText") ?? firstDefined(ld, "direction", "directionText");

  return {
    source_ref: String(pj.id || pj.source_ref || ld.source_ref || ""),
    rent_amount: rent != null ? Number(rent) : null,
    deposit_amount: deposit != null ? Number(deposit) : null,
    area_exclusive_m2: area != null ? Number(area) : null,
    area_gross_m2: supplyArea,
    floor: floor != null ? Number(floor) : null,
    total_floor: totalFloor != null ? Number(totalFloor) : null,
    direction: normalizeDirection(direction),
    lat: null, // daangn raw has no coordinates
    lng: null,
    room_count: null,
    bathroom_count: null,
    title: firstDefined(pj, "name") ?? firstDefined(ld, "roomTitle") ?? null,
  };
}

// --- Naver ---

function parseNaverFloorInfo(floorInfo) {
  if (!floorInfo) return { floor: null, total_floor: null };
  const parts = String(floorInfo).split("/");
  let floor = null;
  let total_floor = null;

  if (parts.length >= 2) {
    const floorStr = parts[0].trim();
    const totalStr = parts[1].trim();

    if (/^\d+$/.test(floorStr)) floor = parseInt(floorStr, 10);
    else if (floorStr === "B1" || floorStr.includes("반지")) floor = -1;
    else if (floorStr === "고" || floorStr === "중" || floorStr === "저") floor = null; // vague

    if (/^\d+$/.test(totalStr)) total_floor = parseInt(totalStr, 10);
  }
  return { floor, total_floor };
}

function parseNaverPrice(priceStr) {
  if (!priceStr) return null;
  // "2,000" -> 2000, "500" -> 500
  return parseInt(String(priceStr).replace(/,/g, ""), 10) || null;
}

function extractNaverRaw(raw) {
  const pj = raw.payload_json || {};

  // Naver raw can be an articleList wrapper or a single article
  // For articleList records, payload_json has an articleList array — skip these
  // We look for individual article data with articleNo
  const article = pj.articleNo ? pj : null;
  if (!article) return null;

  const { floor, total_floor } = parseNaverFloorInfo(article.floorInfo);
  const rentPrc = article.rentPrc != null ? Number(article.rentPrc) : null;
  const deposit = parseNaverPrice(article.dealOrWarrantPrc);
  // Naver adapter maps area1 -> exclusive, area2 -> gross
  const areaExcl = article.area1 != null ? Number(article.area1) : null;
  const areaGross = article.area2 != null ? Number(article.area2) : null;

  const lat = article.latitude ? parseFloat(article.latitude) : null;
  const lng = article.longitude ? parseFloat(article.longitude) : null;

  return {
    source_ref: String(article.articleNo || article.atclNo || ""),
    rent_amount: rentPrc,
    deposit_amount: deposit,
    area_exclusive_m2: areaExcl,
    area_gross_m2: areaGross,
    floor,
    total_floor,
    direction: normalizeDirection(article.direction),
    lat: lat && lat > 1 ? lat : null, // naver sometimes has 0
    lng: lng && lng > 1 ? lng : null,
    room_count: null,
    bathroom_count: null,
    title: article.articleName || article.articleFeatureDesc || null,
  };
}

// ---------------------------------------------------------------------------
// Extractor dispatch
// ---------------------------------------------------------------------------

const EXTRACTORS = {
  dabang: extractDabangRaw,
  zigbang: extractZigbangRaw,
  peterpanz: extractPeterpanzRaw,
  daangn: extractDaangnRaw,
  naver: extractNaverRaw,
};

// ---------------------------------------------------------------------------
// Fields to compare
// ---------------------------------------------------------------------------

const COMPARE_FIELDS = [
  { field: "rent_amount",       compare: priceMatch, label: "월세" },
  { field: "deposit_amount",    compare: priceMatch, label: "보증금" },
  { field: "area_exclusive_m2", compare: areaMatch,  label: "전용면적" },
  { field: "area_gross_m2",     compare: areaMatch,  label: "공급면적" },
  { field: "floor",             compare: floorMatch, label: "층수" },
  { field: "total_floor",       compare: floorMatch, label: "총층수" },
  { field: "direction",         compare: directionMatch, label: "향" },
  { field: "lat",               compare: coordMatch, label: "위도" },
  { field: "lng",               compare: coordMatch, label: "경도" },
];

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

function loadJsonlRawRecords(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const records = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // skip parse errors
    }
  }
  return records;
}

function loadNormalizedItems(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(content);
  // Could be { items: [...] } or just [...]
  if (Array.isArray(data)) return data;
  if (data.items && Array.isArray(data.items)) return data.items;
  return [];
}

/**
 * For naver, raw records contain articleList arrays inside payload_json.
 * We need to flatten individual articles out.
 */
function flattenNaverRawRecords(records) {
  const articles = [];
  for (const rec of records) {
    const pj = rec.payload_json;
    if (!pj) continue;

    // Direct article with articleNo
    if (pj.articleNo) {
      articles.push(rec);
      continue;
    }

    // articleList wrapper
    if (pj.articleList && Array.isArray(pj.articleList)) {
      for (const art of pj.articleList) {
        articles.push({
          ...rec,
          payload_json: art,
        });
      }
    }
  }
  return articles;
}

// ---------------------------------------------------------------------------
// Core verification
// ---------------------------------------------------------------------------

function verifyPlatform(platform, rawRecords, normalizedItems) {
  const extractor = EXTRACTORS[platform];
  if (!extractor) {
    console.error(`  [WARN] No extractor for platform: ${platform}`);
    return null;
  }

  // Build raw index by source_ref
  let rawList;
  if (platform === "naver") {
    rawList = flattenNaverRawRecords(rawRecords);
  } else {
    rawList = rawRecords;
  }

  const rawIndex = new Map();
  for (const rec of rawList) {
    const extracted = extractor(rec);
    if (!extracted || !extracted.source_ref) continue;
    // Keep first occurrence per source_ref (or overwrite, last wins)
    rawIndex.set(extracted.source_ref, extracted);
  }

  // Per-field stats
  const fieldStats = {};
  for (const { field, label } of COMPARE_FIELDS) {
    fieldStats[field] = { label, ok: 0, missing: 0, mismatch: 0, anomaly: 0, total: 0, details: [] };
  }

  let matchedCount = 0;
  let unmatchedCount = 0;
  const anomalies = [];

  const itemsToCheck = normalizedItems.slice(0, MAX_ITEMS);

  for (const normItem of itemsToCheck) {
    const ref = normItem.source_ref || normItem.external_id;
    if (!ref) { unmatchedCount++; continue; }

    const rawExtracted = rawIndex.get(String(ref));
    if (!rawExtracted) { unmatchedCount++; continue; }
    matchedCount++;

    for (const { field, compare } of COMPARE_FIELDS) {
      const rawVal = rawExtracted[field];
      const normVal = normItem[field];
      const stats = fieldStats[field];
      stats.total++;

      // 1. Check anomaly on normalized value
      const anomalyMsg = checkAnomaly(field, normVal);
      if (anomalyMsg && rawVal != null) {
        stats.anomaly++;
        stats.details.push({ ref, type: "ANOMALY", rawVal, normVal, msg: anomalyMsg });
        continue;
      }

      // 2. Check MISSING: raw has value but normalized doesn't
      if (rawVal != null && (normVal == null || normVal === 0)) {
        // area=0 is also treated as missing if raw has a real value
        if (field.startsWith("area") && normVal === 0 && rawVal > 0) {
          stats.anomaly++;
          stats.details.push({ ref, type: "ANOMALY", rawVal, normVal, msg: `${field}=0 but raw=${rawVal}` });
        } else {
          stats.missing++;
          stats.details.push({ ref, type: "MISSING", rawVal, normVal });
        }
        continue;
      }

      // 3. Both null — skip (N/A)
      if (rawVal == null && normVal == null) {
        stats.ok++;
        continue;
      }
      if (rawVal == null && normVal != null) {
        // Normalized has extra data — that's fine (enrichment)
        stats.ok++;
        continue;
      }

      // 4. Compare
      const result = compare(rawVal, normVal);
      if (result === null) {
        stats.ok++;
      } else if (result) {
        stats.ok++;
      } else {
        stats.mismatch++;
        stats.details.push({ ref, type: "MISMATCH", rawVal, normVal });
      }
    }
  }

  return {
    platform,
    totalNormalized: itemsToCheck.length,
    totalRaw: rawIndex.size,
    matched: matchedCount,
    unmatched: unmatchedCount,
    fieldStats,
  };
}

// ---------------------------------------------------------------------------
// Discover file pairs in a run directory
// ---------------------------------------------------------------------------

function discoverRunPairs(runDir) {
  const files = fs.readdirSync(runDir);
  const pairs = [];

  // Pattern 1: {platform}_raw_*.jsonl + {platform}_normalized_*.json (naver style)
  // Pattern 2: Use *_raw_samples.jsonl + *_adapter_output.json from scripts/
  // Pattern 3: Also search sibling adapter outputs

  const rawFiles = files.filter(f => f.endsWith(".jsonl") && f.includes("_raw_"));
  for (const rawFile of rawFiles) {
    // Extract platform from filename: "naver_raw_2026-..." -> "naver"
    const m = rawFile.match(/^(\w+)_raw_/);
    if (!m) continue;
    const platform = m[1];

    // Extract suffix after platform_raw_ to match with normalized file.
    // e.g. "naver_raw_2026-02-15-target-run_노원구.jsonl"
    //   -> suffix = "2026-02-15-target-run_노원구"
    const rawBaseName = rawFile.replace(/\.jsonl$/, "");
    const rawSuffix = rawBaseName.replace(/^\w+_raw_/, "");

    // Find matching normalized file by exact suffix match
    let normalizedFile = files.find(f =>
      f === `${platform}_normalized_${rawSuffix}.json`
    );
    // Fallback: if only one normalized file for this platform, use it
    if (!normalizedFile) {
      const candidates = files.filter(f =>
        f.startsWith(`${platform}_normalized_`) && f.endsWith(".json")
      );
      if (candidates.length === 1) normalizedFile = candidates[0];
    }
    if (normalizedFile) {
      pairs.push({
        platform,
        rawPath: path.join(runDir, rawFile),
        normalizedPath: path.join(runDir, normalizedFile),
      });
    }
  }

  return pairs;
}

// Also look for top-level raw samples + adapter outputs
function discoverTopLevelPairs(scriptsDir, platformFilter) {
  const pairs = [];
  const platforms = ["dabang", "zigbang", "peterpanz", "daangn", "naver"];
  for (const platform of platforms) {
    if (platformFilter && platform !== platformFilter) continue;

    const rawPath = path.join(scriptsDir, `${platform}_raw_samples.jsonl`);
    const normalizedPath = path.join(scriptsDir, `${platform}_adapter_output.json`);

    // Also try target variants
    const targetRawPath = path.join(scriptsDir, `${platform}_target_raw.jsonl`);
    const targetNormalizedPath = path.join(scriptsDir, `${platform}_target_adapter_output.json`);

    if (fs.existsSync(rawPath) && fs.existsSync(normalizedPath)) {
      pairs.push({ platform, rawPath, normalizedPath });
    }
    if (fs.existsSync(targetRawPath) && fs.existsSync(targetNormalizedPath)) {
      pairs.push({ platform: platform + " (target)", rawPath: targetRawPath, normalizedPath: targetNormalizedPath, platformCode: platform });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function pct(n, total) {
  if (total === 0) return "0%";
  return (n / total * 100).toFixed(0) + "%";
}

function printConsoleReport(results) {
  console.log("\n=== 매물 데이터 검증 리포트 ===\n");

  for (const r of results) {
    console.log(`[${r.platform}] 총 ${r.totalNormalized}건 검증 (raw ${r.totalRaw}건, matched ${r.matched}건, unmatched ${r.unmatched}건)`);

    for (const { field } of COMPARE_FIELDS) {
      const s = r.fieldStats[field];
      if (s.total === 0) continue;

      const parts = [];
      if (s.ok > 0)       parts.push(`OK ${pct(s.ok, s.total)}`);
      if (s.mismatch > 0) parts.push(`MISMATCH ${s.mismatch}/${s.total} (${pct(s.mismatch, s.total)})`);
      if (s.missing > 0)  parts.push(`MISSING ${s.missing}/${s.total} (${pct(s.missing, s.total)})`);
      if (s.anomaly > 0)  parts.push(`ANOMALY ${s.anomaly}/${s.total} (${pct(s.anomaly, s.total)})`);

      const status = (s.mismatch === 0 && s.missing === 0 && s.anomaly === 0) ? "  OK" : "  !!";
      const padLabel = s.label.padEnd(8);
      console.log(`${status}  ${padLabel}: ${parts.join(", ")}`);

      // Show first 3 details for non-OK
      const nonOk = s.details.slice(0, 3);
      for (const d of nonOk) {
        console.log(`        ${d.type} ref=${d.ref} raw=${JSON.stringify(d.rawVal)} norm=${JSON.stringify(d.normVal)}${d.msg ? " (" + d.msg + ")" : ""}`);
      }
      if (s.details.length > 3) {
        console.log(`        ... and ${s.details.length - 3} more`);
      }
    }
    console.log();
  }

  // Cross-platform field summary
  console.log("필드별 요약 (전체 플랫폼):");
  for (const { field, label } of COMPARE_FIELDS) {
    let totalOk = 0, totalMismatch = 0, totalMissing = 0, totalAnomaly = 0, totalAll = 0;
    for (const r of results) {
      const s = r.fieldStats[field];
      totalOk += s.ok;
      totalMismatch += s.mismatch;
      totalMissing += s.missing;
      totalAnomaly += s.anomaly;
      totalAll += s.total;
    }
    if (totalAll === 0) continue;
    const parts = [];
    parts.push(`OK ${pct(totalOk, totalAll)}`);
    if (totalMismatch > 0) parts.push(`MISMATCH ${pct(totalMismatch, totalAll)}`);
    if (totalMissing > 0) parts.push(`MISSING ${pct(totalMissing, totalAll)}`);
    if (totalAnomaly > 0) parts.push(`ANOMALY ${pct(totalAnomaly, totalAll)}`);
    console.log(`  ${label.padEnd(10)}: ${parts.join(", ")}`);
  }
  console.log();
}

function buildJsonReport(results) {
  const report = {
    generatedAt: new Date().toISOString(),
    platforms: {},
    fieldSummary: {},
  };

  for (const r of results) {
    const platformReport = {
      totalNormalized: r.totalNormalized,
      totalRaw: r.totalRaw,
      matched: r.matched,
      unmatched: r.unmatched,
      fields: {},
    };
    for (const { field } of COMPARE_FIELDS) {
      const s = r.fieldStats[field];
      platformReport.fields[field] = {
        label: s.label,
        total: s.total,
        ok: s.ok,
        mismatch: s.mismatch,
        missing: s.missing,
        anomaly: s.anomaly,
        okRate: s.total > 0 ? +(s.ok / s.total).toFixed(4) : null,
        details: s.details.slice(0, 20), // cap details in JSON
      };
    }
    report.platforms[r.platform] = platformReport;
  }

  // Cross-platform summary
  for (const { field, label } of COMPARE_FIELDS) {
    let totalOk = 0, totalMismatch = 0, totalMissing = 0, totalAnomaly = 0, totalAll = 0;
    for (const r of results) {
      const s = r.fieldStats[field];
      totalOk += s.ok;
      totalMismatch += s.mismatch;
      totalMissing += s.missing;
      totalAnomaly += s.anomaly;
      totalAll += s.total;
    }
    report.fieldSummary[field] = {
      label,
      total: totalAll,
      ok: totalOk,
      mismatch: totalMismatch,
      missing: totalMissing,
      anomaly: totalAnomaly,
      okRate: totalAll > 0 ? +(totalOk / totalAll).toFixed(4) : null,
    };
  }

  return report;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  let pairs = [];

  if (args.run) {
    const runDir = path.resolve(args.run);
    if (!fs.existsSync(runDir)) {
      console.error(`Run directory not found: ${runDir}`);
      process.exit(1);
    }
    pairs = discoverRunPairs(runDir);
    if (args.platform) {
      pairs = pairs.filter(p => (p.platformCode || p.platform) === args.platform);
    }
    if (pairs.length === 0) {
      console.log(`No raw+normalized pairs found in ${runDir}. Trying top-level scripts/ fallback...`);
      const scriptsDir = path.resolve(path.dirname(runDir), "..");
      if (fs.existsSync(path.join(scriptsDir, "adapters"))) {
        pairs = discoverTopLevelPairs(scriptsDir, args.platform || null);
      }
    }
  } else if (args.raw && args.normalized && args.platform) {
    const rawPath = path.resolve(args.raw);
    const normalizedPath = path.resolve(args.normalized);
    if (!fs.existsSync(rawPath)) {
      console.error(`Raw file not found: ${rawPath}`);
      process.exit(1);
    }
    if (!fs.existsSync(normalizedPath)) {
      console.error(`Normalized file not found: ${normalizedPath}`);
      process.exit(1);
    }
    pairs = [{ platform: args.platform, rawPath, normalizedPath }];
  } else {
    // Default: try to find pairs in scripts/
    const scriptsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
    pairs = discoverTopLevelPairs(scriptsDir, args.platform || null);
    if (pairs.length === 0) {
      console.error("No data pairs found. Use --run <dir> or --raw/--normalized/--platform.");
      process.exit(1);
    }
  }

  console.log(`Found ${pairs.length} data pair(s) to verify.`);

  const results = [];
  for (const pair of pairs) {
    const platformCode = pair.platformCode || pair.platform;
    if (!EXTRACTORS[platformCode]) {
      console.log(`  Skipping unsupported platform: ${pair.platform}`);
      continue;
    }

    console.log(`  Verifying ${pair.platform}: ${path.basename(pair.rawPath)} vs ${path.basename(pair.normalizedPath)}`);
    try {
      const rawRecords = loadJsonlRawRecords(pair.rawPath);
      const normalizedItems = loadNormalizedItems(pair.normalizedPath);
      const result = verifyPlatform(platformCode, rawRecords, normalizedItems);
      if (result) {
        result.platform = pair.platform; // use display name
        results.push(result);
      }
    } catch (err) {
      console.error(`  Error processing ${pair.platform}: ${err.message}`);
    }
  }

  if (results.length === 0) {
    console.log("No results to report.");
    process.exit(0);
  }

  // Console report
  printConsoleReport(results);

  // JSON report
  const jsonReport = buildJsonReport(results);
  const reportPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "verify_listing_data_report.json"
  );
  fs.writeFileSync(reportPath, JSON.stringify(jsonReport, null, 2), "utf-8");
  console.log(`JSON report saved to: ${reportPath}`);
}

main();
