import path from "node:path";
import { toText, toNumber, toInt } from "./db_client.mjs";

// ---------------------------------------------------------------------------
// Safe coercion helpers (used by route handlers)
// ---------------------------------------------------------------------------

export function safeText(value, fallback = null) {
  return toText(value, fallback);
}

export function safeNum(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function parseQueryNumber(value, fallback = null) {
  const text = safeText(value, null);
  if (text === null) return fallback;
  const num = Number(text);
  return Number.isFinite(num) ? num : fallback;
}

export function parseQueryInt(value, fallback = null) {
  const num = parseQueryNumber(value, fallback);
  if (num === null || num === undefined) return fallback;
  return Math.max(0, Math.trunc(num));
}

export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function toNumDate(value) {
  const v = Date.parse(value);
  return Number.isFinite(v) ? v : 0;
}

// ---------------------------------------------------------------------------
// Utility functions (exported for testing via api_server.mjs re-export)
// ---------------------------------------------------------------------------

export function platformNameFromCode(code) {
  const names = {
    naver: "\uB124\uC774\uBC84 \uBD80\uB3D9\uC0B0",
    zigbang: "\uC9C1\uBC29",
    dabang: "\uB2E4\uBC29",
    r114: "\uBD80\uB3D9\uC0B0114",
    peterpanz: "\uD53C\uD130\uD32C",
    daangn: "\uB2F9\uADFC\uBD80\uB3D9\uC0B0",
    kbland: "KB\uBD80\uB3D9\uC0B0",
  };
  return names[code] || code || "unknown";
}

export function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
  };
  return map[ext] || "application/octet-stream";
}

export function isInside(baseDir, targetPath) {
  const rel = path.relative(baseDir, targetPath);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function inferItemQuality(items) {
  const totals = {
    req: 0, reqDen: 0,
    addr: 0, addrDen: 0,
    img: 0, imgDen: 0,
    area: 0, areaDen: 0,
    price: 0, priceDen: 0,
  };

  for (const item of items) {
    const hasAddress = safeText(item.address_text || item.addressText || "", "").length > 0;
    const hasImage = Number(item.image_count || 0) > 0;
    const rent = item.rent_amount ?? item.rentAmount ?? null;
    const deposit = item.deposit_amount ?? item.depositAmount ?? null;
    const hasPrice = rent != null || deposit != null;
    const hasArea = item.area_exclusive_m2 != null || item.area_gross_m2 != null;

    totals.reqDen += 1;
    totals.addrDen += 1;
    totals.imgDen += 1;
    totals.areaDen += 1;
    totals.priceDen += 1;
    totals.req += Number(hasAddress && hasPrice && hasArea);
    totals.addr += Number(hasAddress);
    totals.img += Number(hasImage);
    totals.area += Number(hasArea);
    totals.price += Number(hasPrice);
  }

  return {
    requiredFieldsRate: totals.reqDen ? totals.req / totals.reqDen : 0,
    addressRate: totals.addrDen ? totals.addr / totals.addrDen : 0,
    imageRate: totals.imgDen ? totals.img / totals.imgDen : 0,
    areaRate: totals.areaDen ? totals.area / totals.areaDen : 0,
    priceRate: totals.priceDen ? totals.price / totals.priceDen : 0,
  };
}

export function mapGradeToTone(grade) {
  if (grade === "GOOD") return "ok";
  if (grade === "PARTIAL" || grade === "SKIP") return "partial";
  return "no";
}

export function statusFromCode(code) {
  if (code === "DONE" || code === "PARTIAL") return "DONE";
  if (code === "SKIP") return "SKIP";
  return "FAIL";
}

export function hasDbConnectionError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("password must be a string")
    || message.includes("password authentication failed")
    || message.includes("sasl")
    || message.includes("no pg_hba.conf")
    || message.includes("server closed the connection")
    || message.includes("connect econnrefused")
    || message.includes("econnrefused")
    || message.includes("connection to server")
    || message.includes("could not connect to server");
}

export function mapServerError(error) {
  if (hasDbConnectionError(error)) {
    return {
      status: 503,
      code: "DB_CONNECTION_ERROR",
      message: "\uB370\uC774\uD130\uBCA0\uC774\uC2A4 \uC5F0\uACB0\uC774 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. PGHOST/PGDATABASE/PGUSER/PGPASSWORD \uB610\uB294 DATABASE_URL\uC744 \uD655\uC778\uD558\uC138\uC694.",
      retryAfter: "10",
      detail: String(error?.message || error || "DB connection failure"),
    };
  }

  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: String(error?.message || error || "internal_error"),
  };
}

export function parseRunIdFilter(baseRunId) {
  if (!baseRunId) return "%::%";
  return `${baseRunId}::%`;
}

export function normalizeBaseRunId(value) {
  const text = safeText(value, "");
  if (!text) return null;
  const base = text.split("::")[0].trim();
  return base.length ? base : null;
}

// ---------------------------------------------------------------------------
// HTTP response helpers
// ---------------------------------------------------------------------------

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(payload);
}

export function send404(res) {
  sendJson(res, 404, { error: "not_found" });
}

export function sendServerError(res, error) {
  const mapped = mapServerError(error);
  if (mapped.retryAfter) {
    res.setHeader("Retry-After", mapped.retryAfter);
  }
  sendJson(res, mapped.status, {
    error: mapped.code,
    message: mapped.message,
    detail: mapped.detail || undefined,
  });
}

// ---------------------------------------------------------------------------
// Shared DB query helpers (used across route handlers)
// ---------------------------------------------------------------------------

export function parseImageMap(rows) {
  const imageMap = new Map();
  for (const row of rows || []) {
    const listingId = toInt(row.listing_id, null);
    if (listingId === null) continue;
    imageMap.set(listingId, toInt(row.image_count, 0));
  }
  return imageMap;
}

export async function resolveLatestBaseRunId(client, runId) {
  if (runId) return runId;
  const latest = await client.query(`
    WITH base_runs AS (
      SELECT
        COALESCE(extra->>'base_run_id', split_part(run_id, '::', 1)) AS base_run_id,
        MAX(started_at) AS latest_started_at,
        COUNT(DISTINCT platform_code) AS platform_count
      FROM collection_runs
      GROUP BY COALESCE(extra->>'base_run_id', split_part(run_id, '::', 1))
    )
    SELECT base_run_id
    FROM base_runs
    ORDER BY platform_count DESC, latest_started_at DESC NULLS LAST
    LIMIT 1
  `);
  return safeText(latest.rows?.[0]?.base_run_id, null);
}

export function listingSummary(listing, imageMap) {
  const imageCount = toInt(imageMap.get(listing.listing_id) || listing.image_count || 0, 0);
  return {
    listing_id: listing.listing_id,
    platform: listing.platform_code,
    sigungu: listing.address_text ? listing.address_text.split(" ").find((part) => part.includes("\uAD6C") || part.includes("\uAD70")) || null : null,
    address: safeText(listing.address_text, ""),
    rent: toNumber(listing.rent_amount, null),
    deposit: toNumber(listing.deposit_amount, null),
    area_exclusive_m2: toNumber(listing.area_exclusive_m2, null),
    area_gross_m2: toNumber(listing.area_gross_m2, null),
    image_count: imageCount,
  };
}
