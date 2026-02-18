#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";

import {
  ensureFnv11,
  normalizeAreaClaimed,
  normalizeLeaseType,
  normalizePlatform,
  platformNameFromCode,
  toBool,
  toInt,
  toNumber,
  toText,
  withDbClient,
} from "./db_client.mjs";

const DAANGN_MIN_AREA_M2 = (() => {
  const rawMinArea = process.env.DAANGN_MIN_AREA_M2 ?? process.env.MIN_AREA_M2;
  const parsed = rawMinArea === undefined ? NaN : Number.parseFloat(String(rawMinArea));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 40;
})();

const IMAGE_EXT_RE = /(\.jpg|\.jpeg|\.png|\.webp|\.gif|\.avif|\.bmp|\.svg)(\?|$)/i;
const IMAGE_QUERY_HINT_RE = /(?:[?&])(?:w|width|h|height|s|size|q|fit|format|quality|type)=/i;
const IMAGE_PATH_BLACKLIST_RE = /(?:^|\/)(?:assets\/(?:users|profile)|local-profile|origin\/profile|member\/|users?\/|profiles?\/|avatars?\/|default[-_ ]?(?:profile|avatar|image)|user[-_ ]?(?:profile|image)|no[-_]?image|placeholder|blank|dummy)(?:$|[./?\/])/i;
const IMAGE_HINT_PATH_RE = /(?:^|\/)(?:image|img|photo|upload|media|cdn|files?)\/?/i;

function isLikelyImageSource(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const protocol = parsed.protocol || "";
    if (!/^https?:$/i.test(protocol)) return false;
    const path = (parsed.pathname || "").toLowerCase();
    const queryHint = `${parsed.search}${parsed.hash || ""}`.toLowerCase();
    if (!path && !queryHint) return false;
    if (IMAGE_PATH_BLACKLIST_RE.test(path)) return false;
    if (IMAGE_EXT_RE.test(path)) return true;
    if (IMAGE_QUERY_HINT_RE.test(queryHint)) return true;
    if (IMAGE_HINT_PATH_RE.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}

function normalizeCandidateImageUrl(value, seen, out) {
  if (!value || typeof value !== "string") return;
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return;
  if (trimmed.length > 4096) return;
  if (/^\/\//.test(trimmed)) {
    return normalizeCandidateImageUrl(`https:${trimmed}`, seen, out);
  }
  if (/^\w[\w.-]*\.[a-z0-9.-]+\//i.test(trimmed) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return normalizeCandidateImageUrl(`https://${trimmed}`, seen, out);
  }

  const normalized = trimmed
    .replace(/&amp;/g, "&")
    .replace(/\u0026/g, "&")
    .trim();

  if (!normalized) return;

  if (!/^https?:\/\//i.test(normalized)) return;
  if (!isLikelyImageSource(normalized)) return;
  if (seen.has(normalized)) return;
  seen.add(normalized);
  out.push(normalized);
}

function collectImageValues(value, seen, out, depth = 4) {
  if (!value || depth <= 0 || out.length >= 24) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageValues(item, seen, out, depth - 1);
      if (out.length >= 24) return;
    }
    return;
  }
  if (typeof value === "string") {
    const asText = toText(value, "");
    if (!asText) return;
    if ((asText.startsWith("[") && asText.endsWith("]")) || (asText.startsWith("{") && asText.endsWith("}"))) {
      try {
        collectImageValues(JSON.parse(asText), seen, out, depth - 1);
        return;
      } catch {
        // ignore non-JSON strings
      }
    }
    const chunks = asText.split(/[\s,]+/g);
    for (const chunk of chunks) {
      normalizeCandidateImageUrl(chunk, seen, out);
      if (out.length >= 24) return;
    }
    return;
  }
  if (typeof value !== "object") return;

  const keys = Object.keys(value);
  for (const key of keys) {
    const candidate = value[key];
    const keyText = String(key || "").toLowerCase();
    if (!candidate) continue;
    if (
      /(url|uri|src|image|photo|thumb|thumbnail|media|path|link|href)/.test(keyText)
      || keyText === "images"
      || keyText === "image_urls"
      || keyText === "imageUrl"
      || keyText === "img"
      || keyText === "media"
    ) {
      collectImageValues(candidate, seen, out, depth - 1);
    }
  }
}

function readJsonSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeDate(value, fallback = new Date().toISOString()) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

function normalizeDaangnReference(value) {
  const raw = toText(value, "");
  if (!raw) return null;
  const path = raw.split("?")[0].split("#")[0];
  if (!path) return null;
  const segment = path.split("/").filter(Boolean).pop();
  if (!segment) return null;

  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();

  const candidates = [segment, decoded];
  for (const candidate of candidates) {
    if (isLikelyDaangnReference(candidate)) return candidate;
    const matched = /([0-9A-Za-z]+)$/.exec(candidate);
    if (matched?.[1] && isLikelyDaangnReference(matched[1])) return matched[1];
    const dashed = candidate.split("-").filter(Boolean).pop();
    if (dashed && isLikelyDaangnReference(dashed)) return dashed;
  }

  return isLikelyDaangnReference(segment) ? segment : null;
}

function isLikelyDaangnReference(value) {
  if (!value) return false;
  if (!/^[0-9A-Za-z._-]+$/.test(value)) return false;
  if (value.length < 5) return false;
  const lowered = String(value).toLowerCase();
  if (["realty", "listing", "listingdetail", "profile"].includes(lowered)) return false;
  if (!/[A-Za-z]/.test(value)) return value.length >= 7;
  return true;
}

function normalizePlatformSourceRef(platform, value) {
  const platformCode = normalizePlatform(platform);
  if (platformCode === "daangn") {
    return normalizeDaangnReference(value);
  }
  return toText(value, null);
}

function normalizePlatformSourceUrl(platform, value) {
  const platformCode = normalizePlatform(platform);
  const rawUrl = toText(value, "");
  if (!rawUrl) return "";

  if (platformCode === "daangn") {
    try {
      const parsed = new URL(rawUrl);
      const path = parsed.pathname.replace(/\/+$/, "");
      if (/daangn\.com/i.test(parsed.hostname) && path) {
        return `https://www.daangn.com${path}`;
      }
    } catch {
      return rawUrl;
    }
  }

  return rawUrl;
}

function normalizeImageList(item) {
  const out = [];
  const seen = new Set();
  const candidates = [
    item?.image_urls,
    item?.imageUrls,
    item?.image_url,
    item?.imageUrl,
    item?.image,
    item?.img,
    item?.images,
    item?.photo,
    item?.photoList,
    item?.photos,
    item?.media,
    item?._raw,
    item?.payload_json,
    item?.list_data,
    item?.thumbnail,
    item?.thumb,
    item?.image_list,
    item?.imageList,
    item?.photo_list,
  ];

  for (const candidate of candidates) {
    collectImageValues(candidate, seen, out, 5);
    if (out.length >= 24) break;
  }

  if (!out.length && item) {
    collectImageValues(item, seen, out, 4);
  }

  return out;
}

function toCandidateText(value) {
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const parsed = toCandidateText(candidate);
      if (parsed) return parsed;
    }
    return "";
  }
  return toText(value, "");
}

function findIdFromObject(candidate, objectValue, maxDepth = 4) {
  if (!objectValue || maxDepth <= 0) return "";

  const direct = toCandidateText(objectValue[candidate]);
  if (direct) return direct;

  if (Array.isArray(objectValue)) {
    for (const item of objectValue) {
      const found = findIdFromObject(candidate, item, maxDepth - 1);
      if (found) return found;
    }
    return "";
  }

  if (typeof objectValue !== "object") {
    return "";
  }

  for (const value of Object.values(objectValue)) {
    const found = findIdFromObject(candidate, value, maxDepth - 1);
    if (found) return found;
  }

  return "";
}

function extractExternalIdCandidates(raw) {
  const candidates = [
    "id",
    "listing_id",
    "external_id",
    "externalId",
    "item_id",
    "itemId",
    "source_ref",
    "sourceRef",
    "uuid",
    "_id",
    "identifier",
    "path",
    "slug",
    "sourceUrl",
    "url",
    "href",
    "code",
    "request_url",
    "requestUrl",
    "link",
    "articleNo",
    "article_no",
    "atclNo",
    "itemNo",
    "매물일련번호",
  ];

  const sources = [
    raw,
    raw?.payload_json,
    raw?.list_data,
    raw?.payload_json?.list_data,
    raw?.payload_json?.result,
    raw?.payload_json?.result,
    raw?.payload_json?.body,
    raw?.payload_json?.items,
    raw?.payload_json?.result?.items,
    raw?._raw,
  ];
  const collected = new Set();

  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const candidate of candidates) {
      const found = findIdFromObject(candidate, source);
      if (found) collected.add(found);
    }
  }

  return Array.from(collected);
}

function selectBestDaangnExternalId(candidates = []) {
  const isLikelyDaangnListItem = (candidate) => {
    const normalized = normalizePlatformSourceRef("daangn", candidate);
    if (!normalized) return null;
    if (/^(\d+)$/.test(normalized) && normalized.length <= 6) return null;
    return normalized;
  };

  let bestWithLetters = null;
  let bestFallback = null;

  for (const candidate of candidates) {
    const normalized = isLikelyDaangnListItem(candidate);
    if (!normalized) continue;

    if (!bestFallback) {
      bestFallback = normalized;
    }
    if (/[A-Za-z]/.test(normalized)) {
      bestWithLetters = normalized;
      break;
    }
  }

  return bestWithLetters || bestFallback;
}

async function cleanupNormalizedRowsForSourceRef(client, platform, sourceRef) {
  const platformCode = normalizePlatform(platform);
  const normalizedSourceRef = normalizePlatformSourceRef(platformCode, toText(sourceRef, ""));
  if (!platformCode || !normalizedSourceRef) return;

  const lookup = await client.query(
    `
      SELECT listing_id
      FROM normalized_listings
      WHERE platform_code = $1
        AND source_ref = $2
    `,
    [platformCode, normalizedSourceRef],
  );

  const listingIds = lookup.rows
    .map((row) => toInt(row?.listing_id, null))
    .filter((id) => id !== null);
  await cleanupNormalizedRowsByListingIds(client, listingIds);
}

function toSafeSourceUrl(raw) {
  return toText(
    raw?.source_url
      || raw?.request_url
      || raw?.url
      || raw?.sourceUrl
      || raw?.payload_json?.source_url
      || raw?.payload_json?.sourceUrl
      || raw?.payload_json?.url
      || raw?.payload_json?.request_url
      || raw?.list_data?.source_url
      || raw?.list_data?.url
      || raw?.link
      || raw?.home_url,
    "",
  );
}

function extractExternalId(raw, platformCode) {
  const platform = normalizePlatform(platformCode);
  if (platform === "daangn") {
    const selected = selectBestDaangnExternalId(extractExternalIdCandidates(raw));
    if (selected) return selected;
  } else {
    for (const candidate of extractExternalIdCandidates(raw)) {
      const normalized = normalizePlatformSourceRef(platform, candidate);
      if (normalized) return normalized;
    }
  }
  const fallbackSeed = (() => {
    if (platform === "daangn") {
      return toText(
        raw?.source_ref
          || raw?.sourceRef
          || raw?.source_url
          || raw?.sourceUrl
          || raw?.payload_json?.source_ref
          || raw?.payload_json?.sourceRef
          || raw?.payload_json?.source_url
          || raw?.payload_json?.url
          || raw?.payload_json?.request_url
          || raw?.list_data?.source_ref
          || raw?.list_data?.sourceRef
          || raw?.list_data?.source_url
          || raw?.url
          || raw?.link
          || raw?.home_url
          || "",
        "",
      );
    }
    return toText(raw?.request_url || raw?.source_ref || raw?.sourceRef || toSafeSourceUrl(raw), "");
  })();
  if (!fallbackSeed) return null;
  const normalizedFallback = normalizePlatformSourceRef(platform, fallbackSeed);
  if (!normalizedFallback) return null;
  return platform === "daangn" ? normalizedFallback : ensureFnv11(normalizedFallback) || null;
}

function extractRawStatus(raw) {
  const rawStatus = toText(raw?.parse_status || raw?.parseStatus || raw?.status || "", "").toLowerCase();
  if (["ok", "success", "fetched", "done", "normal", "parsed"].includes(rawStatus)) return "FETCHED";
  if (["failed", "fail", "error", "invalid", "parse_failed"].includes(rawStatus)) return "PARSE_FAILED";
  return "FETCHED";
}

function extractParsedAt(raw) {
  const parsed = Date.parse(raw?.parsed_at || raw?.parsedAt || raw?.collectedAt || raw?.created_at);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function extractCollectedAt(raw) {
  const ts = Date.parse(raw?.collected_at || raw?.collectedAt || raw?.timestamp || raw?.created_at);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString();
}

function buildCanonicalKey(platformCode, sourceRef, sourceUrl, addressCode, rentAmount, depositAmount, areaExclusive) {
  const seed = `${platformCode}|${sourceRef || ""}|${sourceUrl || ""}|${addressCode || ""}|${toText(rentAmount, "")}|${toText(depositAmount, "")}|${toText(areaExclusive, "")}`;
  return ensureFnv11(seed) || ensureFnv11(`${platformCode}|${sourceRef || sourceUrl || addressCode || "listing"}`) || "11000000000";
}

async function cleanupNormalizedRowsByListingIds(client, listingIds) {
  const normalized = listingIds
    .map((id) => toInt(id, null))
    .filter((id) => id !== null);
  if (!normalized.length) return;

  await client.query(
    `DELETE FROM image_fetch_jobs
     WHERE listing_id = ANY($1::bigint[])`,
    [normalized],
  );
  await client.query(
    `DELETE FROM contract_violations
     WHERE listing_id = ANY($1::bigint[])`,
    [normalized],
  );
  await client.query(
    `DELETE FROM quality_reports
     WHERE listing_id = ANY($1::bigint[])`,
    [normalized],
  );
  await client.query(
    `DELETE FROM match_group_members
     WHERE listing_id = ANY($1::bigint[])`,
    [normalized],
  );
  await client.query(
    `DELETE FROM listing_matches
     WHERE source_listing_id = ANY($1::bigint[])
        OR target_listing_id = ANY($1::bigint[])`,
    [normalized],
  );
  await client.query(
    `DELETE FROM listing_images
     WHERE listing_id = ANY($1::bigint[])`,
    [normalized],
  );
  await client.query(
    `DELETE FROM normalized_listings
     WHERE listing_id = ANY($1::bigint[])`,
    [normalized],
  );
}

async function cleanupNormalizedRowsForRawId(client, platform, rawId) {
  const platformCode = normalizePlatform(platform);
  if (!platformCode || rawId === null || rawId === undefined) return;

  const lookup = await client.query(
    `
      SELECT listing_id
      FROM normalized_listings
      WHERE platform_code = $1
        AND raw_id = $2
    `,
    [platformCode, rawId],
  );

  const listingIds = lookup.rows
    .map((row) => toInt(row?.listing_id, null))
    .filter((id) => id !== null);
  await cleanupNormalizedRowsByListingIds(client, listingIds);
}

async function cleanupNormalizedRowsForSourceUrl(client, platform, sourceUrl) {
  const platformCode = normalizePlatform(platform);
  const normalizedSourceUrl = normalizePlatformSourceUrl(platformCode, toText(sourceUrl, ""));
  if (!platformCode || !normalizedSourceUrl) return;

  const sourceUrls = new Set([normalizedSourceUrl]);
  const withoutSlash = normalizedSourceUrl.replace(/\/+$/, "");
  const withSlash = `${withoutSlash}/`;
  if (withoutSlash) sourceUrls.add(withoutSlash);
  if (withSlash) sourceUrls.add(withSlash);

  try {
    const decoded = decodeURIComponent(normalizedSourceUrl);
    if (decoded) sourceUrls.add(decoded);
    const decodedWithoutSlash = decoded.replace(/\/+$/, "");
    const decodedWithSlash = `${decodedWithoutSlash}/`;
    if (decodedWithoutSlash) sourceUrls.add(decodedWithoutSlash);
    if (decodedWithSlash) sourceUrls.add(decodedWithSlash);
  } catch {
    // ignore
  }

  const candidates = Array.from(sourceUrls).filter(Boolean);
  if (!candidates.length) return;

  const lookup = await client.query(
    `
      SELECT listing_id
      FROM normalized_listings
      WHERE platform_code = $1
        AND source_url = ANY($2::text[])
    `,
    [platformCode, candidates],
  );

  const listingIds = lookup.rows
    .map((row) => toInt(row?.listing_id, null))
    .filter((id) => id !== null);
  await cleanupNormalizedRowsByListingIds(client, listingIds);
}

function normalizeFloorForDb(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (/(반지하|반층|반지층|반)/.test(normalized)) return -1;
    const basement = /지하\s*(\d+)?\s*층?/.exec(normalized);
    if (basement) return -Math.max(1, Number(basement[1] || 1));

    const pair = /^(\-?\d+(?:[.,]\d+)?)\s*\/\s*(\-?\d+(?:[.,]\d+)?)/.exec(normalized);
    const normalizedFloor = pair ? pair[1] : normalized;
    const n = Number.parseFloat(normalizedFloor.replace(/,/g, ""));
    const floor = Number.isFinite(n) ? n : null;
    if (floor === null) return null;
    return normalizeDaangnFloorForDb(floor);
  }

  const floor = toNumber(value, null);
  if (floor === null) return null;
  return normalizeDaangnFloorForDb(floor);
}

function normalizeDaangnFloorForDb(floor) {
  if (floor === 0.5 || floor === -0.5) return -1;
  if (floor > 0 && !Number.isInteger(floor)) return Math.trunc(floor);
  if (floor < 0 && !Number.isInteger(floor)) return -Math.trunc(Math.abs(floor));
  return toInt(floor, null);
}

function inferQuality(item) {
  const hasAddress = toText(item?.address_text || item?.addressText || item?.address || "").length > 0;
  const hasImage = normalizeImageList(item).length > 0;
  const rent = item?.rent_amount ?? item?.rentAmount ?? item?.rent ?? null;
  const deposit = item?.deposit_amount ?? item?.depositAmount ?? item?.deposit ?? null;
  const hasPrice = rent != null || deposit != null;
  const area = item?.area_exclusive_m2
    ?? item?.areaExclusiveM2
    ?? item?.area_gross_m2
    ?? item?.areaGrossM2
    ?? null;
  const hasArea = area != null;
  return {
    required: Number(hasAddress && hasPrice && hasArea),
    address: Number(hasAddress),
    image: Number(hasImage),
    area: Number(hasArea),
    price: Number(hasPrice),
  };
}

async function readJsonlAsync(filePath, onLine) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, "utf8");
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const tasks = [];
    reader.on("line", (line) => {
      const text = String(line || "").trim();
      if (!text) return;
      try {
        const parsed = JSON.parse(text);
        tasks.push(onLine(parsed));
      } catch {}
    });
    reader.on("close", async () => {
      try {
        await Promise.all(tasks);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    reader.on("error", reject);
    stream.on("error", reject);
  });
}

function normalizeListingPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.merged_items)) return payload.merged_items;
  if (Array.isArray(payload.samples)) return payload.samples;
  return [];
}

async function extractNormalizedItems(candidatePath) {
  if (!candidatePath || !fs.existsSync(candidatePath)) return [];
  const lower = candidatePath.toLowerCase();
  if (lower.endsWith(".jsonl")) {
    const items = [];
    await readJsonlAsync(candidatePath, async (row) => {
      if (row) items.push(row);
    });
    return items;
  }
  const payload = readJsonSafe(candidatePath);
  return normalizeListingPayload(payload);
}

async function upsertPlatformCode(client, platformCode) {
  const code = normalizePlatform(platformCode);
  if (!code) return;
  const platformName = platformNameFromCode(code);
  const homeUrl = {
    naver: "https://new.land.naver.com",
    zigbang: "https://www.zigbang.com",
    dabang: "https://www.dabangapp.com",
    r114: "https://www.r114.com",
    peterpanz: "https://www.peterpanz.com",
    daangn: "https://www.daangn.com",
    kbland: "https://www.kb.land",
  }[code] || null;

  await client.query(
    `
      INSERT INTO platform_codes (platform_code, platform_name, collection_mode, home_url)
      VALUES ($1, $2, 'STEALTH_AUTOMATION', $3)
      ON CONFLICT (platform_code) DO UPDATE
      SET platform_name = EXCLUDED.platform_name,
          collection_mode = 'STEALTH_AUTOMATION',
          home_url = COALESCE(EXCLUDED.home_url, platform_codes.home_url),
          updated_at = NOW()
    `,
    [code, platformName, homeUrl],
  );
}

function resolveBaseRunId(runId, platform) {
  return `${runId}::${platform}`;
}

async function upsertCollectionRun(client, args) {
  const {
    runId,
    platformCode,
    status,
    startedAt,
    finishedAt,
    queryCity,
    queryDistrict,
    queryDong,
    targetMinRent,
    targetMaxRent,
    targetMinArea,
    extra,
    failureCode,
  } = args;

  await client.query(
    `
      INSERT INTO collection_runs (
        run_id,
        platform_code,
        mode,
        status,
        started_at,
        finished_at,
        query_city,
        query_district,
        query_dong,
        target_min_rent,
        target_max_rent,
        target_min_area,
        extra,
        failure_code
      ) VALUES ($1, $2, 'STEALTH_AUTOMATION', $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
      ON CONFLICT (run_id) DO UPDATE
      SET platform_code = EXCLUDED.platform_code,
          mode = EXCLUDED.mode,
          status = EXCLUDED.status,
          finished_at = EXCLUDED.finished_at,
          query_city = EXCLUDED.query_city,
          query_district = EXCLUDED.query_district,
          query_dong = EXCLUDED.query_dong,
          target_min_rent = EXCLUDED.target_min_rent,
          target_max_rent = EXCLUDED.target_max_rent,
          target_min_area = EXCLUDED.target_min_area,
          extra = EXCLUDED.extra,
          failure_code = EXCLUDED.failure_code,
          created_at = NOW(),
          -- keep history; preserve latest status
          updated_at = NOW()
    `,
    [
      runId,
      normalizePlatform(platformCode),
      status,
      safeDate(startedAt),
      safeDate(finishedAt, null),
      toText(queryCity, null),
      toText(queryDistrict, null),
      toText(queryDong, null),
      toInt(targetMinRent, null),
      toInt(targetMaxRent, null),
      toNumber(targetMinArea, null),
      JSON.stringify(extra || {}),
      toText(failureCode, null),
    ],
  );
}

function normalizeRawPayload(raw) {
  return raw?.payload_json ? raw.payload_json : raw;
}

async function upsertRawListing(client, rawLine, platformCode, runId) {
  const platform = normalizePlatform(platformCode);
  const sourceUrl = normalizePlatformSourceUrl(platform, toSafeSourceUrl(rawLine));
  const externalId = extractExternalId(rawLine, platform);
  if (!platform || !externalId || !sourceUrl) return null;

  const rawPayload = JSON.stringify(normalizeRawPayload(rawLine || {}));
  const hashHex = crypto.createHash("sha1").update(rawPayload).digest("hex");
  const fingerprint = toText(rawLine?.fingerprint || rawLine?.idempotency_key || rawLine?.request_id, null);
  const parsedAt = extractParsedAt(rawLine);
  const result = await client.query(
    `
      INSERT INTO raw_listings (
        platform_code,
        external_id,
        source_url,
        payload_json,
        page_snapshot,
        collected_at,
        parsed_at,
        run_id,
        raw_status,
        raw_area_unit,
        raw_price_unit,
        parse_error_code,
        raw_fingerprint,
        raw_hash
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (platform_code, external_id) DO UPDATE
      SET source_url = EXCLUDED.source_url,
          payload_json = EXCLUDED.payload_json,
          page_snapshot = COALESCE(EXCLUDED.page_snapshot, raw_listings.page_snapshot),
          collected_at = EXCLUDED.collected_at,
          parsed_at = COALESCE(EXCLUDED.parsed_at, raw_listings.parsed_at),
          run_id = EXCLUDED.run_id,
          raw_status = EXCLUDED.raw_status,
          raw_area_unit = EXCLUDED.raw_area_unit,
          raw_price_unit = EXCLUDED.raw_price_unit,
          parse_error_code = EXCLUDED.parse_error_code,
          raw_fingerprint = EXCLUDED.raw_fingerprint,
          raw_hash = EXCLUDED.raw_hash,
          updated_at = NOW()
      RETURNING raw_id
    `,
    [
      platform,
      externalId,
      sourceUrl,
      rawPayload,
      toText(rawLine?.page_snapshot || rawLine?.pageSnapshot || rawLine?.source_html, null),
      extractCollectedAt(rawLine),
      parsedAt,
      toText(runId, null),
      extractRawStatus(rawLine),
      toText(rawLine?.area_unit || rawLine?.areaUnit || rawLine?.area_unit_name, null),
      toText(rawLine?.price_unit || rawLine?.priceUnit || rawLine?.price_unit_name, null),
      toText(rawLine?.parse_error || rawLine?.parseError || rawLine?.error_code || rawLine?.errorCode, null),
      fingerprint,
      Buffer.from(hashHex, "hex"),
    ],
  );

  return toInt(result.rows?.[0]?.raw_id, null);
}

async function resolveRawIdByExternal(client, platformCode, externalId) {
  if (!externalId) return null;
  const result = await client.query(
    `SELECT raw_id FROM raw_listings WHERE platform_code = $1 AND external_id = $2 LIMIT 1`,
    [normalizePlatform(platformCode), externalId],
  );
  return toInt(result.rows?.[0]?.raw_id, null);
}

async function resolveRawIdBySourceUrl(client, platformCode, sourceUrl) {
  if (!sourceUrl) return null;
  const platform = normalizePlatform(platformCode);
  if (!platform) return null;
  const normalizedSourceUrl = normalizePlatformSourceUrl(platform, sourceUrl);
  const candidates = new Set([
    toText(sourceUrl, ""),
    normalizedSourceUrl,
  ]);
  for (const candidate of Array.from(candidates)) {
    if (!candidate) continue;
    const withoutSlash = String(candidate).replace(/\/+$/, "");
    const withSlash = `${withoutSlash}/`;
    candidates.add(withoutSlash);
    candidates.add(withSlash);
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded) {
        candidates.add(decoded);
        const decodedWithoutSlash = decoded.replace(/\/+$/, "");
        const decodedWithSlash = `${decodedWithoutSlash}/`;
        candidates.add(decodedWithoutSlash);
        candidates.add(decodedWithSlash);
      }
    } catch {
      // ignore
    }
  }

  const result = await client.query(
    `
      SELECT raw_id FROM raw_listings
      WHERE platform_code = $1 AND source_url = ANY($2::text[])
      ORDER BY raw_id DESC
      LIMIT 1
    `,
    [platform, Array.from(candidates)],
  );
  return toInt(result.rows?.[0]?.raw_id, null);
}

async function resolveRawExternalIdByRawId(client, rawId) {
  const numericRawId = toInt(rawId, null);
  if (numericRawId === null) return null;
  const result = await client.query(
    `SELECT external_id FROM raw_listings WHERE raw_id = $1 LIMIT 1`,
    [numericRawId],
  );
  return toText(result.rows?.[0]?.external_id, null);
}

async function upsertNormalizedListing(
  client,
  item,
  platformCode,
  runId,
  rawIdByExternal,
  imageQueue,
) {
  const platform = normalizePlatform(platformCode);
  if (!platform) return null;

  let sourceRef = normalizePlatformSourceRef(
    platform,
    toText(item?.source_ref || item?.sourceRef, ""),
  );
  const sourceUrl = normalizePlatformSourceUrl(
    platform,
    toText(item?.source_url || item?.sourceUrl || item?.url || "", ""),
  );
  const fallbackSourceUrl = !sourceUrl && platform === "daangn" && sourceRef
    ? `https://www.daangn.com/kr/realty/${sourceRef}`
    : null;
  const finalSourceUrl = sourceUrl || fallbackSourceUrl;
  if (!finalSourceUrl) return null;
  let externalId = normalizePlatformSourceRef(
    platform,
    toText(item?.external_id || item?.externalId || item?.source_ref || item?.sourceRef, ""),
  );
  if (!externalId) {
    externalId = normalizePlatformSourceRef(platform, sourceRef);
  }
  if (!externalId) {
    externalId = normalizePlatformSourceRef(platform, finalSourceUrl);
  }
  if (!externalId) return null;
  if (!sourceRef) sourceRef = externalId;

  const rawExternalId = toText(
    item?.raw_external_id
      || item?.raw_id
      || item?.rawExternalId
      || item?.source_ref
      || item?.sourceRef,
    null,
  );

  const rawCandidates = new Set([
    normalizePlatformSourceRef(platform, externalId),
    normalizePlatformSourceRef(platform, sourceRef),
    normalizePlatformSourceRef(platform, rawExternalId),
    ...extractExternalIdCandidates({
      external_id: item?.external_id,
      externalId: item?.externalId,
      source_ref: item?.source_ref,
      sourceRef: item?.sourceRef,
      raw_id: item?.raw_id,
      rawExternalId: item?.rawExternalId,
      source_url: finalSourceUrl,
      source_url_candidate: item?.source_url,
      request_url: item?.request_url,
      url: item?.url,
      sourceUrl: item?.sourceUrl,
      raw_attrs: item?.raw_attrs,
      _raw: item?._raw,
    }),
  ]);

  const normalizedCandidates = new Set(
    Array.from(rawCandidates)
      .map((candidate) => normalizePlatformSourceRef(platform, candidate))
      .filter(Boolean),
  );

  let rawId = null;
  for (const candidate of normalizedCandidates) {
    if (!candidate) continue;
    const fromMap = rawIdByExternal.get(candidate);
    if (fromMap) {
      rawId = fromMap;
      break;
    }
    const fromDb = await resolveRawIdByExternal(client, platform, candidate);
    if (fromDb) {
      rawIdByExternal.set(candidate, fromDb);
      rawId = fromDb;
      break;
    }
  }

  if (!rawId) {
    const sourceUrlCandidates = new Set([finalSourceUrl]);
    const normalizedSourceUrl = normalizePlatformSourceUrl(platform, sourceUrl);
    if (normalizedSourceUrl) sourceUrlCandidates.add(normalizedSourceUrl);
    try {
      const decodedSourceUrl = decodeURIComponent(finalSourceUrl);
      if (decodedSourceUrl && decodedSourceUrl !== finalSourceUrl) {
        sourceUrlCandidates.add(decodedSourceUrl);
      }
    } catch {
      // ignore
    }

    for (const candidate of [
      item?.source_url,
      item?.sourceUrl,
      item?.url,
      item?.request_url,
      item?.identifier,
      sourceRef,
    ]) {
      if (candidate) sourceUrlCandidates.add(candidate);
    }

    if (platform === "daangn" && sourceRef) {
      const daangnDetailUrl = `https://www.daangn.com/kr/realty/${sourceRef}`;
      sourceUrlCandidates.add(daangnDetailUrl);
      sourceUrlCandidates.add(daangnDetailUrl.replace(/\/+$/, ""));
    }

    for (const candidate of Array.from(sourceUrlCandidates)) {
      if (!candidate || typeof candidate !== "string") continue;
      const noSlash = candidate.replace(/\/+$/, "");
      const withSlash = `${noSlash}/`;
      if (withSlash !== candidate) sourceUrlCandidates.add(withSlash);
      try {
        sourceUrlCandidates.add(decodeURIComponent(candidate));
      } catch {
        // ignore
      }
    }

    for (const candidate of sourceUrlCandidates) {
      const fromSourceUrl = await resolveRawIdBySourceUrl(client, platform, candidate);
      if (fromSourceUrl) {
        rawId = fromSourceUrl;
        break;
      }
    }
  }
  if (!rawId) return null;

  if (platform === "daangn") {
    const rawExternalFromDb = await resolveRawExternalIdByRawId(client, rawId);
    const normalizedRawExternal = normalizePlatformSourceRef(platform, rawExternalFromDb);
    if (normalizedRawExternal) {
      externalId = normalizedRawExternal;
      sourceRef = normalizedRawExternal;
    }
  }

  if (!sourceRef) sourceRef = externalId;
  if (platform === "daangn" && sourceRef) {
    await cleanupNormalizedRowsForSourceRef(client, platform, sourceRef);
  }

  await cleanupNormalizedRowsForRawId(client, platform, rawId);

  const rentAmount = toNumber(item?.rent_amount ?? item?.rentAmount ?? item?.rent, null);
  const depositAmount = toNumber(item?.deposit_amount ?? item?.depositAmount ?? item?.deposit, null);
  const areaExclusive = toNumber(item?.area_exclusive_m2 ?? item?.areaExclusiveM2 ?? item?.areaExclusive ?? null, null);
  const areaExclusiveMin = toNumber(item?.area_exclusive_m2_min ?? item?.areaExclusiveMin ?? null, null);
  const areaExclusiveMax = toNumber(item?.area_exclusive_m2_max ?? item?.areaExclusiveMax ?? null, null);
  const areaGross = toNumber(item?.area_gross_m2 ?? item?.areaGrossM2 ?? null, null);
  const areaGrossMin = toNumber(item?.area_gross_m2_min ?? item?.areaGrossMin ?? null, null);
  const areaGrossMax = toNumber(item?.area_gross_m2_max ?? item?.areaGrossMax ?? null, null);
  const addressText = toText(item?.address_text || item?.addressText || item?.address || "", "서울특별시");
  const addressCode = toText(item?.address_code || item?.addressCode, "") || ensureFnv11(addressText) || "11000000000";
  const leaseType = normalizeLeaseType(
    toText(
      item?.lease_type
        || item?.leaseType
        || item?.trade_type
        || item?.tradeType
        || item?.tradeTypeName,
      "월세",
    ),
  );
  const areaClaimRaw = item?.area_claimed || item?.areaClaimed || null;
  const areaClaimed = normalizeAreaClaimed(
    platform === "daangn" ? areaClaimRaw || "estimated" : areaClaimRaw || (areaExclusive ? "exclusive" : "estimated"),
  );
  const qualityFlags = Array.isArray(item?.quality_flags || item?.qualityFlags)
    ? item?.quality_flags || item?.qualityFlags
    : [];
  const qualityPayload = Array.isArray(qualityFlags) ? qualityFlags : [];

  if (platform === "daangn") {
    const claimedExclusive = areaClaimed === "exclusive";
    const normalizedArea = Number(areaExclusive);
    if (!Number.isFinite(normalizedArea) || normalizedArea <= 0 || normalizedArea < DAANGN_MIN_AREA_M2) {
      await cleanupNormalizedRowsForRawId(client, platform, rawId);
      return null;
    }
    if (!claimedExclusive) {
      await cleanupNormalizedRowsForRawId(client, platform, rawId);
      return null;
    }
  }

  await cleanupNormalizedRowsForSourceUrl(client, platform, finalSourceUrl);

  const canonicalKey = buildCanonicalKey(
    platform,
    sourceRef,
    finalSourceUrl,
    addressCode,
    rentAmount,
    depositAmount,
    areaExclusive,
  );

  const result = await client.query(
    `
      INSERT INTO normalized_listings (
        raw_id,
        platform_code,
        external_id,
        canonical_key,
        source_url,
        title,
        lease_type,
        rent_amount,
        deposit_amount,
        area_exclusive_m2,
        area_exclusive_m2_min,
        area_exclusive_m2_max,
        area_gross_m2,
        area_gross_m2_min,
        area_gross_m2_max,
        area_claimed,
        address_text,
        address_code,
        room_count,
        bathroom_count,
        floor,
        total_floor,
        direction,
        building_use,
        building_name,
        agent_name,
        agent_phone,
        listed_at,
        available_date,
        source_ref,
        quality_flags,
        lat,
        lng
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
      )
      ON CONFLICT (platform_code, external_id) DO UPDATE
      SET raw_id = EXCLUDED.raw_id,
          canonical_key = EXCLUDED.canonical_key,
          source_url = EXCLUDED.source_url,
          title = EXCLUDED.title,
          lease_type = EXCLUDED.lease_type,
          rent_amount = EXCLUDED.rent_amount,
          deposit_amount = EXCLUDED.deposit_amount,
          area_exclusive_m2 = EXCLUDED.area_exclusive_m2,
          area_exclusive_m2_min = EXCLUDED.area_exclusive_m2_min,
          area_exclusive_m2_max = EXCLUDED.area_exclusive_m2_max,
          area_gross_m2 = EXCLUDED.area_gross_m2,
          area_gross_m2_min = EXCLUDED.area_gross_m2_min,
          area_gross_m2_max = EXCLUDED.area_gross_m2_max,
          area_claimed = EXCLUDED.area_claimed,
          address_text = EXCLUDED.address_text,
          address_code = EXCLUDED.address_code,
        room_count = EXCLUDED.room_count,
        bathroom_count = EXCLUDED.bathroom_count,
        floor = EXCLUDED.floor,
        total_floor = EXCLUDED.total_floor,
        direction = EXCLUDED.direction,
        building_use = EXCLUDED.building_use,
        building_name = EXCLUDED.building_name,
        agent_name = EXCLUDED.agent_name,
        agent_phone = EXCLUDED.agent_phone,
        listed_at = EXCLUDED.listed_at,
          available_date = EXCLUDED.available_date,
          source_ref = EXCLUDED.source_ref,
          quality_flags = EXCLUDED.quality_flags,
          lat = COALESCE(EXCLUDED.lat, normalized_listings.lat),
          lng = COALESCE(EXCLUDED.lng, normalized_listings.lng),
          updated_at = NOW()
      RETURNING listing_id
    `,
    [
      rawId,
      platform,
      externalId,
      canonicalKey,
      finalSourceUrl,
      toText(item?.title || item?.subject || item?.name, null),
      leaseType,
      rentAmount,
      depositAmount,
      areaExclusive,
      areaExclusiveMin,
      areaExclusiveMax,
      areaGross,
      areaGrossMin,
      areaGrossMax,
      areaClaimed,
      addressText,
      addressCode,
      toInt(item?.room_count ?? item?.roomCount ?? item?.roomCnt, null),
      toInt(item?.bathroom_count ?? item?.bathroomCount ?? item?.bathroomCnt, null),
      normalizeFloorForDb(item?.floor ?? item?.floorNo ?? null),
      normalizeFloorForDb(item?.total_floor ?? item?.totalFloor ?? item?.totalFloorCount ?? null),
      toText(item?.direction || item?.Direction || null, null),
      toText(item?.building_use || item?.buildingUse || item?.buildingType || item?.houseType || null, null),
      toText(item?.building_name || item?.buildingName, null),
      toText(item?.agent_name || item?.agentName, null),
      toText(item?.agent_phone || item?.agentPhone, null),
      toText(item?.listed_at || item?.listedAt, null),
      toText(item?.available_date || item?.availableDate, null),
      sourceRef,
      JSON.stringify(qualityPayload),
      item?.lat != null && Number.isFinite(Number(item.lat)) ? Number(item.lat) : null,
      item?.lng != null && Number.isFinite(Number(item.lng)) ? Number(item.lng) : null,
    ],
  );

  const listingId = toInt(result.rows?.[0]?.listing_id, null);
  if (!listingId) return null;

  await client.query(
    `UPDATE raw_listings SET raw_status='NORMALIZED', parsed_at = NOW(), updated_at = NOW() WHERE raw_id = $1`,
    [rawId],
  ).catch(() => {});

  const imageUrls = normalizeImageList(item);
  for (let index = 0; index < imageUrls.length; index += 1) {
    const source = toText(imageUrls[index], "");
    if (!source) continue;
    imageQueue.push({
      listingId,
      rawId,
      sourceUrl: source,
      isPrimary: index === 0,
    });
  }

  rawIdByExternal.set(externalId, rawId);
  rawIdByExternal.set(sourceRef, rawId);
  if (rawExternalId) {
    rawIdByExternal.set(rawExternalId, rawId);
  }
  return listingId;
}

async function upsertImageQueue(client, imageQueue) {
  if (!Array.isArray(imageQueue) || imageQueue.length === 0) return;

  const normalizedItems = [];
  const seen = new Set();
  for (const item of imageQueue) {
    const listingId = toInt(item?.listingId, null);
    const rawId = toInt(item?.rawId, null);
    const sourceUrl = toText(item?.sourceUrl, "");
    const isPrimary = toBool(item?.isPrimary, false);
    if (!listingId || !rawId || !sourceUrl) continue;

    const key = `${listingId}|${sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedItems.push({
      listingId,
      rawId,
      sourceUrl,
      isPrimary,
    });
  }

  if (!normalizedItems.length) return;

  const upsertByListingSource = `
      INSERT INTO listing_images (
        listing_id,
        raw_id,
        source_url,
        status,
        is_primary
      ) VALUES ($1, $2, $3, 'queued', $4)
      ON CONFLICT (listing_id, source_url) DO UPDATE
      SET raw_id = EXCLUDED.raw_id,
          listing_id = EXCLUDED.listing_id,
          status = CASE
            WHEN listing_images.status IN ('downloaded') THEN 'downloaded'
            ELSE EXCLUDED.status
          END,
          is_primary = listing_images.is_primary OR EXCLUDED.is_primary
      `;

  for (const item of normalizedItems) {
    const params = [item.listingId, item.rawId, item.sourceUrl, item.isPrimary];
    try {
      await client.query(upsertByListingSource, params);
      continue;
    } catch (error) {
      if (error?.code === "42P10") {
        const upsertBySourceUrl = `
            INSERT INTO listing_images (
              listing_id,
              raw_id,
              source_url,
              status,
              is_primary
            ) VALUES ($1, $2, $3, 'queued', $4)
            ON CONFLICT (source_url) DO UPDATE
            SET raw_id = EXCLUDED.raw_id,
                listing_id = EXCLUDED.listing_id,
                status = CASE
                  WHEN listing_images.status IN ('downloaded') THEN 'downloaded'
                  ELSE EXCLUDED.status
                END,
                is_primary = listing_images.is_primary OR EXCLUDED.is_primary
            `;
        await client.query(upsertBySourceUrl, params);
        continue;
      }
      throw error;
    }
  }
}

function parseViolations(item) {
  const raw = item?.validation || item?.contract_violations || item?.violations || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => ({
    code: toText(entry?.code || entry?.violation_code || entry?.type || "REQ_FIELD_MISSING", "REQ_FIELD_MISSING"),
    message: toText(entry?.message || entry?.note || entry?.detail?.message, ""),
    detail: typeof entry === "object" && entry ? entry : { value: entry },
    severity: (() => {
      const level = toText(entry?.level || entry?.severity || entry?.severityLevel, "WARN").toUpperCase();
      return ["ERROR", "WARN"].includes(level) ? level : "WARN";
    })(),
  }));
}

async function persistContractViolations(client, platformCode, rawId, listingId, item) {
  const violations = parseViolations(item);
  if (!violations.length || !listingId) return;
  for (const violation of violations) {
    const scopeId = `${platformCode}:${listingId}:${violation.code}`;
    await client.query(
      `
      INSERT INTO contract_violations (
        scope,
        scope_id,
        platform_code,
        raw_id,
        listing_id,
        violation_code,
        message,
        detail,
        severity
      ) VALUES (
        'NORMALIZED',
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb,
        $8
      )
      `,
      [
        scopeId,
        normalizePlatform(platformCode),
        rawId || null,
        listingId,
        violation.code,
        violation.message,
        JSON.stringify(violation.detail),
        violation.severity,
      ],
    ).catch(() => {});
  }
}

function inferStatusFromResults(results) {
  if (!Array.isArray(results) || !results.length) return "PARTIAL";
  if (results.every((item) => item?.skipped)) return "PARTIAL";
  if (results.some((item) => !item?.ok)) return "FAILED";
  return "DONE";
}

function selectPlatformBuckets(summary) {
  const map = new Map();
  for (const item of Array.isArray(summary?.results) ? summary.results : []) {
    const platform = normalizePlatform(item?.platform || item?.name || "");
    if (!platform) continue;
    if (!map.has(platform)) map.set(platform, []);
    map.get(platform).push(item);
  }
  return Array.from(map.entries()).map(([platform, results]) => ({ platform, results }));
}

async function ingestPlatformResult(client, baseRunId, platform, platformRuns, rawIdByExternal, summary) {
  if (!platformRuns.length) return;
  const platformRunId = resolveBaseRunId(baseRunId, platform);
  const status = inferStatusFromResults(platformRuns);
  const first = platformRuns[0] || {};
  const startedAt = safeDate(platformRuns.find((r) => r?.startedAt)?.startedAt || first.startedAt);
  const finishedAt = safeDate(platformRuns.find((r) => r?.finishedAt)?.finishedAt || first.finishedAt);

  const queryCity = toText(first?.targetCity || first?.query_city || summary?.target?.sido || summary?.target?.sidoName || null, null);
  const queryDistrict = toText(first?.sigungu || first?.query_district || summary?.target?.sigungu || summary?.target?.gu || null, null);
  const targetMinRent = toNumber(first?.targetMinRent, null);
  const targetMaxRent = toNumber(first?.targetMaxRent, null);
  const targetMinArea = toNumber(first?.targetMinArea, null);

  await upsertCollectionRun(client, {
    runId: platformRunId,
    platformCode: platform,
    status,
    startedAt,
    finishedAt,
    queryCity,
    queryDistrict,
    targetMinRent,
    targetMaxRent,
    targetMinArea,
    extra: {
      source: "run_parallel_collect",
      base_run_id: baseRunId,
      run_options: summary?.runOptions || null,
      summary: summary?.summary || null,
      workspace: summary?.workspace || null,
      run_meta: first?.runMeta || null,
    },
    failureCode: status === "FAILED" ? "PARTIAL_FAILURE" : null,
  });

  const imageQueue = [];

  for (const result of platformRuns) {
    const rawPath = toText(result?.rawFile, null);
    if (rawPath && fs.existsSync(rawPath)) {
      await readJsonlAsync(rawPath, async (rawLine) => {
        if (!rawLine || typeof rawLine !== "object") return;
        const rawId = await upsertRawListing(client, rawLine, platform, platformRunId);
        if (!rawId) return;
        const rawCandidates = extractExternalIdCandidates(rawLine);
        for (const candidate of rawCandidates) {
          if (candidate) rawIdByExternal.set(candidate, rawId);
        }
        const externalId = extractExternalId(rawLine, platform);
        const sourceRef = toText(rawLine?.source_ref || rawLine?.sourceRef || null, null);
        if (externalId) rawIdByExternal.set(externalId, rawId);
        if (sourceRef) rawIdByExternal.set(sourceRef, rawId);
      }).catch(() => {});
    }

    const normalizedPath = toText(result?.normalizedPath, null) || toText(result?.output, null);
    if (!normalizedPath || !fs.existsSync(normalizedPath)) continue;
    const normalizedItems = await extractNormalizedItems(normalizedPath);
    for (const item of normalizedItems) {
      const listingId = await upsertNormalizedListing(
        client,
        item,
        platform,
        platformRunId,
        rawIdByExternal,
        imageQueue,
      );
      if (!listingId) continue;
      const rawExternal = toText(
        item?.raw_external_id || item?.raw_id || item?.source_ref || item?.external_id || item?.externalId,
        "",
      );
      const rawId = rawIdByExternal.get(rawExternal);
      await persistContractViolations(client, platform, rawId, listingId, item).catch(() => {});
    }
  }

  await upsertImageQueue(client, imageQueue);
}

async function runPersistSummary(client, summaryPath) {
  const summary = readJsonSafe(summaryPath);
  if (!summary) throw new Error(`summary parse failed: ${summaryPath}`);
  const runId = toText(summary.runId || summary.run_id, "");
  if (!runId) throw new Error("run_id not found in summary");

  const result = {
    runId,
    platformCount: 0,
    storedPlatforms: [],
    rawCount: 0,
    normalizedCount: 0,
    collectionRuns: [],
  };
  const platformBuckets = selectPlatformBuckets(summary);
  result.platformCount = platformBuckets.length;

  for (const bucket of platformBuckets) {
    await upsertPlatformCode(client, bucket.platform);
    const rawIdByExternal = new Map();
    await ingestPlatformResult(client, runId, bucket.platform, bucket.results, rawIdByExternal, summary);

    const collectionRunId = resolveBaseRunId(runId, bucket.platform);
    const counts = await client.query(
      `
      SELECT
        COUNT(DISTINCT r.raw_id) AS raw_count,
        COUNT(DISTINCT n.listing_id) AS normalized_count
      FROM collection_runs cr
      LEFT JOIN raw_listings r ON r.run_id = cr.run_id
      LEFT JOIN normalized_listings n ON n.raw_id = r.raw_id
      WHERE cr.run_id = $1
      `,
      [collectionRunId],
    );
    const rawCount = toInt(counts.rows?.[0]?.raw_count, 0);
    const normalizedCount = toInt(counts.rows?.[0]?.normalized_count, 0);
    result.rawCount += rawCount;
    result.normalizedCount += normalizedCount;
    result.collectionRuns.push({
      runId: collectionRunId,
      platform: bucket.platform,
      rawCount,
      normalizedCount,
    });
    result.storedPlatforms.push(bucket.platform);
  }

  return result;
}

async function resolveMatchListingMap(client, baseRunId) {
  const map = new Map();
  const rows = await client.query(
    `
    SELECT nl.listing_id, nl.platform_code, nl.external_id, nl.source_ref
    FROM normalized_listings nl
    JOIN raw_listings rl ON rl.raw_id = nl.raw_id
    WHERE COALESCE(rl.run_id, '') LIKE $1
    `,
    [`${baseRunId}::%`],
  );

  for (const row of rows.rows || []) {
    const listingId = toInt(row.listing_id, null);
    if (!listingId) continue;
    const keyPlatform = normalizePlatform(row.platform_code);
    const ext = toText(row.external_id, "");
    const src = toText(row.source_ref, "");
    map.set(listingId, listingId);
    map.set(String(listingId), listingId);
    if (ext) {
      map.set(ext, listingId);
      map.set(`${keyPlatform}:${ext}`, listingId);
    }
    if (src) {
      map.set(src, listingId);
      map.set(`${keyPlatform}:${src}`, listingId);
    }
  }
  return map;
}

function resolvePairId(value, map) {
  const key = toText(value, "");
  if (!key) return null;
  if (map.has(key)) return map.get(key);
  const withPlatformPrefix = map.has(`zigbang:${key}`) ? map.get(`zigbang:${key}`)
    : map.has(`naver:${key}`) ? map.get(`naver:${key}`)
      : map.has(`dabang:${key}`) ? map.get(`dabang:${key}`)
        : map.has(`r114:${key}`) ? map.get(`r114:${key}`)
          : map.has(`peterpanz:${key}`) ? map.get(`peterpanz:${key}`)
            : null;
  if (withPlatformPrefix) return withPlatformPrefix;
  const num = toInt(key, null);
  if (num !== null && map.has(num)) return map.get(num);
  return null;
}

async function persistMatcherResults(client, baseRunId, matchOutputPath) {
  const matchOutput = readJsonSafe(matchOutputPath);
  if (!matchOutput) return null;

  const pairs = Array.isArray(matchOutput.pairs) ? matchOutput.pairs : [];
  const groups = Array.isArray(matchOutput.match_groups) ? matchOutput.match_groups : [];
  const candidates = toInt(
    matchOutput.input_summary?.candidate_pairs
      || matchOutput.candidate_pairs
      || matchOutput.summary?.candidate_pairs,
    0,
  );
  const autoMatch = toInt(
    matchOutput.input_summary?.auto_match
      || matchOutput.auto_match
      || matchOutput.summary?.auto_match,
    0,
  );
  const reviewRequired = toInt(
    matchOutput.input_summary?.review_required
      || matchOutput.review_required
      || matchOutput.summary?.review_required,
    0,
  );
  const distinctCount = toInt(
    matchOutput.input_summary?.distinct
      || matchOutput.distinct
      || matchOutput.summary?.distinct,
    0,
  );

  const matcherRun = await client.query(
    `
      INSERT INTO matcher_runs (
        algorithm_version,
        rule_version,
        candidates,
        auto_match_count,
        review_required_count,
        distinct_count,
        threshold_json,
        started_at,
        finished_at,
        run_meta
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,$9::timestamptz,$10::jsonb
      )
      RETURNING matcher_run_id
    `,
    [
      toText(matchOutput.algorithm_version || "matcher_v1", "matcher_v1"),
      toText(matchOutput.rule_version || "v1", "v1"),
      candidates,
      autoMatch,
      reviewRequired,
      distinctCount,
      JSON.stringify(matchOutput.threshold_json || matchOutput.rules_snapshot || { autoMatch: 93, reviewRequiredMin: 80 }),
      safeDate(matchOutput.generated_at || matchOutput.started_at || new Date().toISOString()),
      safeDate(matchOutput.generated_at || matchOutput.finished_at || new Date().toISOString()),
      JSON.stringify({
        source: "build_operations_payload",
        base_run_id: baseRunId,
        payload_path: matchOutputPath,
      }),
    ],
  );

  const matcherRunId = toInt(matcherRun.rows?.[0]?.matcher_run_id, null);
  if (!matcherRunId) return null;

  const listingMap = await resolveMatchListingMap(client, baseRunId);
  const pairQuery = `
    INSERT INTO listing_matches (
      matcher_run_id,
      source_listing_id,
      target_listing_id,
      score,
      distance_score,
      address_score,
      area_score,
      price_score,
      attribute_score,
      status,
      reason_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    ON CONFLICT (matcher_run_id, source_listing_id, target_listing_id) DO NOTHING
  `;

  let storedPairs = 0;
  for (const pair of pairs) {
    const source = resolvePairId(pair.source_listing_id, listingMap);
    const target = resolvePairId(pair.target_listing_id, listingMap);
    if (!source || !target || source === target) continue;

    const normalized = toText(pair.status, "DISTINCT");
    const status = ["AUTO_MATCH", "REVIEW_REQUIRED", "DISTINCT"].includes(normalized)
      ? normalized
      : "DISTINCT";
    const orderedSource = Math.min(source, target);
    const orderedTarget = Math.max(source, target);
    await client.query(
      pairQuery,
      [
        matcherRunId,
        orderedSource,
        orderedTarget,
        toNumber(pair.score, 0),
        toNumber(pair.distance_score, 0),
        toNumber(pair.address_score, 0),
        toNumber(pair.area_score, 0),
        toNumber(pair.price_score, 0),
        toNumber(pair.attribute_score, 0),
        status,
        JSON.stringify(pair.reason_json || pair.reason || {}),
      ],
    ).then(() => {
      storedPairs += 1;
    }).catch(() => {});
  }

  let storedGroups = 0;
  for (const group of groups) {
    const groupRun = await client.query(
      `
      INSERT INTO match_groups (
        matcher_run_id,
        canonical_key,
        canonical_status,
        reason_json
      ) VALUES ($1, $2, $3, $4::jsonb)
      RETURNING group_id
      `,
      [
        matcherRunId,
        toText(group.canonical_key || group.group_id || group.id, ensureFnv11(`${matcherRunId}:${toText(group.group_id, "group")}`) || `11${String(Date.now()).slice(-9)}`),
        "OPEN",
        JSON.stringify(group),
      ],
    );
    const groupId = toInt(groupRun.rows?.[0]?.group_id, null);
    if (!groupId) continue;
    storedGroups += 1;
    const members = Array.isArray(group.members) ? group.members : [];
    for (const memberId of members) {
      const memberListing = resolvePairId(memberId, listingMap);
      if (!memberListing) continue;
      await client.query(
        `
        INSERT INTO match_group_members (group_id, listing_id, score)
        VALUES ($1, $2, $3)
        ON CONFLICT (group_id, listing_id) DO UPDATE
        SET score = GREATEST(match_group_members.score, EXCLUDED.score)
        `,
        [groupId, memberListing, toNumber(memberId?.score, 100)],
      ).catch(() => {});
    }
  }

  return {
    matcherRunId,
    totalPairs: pairs.length,
    storedPairs,
    totalGroups: groups.length,
    storedGroups,
  };
}

async function resolveSummaryOrNull(value) {
  return value || null;
}

export async function persistSummaryToDb(summaryPath, options = {}) {
  const summary = readJsonSafe(summaryPath);
  if (!summary) throw new Error(`summary parse failed: ${summaryPath}`);
  const runId = toText(options.runId || summary.runId || summary.run_id, "");
  if (!runId) throw new Error("run_id not found in summary");

  const result = {
    runId,
    platformCount: 0,
    storedPlatforms: [],
    rawCount: 0,
    normalizedCount: 0,
    collectionRuns: [],
  };

  await withDbClient(async (client) => {
    const platformBuckets = selectPlatformBuckets({ ...summary, runId });
    for (const bucket of platformBuckets) {
      await upsertPlatformCode(client, bucket.platform);
      const rawIdByExternal = new Map();
      await ingestPlatformResult(client, runId, bucket.platform, bucket.results, rawIdByExternal, {
        ...summary,
        runId,
      });

      const platformRunId = resolveBaseRunId(runId, bucket.platform);
      const countRow = await client.query(
        `
        SELECT
          COUNT(DISTINCT r.raw_id) AS raw_count,
          COUNT(DISTINCT n.listing_id) AS normalized_count
        FROM collection_runs cr
        LEFT JOIN raw_listings r ON r.run_id = cr.run_id
        LEFT JOIN normalized_listings n ON n.raw_id = r.raw_id
        WHERE cr.run_id = $1
        `,
        [platformRunId],
      );
      const rawCount = toInt(countRow.rows?.[0]?.raw_count, 0);
      const normalizedCount = toInt(countRow.rows?.[0]?.normalized_count, 0);
      result.rawCount += rawCount;
      result.normalizedCount += normalizedCount;
      result.storedPlatforms.push(bucket.platform);
      result.collectionRuns.push({ runId: platformRunId, rawCount, normalizedCount });
    }
    result.platformCount = platformBuckets.length;
  });

  return result;
}

export async function persistMatchesToDb(summaryPath, matchOutputPath, options = {}) {
  const summary = readJsonSafe(summaryPath);
  if (!summary) throw new Error(`summary parse failed: ${summaryPath}`);
  const runId = toText(options.runId || summary.runId || summary.run_id, "");
  if (!runId) throw new Error("run_id not found in summary");
  if (!matchOutputPath || !fs.existsSync(matchOutputPath)) return null;

  let matcherResult = null;
  await withDbClient(async (client) => {
    matcherResult = await persistMatcherResults(client, runId, matchOutputPath);
  });
  return matcherResult;
}

export async function persistOperationsToDb(summaryPath, options = {}) {
  const matchOutputPath = toText(options.matchOutputPath, null);
  const persistMatches = toBool(options.persistMatches, true);

  const summaryResult = await persistSummaryToDb(summaryPath, {
    runId: toText(options.runId, null),
  });

  const matcherResult = persistMatches && matchOutputPath
    ? await persistMatchesToDb(summaryPath, matchOutputPath, {
      runId: summaryResult.runId,
    })
    : null;

  return {
    summaryResult,
    matcherResult,
  };
}

export { withDbClient, resolveSummaryOrNull };
