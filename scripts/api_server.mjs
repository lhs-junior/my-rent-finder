#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  getDbConfig,
  toInt,
  toNumber,
  toText,
  withDbClient,
} from "./lib/db_client.mjs";

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.findIndex((v) => v === name || v.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=");
}

function getInt(name, fallback) {
  const raw = getArg(name, null);
  const n = Number(raw);
  if (raw === null || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function normalizeBaseRunId(value) {
  const text = safeText(value, "");
  if (!text) return null;
  const base = text.split("::")[0].trim();
  return base.length ? base : null;
}

function getBool(name, fallback = false) {
  const raw = getArg(name, null);
  if (raw === null) return fallback;
  if (raw === name) return true;
  const norm = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(norm)) return true;
  if (["0", "false", "no", "off", "n"].includes(norm)) return false;
  return true;
}

function safeText(value, fallback = null) {
  return toText(value, fallback);
}

function safeNum(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function parseQueryNumber(value, fallback = null) {
  const text = safeText(value, null);
  if (text === null) return fallback;
  const num = Number(text);
  return Number.isFinite(num) ? num : fallback;
}

function parseQueryInt(value, fallback = null) {
  const num = parseQueryNumber(value, fallback);
  if (num === null || num === undefined) return fallback;
  return Math.max(0, Math.trunc(num));
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function summarizeDbConnection() {
  const cfg = getDbConfig();
  if (cfg.connectionString) {
    const masked = cfg.connectionString
      .replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/, "$1***$3");
    return {
      mode: "DATABASE_URL",
      target: masked,
      auth: "masked",
    };
  }
  return {
    mode: "PG_ENV",
    target: `${cfg.host || "127.0.0.1"}:${cfg.port || 5432}/${cfg.database || "my_rent_finder"}`,
    user: cfg.user || null,
  };
}

async function resolveDbHealth() {
  const start = Date.now();
  return withDbClient(async (client) => {
    await client.query("SELECT 1");
    return {
      ok: true,
      ...summarizeDbConnection(),
      response_ms: Date.now() - start,
    };
  });
}

function inferItemQuality(items) {
  const totals = {
    req: 0,
    reqDen: 0,
    addr: 0,
    addrDen: 0,
    img: 0,
    imgDen: 0,
    area: 0,
    areaDen: 0,
    price: 0,
    priceDen: 0,
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

function mapGradeToTone(grade) {
  if (grade === "GOOD") return "ok";
  if (grade === "PARTIAL" || grade === "SKIP") return "partial";
  return "no";
}

function statusFromCode(code) {
  if (code === "DONE" || code === "PARTIAL") return "DONE";
  if (code === "SKIP") return "SKIP";
  return "FAIL";
}

function hasDbConnectionError(error) {
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

function mapServerError(error) {
  if (hasDbConnectionError(error)) {
    return {
      status: 503,
      code: "DB_CONNECTION_ERROR",
      message: "데이터베이스 연결이 실패했습니다. PGHOST/PGDATABASE/PGUSER/PGPASSWORD 또는 DATABASE_URL을 확인하세요.",
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

async function resolveLatestBaseRunId(client, runId) {
  if (runId) return runId;
  const latest = await client.query(`
    SELECT COALESCE(extra->>'base_run_id', split_part(run_id, '::', 1)) AS base_run_id
    FROM collection_runs
    ORDER BY started_at DESC NULLS LAST
    LIMIT 1
  `);
  return safeText(latest.rows?.[0]?.base_run_id, null);
}

function parseImageMap(rows) {
  const imageMap = new Map();
  for (const row of rows || []) {
    const listingId = toInt(row.listing_id, null);
    if (listingId === null) continue;
    imageMap.set(listingId, toInt(row.image_count, 0));
  }
  return imageMap;
}

function parseRunIdFilter(baseRunId) {
  if (!baseRunId) return "%::%";
  return `${baseRunId}::%`;
}

async function getCollectionRuns(client, baseRunId) {
  return client.query(`
    SELECT cr.run_id, cr.platform_code, cr.status, cr.started_at, cr.finished_at,
           cr.query_city, cr.query_district, cr.extra, COALESCE(cr.extra->>'source', '') AS source,
           COUNT(DISTINCT r.raw_id) AS raw_count,
           COUNT(DISTINCT n.listing_id) AS normalized_count
    FROM collection_runs cr
    LEFT JOIN raw_listings r ON r.run_id = cr.run_id
    LEFT JOIN normalized_listings n ON n.raw_id = r.raw_id
    WHERE COALESCE(cr.run_id, '') LIKE $1
    GROUP BY cr.run_id, cr.platform_code, cr.status, cr.started_at, cr.finished_at, cr.query_city, cr.query_district, cr.extra
    ORDER BY cr.started_at ASC
  `, [parseRunIdFilter(baseRunId)]);
}

async function getListingSnapshot(client, baseRunId) {
  const rows = await client.query(`
    SELECT nl.listing_id, nl.platform_code,
           COALESCE(
             NULLIF(nl.source_ref, ''),
             NULLIF(nl.external_id, ''),
             NULLIF(rl.payload_json->>'articleNo', ''),
             NULLIF(rl.payload_json->>'articleId', ''),
             NULLIF(rl.payload_json->>'listingId', ''),
             NULLIF(rl.payload_json->>'id', ''),
             NULLIF(rl.payload_json->>'atclNo', '')
           ) AS source_ref,
           nl.address_text, nl.address_code,
           nl.rent_amount, nl.deposit_amount, nl.area_exclusive_m2, nl.area_gross_m2,
           nl.title, nl.source_url, nl.lease_type, nl.room_count, nl.bathroom_count, nl.floor,
           nl.total_floor, nl.direction, nl.building_use, nl.external_id, rl.run_id
    FROM normalized_listings nl
    JOIN raw_listings rl ON rl.raw_id = nl.raw_id
    WHERE COALESCE(rl.run_id, '') LIKE $1
    ORDER BY nl.created_at DESC
  `, [parseRunIdFilter(baseRunId)]);
  const listingRows = rows.rows || [];
  const listingIds = listingRows.map((row) => toInt(row.listing_id, null)).filter((value) => value !== null);

  let imageCounts = new Map();
  if (listingIds.length > 0) {
    const images = await client.query(
      `SELECT listing_id, COUNT(*) AS image_count FROM listing_images WHERE listing_id = ANY($1) GROUP BY listing_id`,
      [listingIds],
    );
    imageCounts = parseImageMap(images.rows || []);
  }

  return listingRows.map((row) => {
    const listingId = toInt(row.listing_id, null);
    return {
      listing_id: listingId,
      platform_code: row.platform_code,
      source_ref: safeText(row.source_ref, ""),
      external_id: safeText(row.external_id, ""),
      title: safeText(row.title, ""),
      lease_type: safeText(row.lease_type, "기타"),
      address_text: safeText(row.address_text, ""),
      address_code: safeText(row.address_code, ""),
      rent_amount: toNumber(row.rent_amount, null),
      deposit_amount: toNumber(row.deposit_amount, null),
      area_exclusive_m2: toNumber(row.area_exclusive_m2, null),
      area_gross_m2: toNumber(row.area_gross_m2, null),
      room_count: toInt(row.room_count, null),
      bathroom_count: toInt(row.bathroom_count, null),
      floor: toInt(row.floor, null),
      total_floor: toInt(row.total_floor, null),
      direction: safeText(row.direction, null),
      building_use: safeText(row.building_use, null),
      source_url: safeText(row.source_url, ""),
      run_id: safeText(row.run_id, ""),
      image_count: Number(imageCounts.get(listingId) || 0),
    };
  });
}

async function getLatestMatcherRun(client, baseRunId) {
  const matcherRun = await client.query(`
    SELECT matcher_run_id, candidates, auto_match_count, review_required_count, distinct_count, algorithm_version, rule_version, threshold_json, started_at, finished_at, run_meta
    FROM matcher_runs
    WHERE COALESCE(run_meta->>'base_run_id', '') = $1
    ORDER BY finished_at DESC NULLS LAST, matcher_run_id DESC
    LIMIT 1
  `, [safeText(baseRunId, "")]);
  return matcherRun.rows?.[0] || null;
}

function listingSummary(listing, imageMap) {
  const imageCount = toInt(imageMap.get(listing.listing_id) || listing.image_count || 0, 0);
  return {
    listing_id: listing.listing_id,
    platform: listing.platform_code,
    sigungu: listing.address_text ? listing.address_text.split(" ").find((part) => part.includes("구") || part.includes("군")) || null : null,
    address: safeText(listing.address_text, ""),
    rent: toNumber(listing.rent_amount, null),
    deposit: toNumber(listing.deposit_amount, null),
    area_exclusive_m2: toNumber(listing.area_exclusive_m2, null),
    area_gross_m2: toNumber(listing.area_gross_m2, null),
    image_count: imageCount,
  };
}

async function getMatchingData(client, baseRunId, statusFilter = null, limit = 400, offset = 0) {
  const matcherRun = await getLatestMatcherRun(client, baseRunId);
  if (!matcherRun) {
    return {
      matcherRunId: null,
      summary: {
        count: 0,
        candidate_pairs: 0,
        auto_match: 0,
        review_required: 0,
        distinct: 0,
        merged_groups: 0,
      },
      pairs: [],
      groups: [],
    };
  }

  const matcherRunId = toInt(matcherRun.matcher_run_id, null);
  const normalizedStatus = toText(statusFilter, null);
  let pairsQuery = `
    SELECT
      lm.match_id, lm.source_listing_id, lm.target_listing_id, lm.score, lm.status,
      lm.distance_score, lm.address_score, lm.area_score, lm.price_score, lm.attribute_score,
      lm.reason_json
    FROM listing_matches lm
    WHERE lm.matcher_run_id = $1
  `;
  const pairParams = [matcherRunId];
  if (normalizedStatus) {
    pairsQuery += " AND lm.status = $2";
    pairParams.push(normalizedStatus);
    pairsQuery += " ORDER BY lm.score DESC LIMIT $3 OFFSET $4";
    pairParams.push(limit);
    pairParams.push(offset);
  } else {
    pairsQuery += " ORDER BY lm.score DESC LIMIT $2 OFFSET $3";
    pairParams.push(limit);
    pairParams.push(offset);
  }

  const pairsRows = await client.query(pairsQuery, pairParams);
  const matcherPairs = pairsRows.rows || [];

  const listingIds = [];
  for (const pair of matcherPairs) {
    listingIds.push(pair.source_listing_id, pair.target_listing_id);
  }

  const unique = [...new Set(listingIds.filter((v) => toInt(v, null) !== null))];
  const imageRows = unique.length
    ? await client.query(
      `SELECT listing_id, COUNT(*) AS image_count FROM listing_images WHERE listing_id = ANY($1) GROUP BY listing_id`,
      [unique],
    )
    : { rows: [] };
  const imageMap = parseImageMap(imageRows.rows || []);

  const listingRows = unique.length
    ? await client.query(
      `
      SELECT listing_id, platform_code, address_text, address_code, rent_amount, deposit_amount, area_exclusive_m2, area_gross_m2
      FROM normalized_listings
      WHERE listing_id = ANY($1)
      `,
      [unique],
    )
    : { rows: [] };
  const listingMap = new Map();
  for (const row of listingRows.rows || []) {
    listingMap.set(toInt(row.listing_id, null), {
      listing_id: toInt(row.listing_id, null),
      platform_code: row.platform_code,
      address_text: safeText(row.address_text, ""),
      rent_amount: toNumber(row.rent_amount, null),
      deposit_amount: toNumber(row.deposit_amount, null),
      area_exclusive_m2: toNumber(row.area_exclusive_m2, null),
      area_gross_m2: toNumber(row.area_gross_m2, null),
      address_code: safeText(row.address_code, ""),
    });
  }

  const pairs = matcherPairs.map((pair) => {
    const source = listingMap.get(toInt(pair.source_listing_id, null)) || null;
    const target = listingMap.get(toInt(pair.target_listing_id, null)) || null;
    return {
      status: safeText(pair.status, "DISTINCT"),
      score: toNumber(pair.score, 0),
      source_listing_id: safeText(pair.source_listing_id, ""),
      target_listing_id: safeText(pair.target_listing_id, ""),
      source: source ? listingSummary(source, imageMap) : null,
      target: target ? listingSummary(target, imageMap) : null,
      reason: pair.reason_json || {},
      distance_score: toNumber(pair.distance_score, 0),
      address_score: toNumber(pair.address_score, 0),
      area_score: toNumber(pair.area_score, 0),
      price_score: toNumber(pair.price_score, 0),
      attribute_score: toNumber(pair.attribute_score, 0),
    };
  });

  const groupRows = await client.query(`
    SELECT gm.group_id, gm.canonical_key, gm.canonical_status, gm.reason_json, gm.created_at,
           m.listing_id, m.score
    FROM match_groups gm
    LEFT JOIN match_group_members m ON m.group_id = gm.group_id
    WHERE gm.matcher_run_id = $1
    ORDER BY gm.group_id, m.score DESC NULLS LAST
  `, [matcherRunId]);

  const grouped = new Map();
  for (const row of groupRows.rows || []) {
    const groupId = toText(row.group_id, "");
    if (!grouped.has(groupId)) {
      grouped.set(groupId, {
        group_id: groupId,
        canonical_key: safeText(row.canonical_key, ""),
        canonical_status: safeText(row.canonical_status, "OPEN"),
        reason_json: row.reason_json || {},
        member_ids: [],
      });
    }
    if (row.listing_id !== null && row.listing_id !== undefined) {
      grouped.get(groupId).member_ids.push(toInt(row.listing_id, null));
    }
  }

  const groupMapRows = Array.from(new Set(groupRows.rows || []))
    .filter(Boolean);
  const groupedMembers = await Promise.all(Array.from(grouped.entries()).map(async ([, group]) => {
    const members = [];
    for (const memberId of group.member_ids) {
      const member = listingMap.get(memberId)
        || await client.query(`SELECT platform_code, address_text, address_code, rent_amount, deposit_amount, area_exclusive_m2, area_gross_m2, listing_id FROM normalized_listings WHERE listing_id = $1`, [memberId]).then((r) => r.rows?.[0] || null);
      if (member) {
        const summary = listingSummary(member, imageMap);
        members.push({
          ...summary,
          id: summary.listing_id || memberId,
        });
      }
    }
    return {
      ...group,
      members,
      member_count: members.length,
    };
  }));

  return {
    matcherRunId,
    summary: {
      count: matcherPairs.length,
      candidate_pairs: toInt(matcherRun.candidates, 0),
      auto_match: toInt(matcherRun.auto_match_count, 0),
      review_required: toInt(matcherRun.review_required_count, 0),
      distinct: toInt(matcherRun.distinct_count, 0),
      merged_groups: groupedMembers.length,
    },
    pairs,
    groups: groupedMembers,
    matcherRun,
  };
}

async function buildDashboardPayload(baseRunId) {
  const normalizedBaseRunId = normalizeBaseRunId(baseRunId);
  return withDbClient(async (client) => {
    const resolvedRunId = await resolveLatestBaseRunId(
      client,
      normalizedBaseRunId,
    );
    if (!resolvedRunId) {
      return { generated_at: new Date().toISOString(), error: "run_not_found" };
    }

    const runRows = (await getCollectionRuns(client, resolvedRunId)).rows || [];
    const listings = await getListingSnapshot(client, resolvedRunId);
    const listingImageMap = new Map();
    for (const listing of listings) {
      listingImageMap.set(listing.listing_id, listing.image_count || 0);
    }
    const listingMapByPlatform = new Map();
    const totalQuality = inferItemQuality(listings);

    const durationByRun = runRows.map((row) => {
      const started = safeNum(Date.parse(row.started_at), 0);
      const finished = safeNum(Date.parse(row.finished_at), started);
      const duration = started && finished ? Math.max(0, finished - started) : 0;
      return {
        run_id: safeText(row.run_id, ""),
        platform_code: safeText(row.platform_code, "unknown"),
        platform_name: safeText(platformNameFromCode(safeText(row.platform_code, "")), safeText(row.platform_code, "unknown")),
        status: safeText(row.status, "FAILED"),
        started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
        finished_at: row.finished_at ? new Date(row.finished_at).toISOString() : null,
        raw_file: null,
        meta_file: null,
        normalized_path: null,
        raw_count: toInt(row.raw_count, 0),
        normalized_count: toInt(row.normalized_count, 0),
        grade: statusFromCode(safeText(row.status, "")),
        failed: safeText(row.status, "") === "FAILED" ? 1 : 0,
        skipped: safeText(row.status, "") === "PARTIAL" ? 1 : 0,
        succeeded: safeText(row.status, "") === "DONE" ? 1 : 0,
        duration_ms: duration,
        query_city: safeText(row.query_city, null),
        query_district: safeText(row.query_district, null),
      };
    });

    for (const listing of listings) {
      if (!listing.platform_code) continue;
      const row = listingMapByPlatform.get(listing.platform_code) || [];
      row.push(listing);
      listingMapByPlatform.set(listing.platform_code, row);
    }

    const platformRows = Array.from(listingMapByPlatform.entries()).map(([platform, platformItems]) => {
      const matchedRuns = durationByRun.filter((row) => row.platform_code === platform);
      const rawCount = matchedRuns.reduce((sum, row) => sum + toInt(row.raw_count, 0), 0);
      const normalizedCount = matchedRuns.reduce((sum, row) => sum + toInt(row.normalized_count, 0), 0);
      const metrics = inferItemQuality(platformItems);
      const qualityGrades = {
        GOOD: 0,
        PARTIAL: 0,
        FAIL: 0,
        EMPTY: 0,
        SKIP: 0,
      };
      for (const row of matchedRuns) {
        qualityGrades[row.grade || "FAIL"] = (qualityGrades[row.grade || "FAIL"] || 0) + 1;
      }

      const succeeded = matchedRuns.filter((row) => row.succeeded === 1).length;
      const skipped = matchedRuns.filter((row) => row.skipped === 1).length;
      const failed = matchedRuns.filter((row) => row.failed === 1).length;
      const jobs = matchedRuns.length || 1;
      return {
        platform_code: platform,
        platform_name: platformNameFromCode(platform),
        jobs,
        succeeded,
        skipped,
        failed,
        raw_count: rawCount,
        normalized_count: normalizedCount,
        quality_grades: qualityGrades,
        success_rate: clamp01((succeeded + skipped) / jobs),
        metrics: {
          required_fields_rate: metrics.requiredFieldsRate,
          address_rate: metrics.addressRate,
          image_rate: metrics.imageRate,
          area_rate: metrics.areaRate,
          price_rate: metrics.priceRate,
        },
      };
    });

    const overall = {
      count: listings.length,
      required: totalQuality.requiredFieldsRate,
    };
    const matchingData = await getMatchingData(client, resolvedRunId);

    const autoPairs = matchingData.pairs.filter((pair) => pair.status === "AUTO_MATCH");
    const reviewPairs = matchingData.pairs.filter((pair) => pair.status === "REVIEW_REQUIRED");
    const groups = matchingData.groups.map((group) => {
      const memberCount = group.members.length;
      return {
        ...group,
        member_count: memberCount,
      };
    });

    const overviewRawCount = durationByRun.reduce((sum, row) => sum + toInt(row.raw_count, 0), 0);
    const overviewNormalizedCount = durationByRun.reduce((sum, row) => sum + toInt(row.normalized_count, 0), 0);

    return {
      generated_at: new Date().toISOString(),
      run: {
        run_id: resolvedRunId,
        workspace: null,
        started_at: (runRows[0] && new Date(runRows[0].started_at).toISOString()) || null,
        finished_at: (runRows[0] && new Date(runRows[0].finished_at).toISOString()) || null,
        duration_ms: runRows.reduce((sum, row) => sum + (toNumDate(row.finished_at) - toNumDate(row.started_at)), 0),
        selected_platforms: Array.from(listingMapByPlatform.keys()),
        source_summary_path: null,
        summary_jobs: {
          jobs: durationByRun.length,
          succeeded: durationByRun.filter((row) => row.succeeded).length,
          skipped: durationByRun.filter((row) => row.skipped).length,
          failed: durationByRun.filter((row) => row.failed).length,
        },
      },
      overview: {
        total_jobs: durationByRun.length,
        succeeded_jobs: durationByRun.filter((row) => row.succeeded).length,
        skipped_jobs: durationByRun.filter((row) => row.skipped).length,
        failed_jobs: durationByRun.filter((row) => row.failed).length,
        raw_count: overviewRawCount,
        normalized_count: overviewNormalizedCount,
        required_quality_rate: overall.required,
      },
      platform_rows: platformRows,
      jobs: durationByRun.map((row) => ({
        name: `${row.platform_code} run`,
        platform: row.platform_code,
        platform_name: row.platform_name,
        status: row.status === "DONE" ? "DONE" : row.status === "PARTIAL" ? "SKIP" : "FAIL",
        sigungu: row.query_district || "-",
        grade: row.grade,
        raw_file: row.raw_file,
        meta_file: row.meta_file,
        normalized_path: row.normalized_path,
        raw_count: row.raw_count,
        normalized_count: row.normalized_count,
        duration_ms: row.duration_ms,
        started_at: row.started_at,
        finished_at: row.finished_at,
        __run_id: row.run_id,
      })),
      matching: {
        summary: {
          candidate_pairs: matchingData.summary.candidate_pairs,
          auto_match: matchingData.summary.auto_match,
          review_required: matchingData.summary.review_required,
          distinct: matchingData.summary.distinct,
          merged_groups: matchingData.summary.merged_groups,
        },
        auto_pairs: autoPairs,
        review_pairs: reviewPairs,
        groups,
      },
    };
  });
}

function toNumDate(value) {
  const v = Date.parse(value);
  return Number.isFinite(v) ? v : 0;
}

const DEFAULT_FRONT_DIR = path.resolve(process.cwd(), "frontend/dist");
const FRONT_DIR = (() => {
  const value = getArg("--front-dir", null);
  if (!value) return DEFAULT_FRONT_DIR;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
})();

function isInside(baseDir, targetPath) {
  const rel = path.relative(baseDir, targetPath);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function mimeFor(filePath) {
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

function sendStaticIndex(res, frontDir) {
  const indexPath = path.join(frontDir, "index.html");
  if (!fs.existsSync(indexPath)) return false;

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  fs.createReadStream(indexPath).pipe(res);
  return true;
}

function sendStaticFile(frontDir, targetPath, res) {
  try {
    if (!fs.existsSync(frontDir) || !fs.statSync(frontDir).isDirectory()) {
      return false;
    }
    if (!isInside(frontDir, targetPath)) return false;
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) return false;

    res.statusCode = 200;
    res.setHeader("Content-Type", mimeFor(targetPath));
    fs.createReadStream(targetPath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function sendNoFrontInfo(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Frontend static bundle is not built.\nRun:\n  npm run front:build\nthen restart API server.\n");
  return true;
}

function serveFrontend(req, res, pathname) {
  if (!pathname || pathname === "/") {
    if (!fs.existsSync(FRONT_DIR)) {
      return sendNoFrontInfo(res);
    }
    return sendStaticIndex(res, FRONT_DIR);
  }
  if (!pathname.startsWith("/")) return false;
  const rel = pathname.replace(/^\/+/, "");
  const resolved = path.resolve(FRONT_DIR, rel);

  if (!sendStaticFile(FRONT_DIR, resolved, res)) {
    if (!path.extname(rel)) {
      return sendStaticIndex(res, FRONT_DIR);
    }
    return false;
  }
  return true;
}

function platformNameFromCode(code) {
  const names = {
    naver: "네이버 부동산",
    zigbang: "직방",
    dabang: "다방",
    r114: "부동산114",
    peterpanz: "피터팬",
    daangn: "당근부동산",
    kbland: "KB부동산",
  };
  return names[code] || code || "unknown";
}

async function listCollectionsHandler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const hours = parseQueryInt(url.searchParams.get("hours"), 0);
  const platform = safeText(url.searchParams.get("platform"), null);
  const limit = Math.max(1, parseQueryInt(url.searchParams.get("limit"), 100));
  const offset = Math.max(0, parseQueryInt(url.searchParams.get("offset"), 0));

  let sql = `
    SELECT run_id, platform_code, mode, status, started_at, finished_at,
           query_city, query_district, query_dong, target_min_rent, target_max_rent, target_min_area, extra, failure_code
    FROM collection_runs
  `;
  const params = [];
  const cond = [];
  if (platform) {
    params.push(platform);
    cond.push(`platform_code = $${params.length}`);
  }
  if (hours > 0) {
    params.push(hours);
    cond.push(`started_at >= NOW() - ($${params.length} || ' hours')::interval`);
  }
  if (cond.length) sql += ` WHERE ${cond.join(" AND ")}`;
  sql += ` ORDER BY started_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit);
  params.push(offset);

  const result = await withDbClient(async (client) => {
    const runs = await client.query(sql, params);
    return runs.rows || [];
  });

  sendJson(res, 200, {
    items: result,
    count: result.length,
    limit,
    offset,
  });
}

async function listingsHandler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const runId = safeText(url.searchParams.get("run_id"), null);
  const platform = safeText(url.searchParams.get("platform_code"), null);
  const address = safeText(url.searchParams.get("address"), null);
  const maxRent = url.searchParams.has("max_rent")
    ? parseQueryNumber(url.searchParams.get("max_rent"), null)
    : null;
  const minRent = url.searchParams.has("min_rent")
    ? parseQueryNumber(url.searchParams.get("min_rent"), null)
    : null;
  const minArea = url.searchParams.has("min_area")
    ? parseQueryNumber(url.searchParams.get("min_area"), null)
    : null;
  const maxArea = url.searchParams.has("max_area")
    ? parseQueryNumber(url.searchParams.get("max_area"), null)
    : null;
  const limit = Math.max(1, parseQueryInt(url.searchParams.get("limit"), 50));
  const offset = Math.max(0, parseQueryInt(url.searchParams.get("offset"), 0));

  const listingRows = await withDbClient(async (client) => {
    const cond = ["1=1"];
    const params = [];
    const normalizedRunId = normalizeBaseRunId(runId);
    const effectiveRunId = normalizedRunId || (await resolveLatestBaseRunId(client, null));
    if (!effectiveRunId) {
      return {
        rows: [],
        listingIds: [],
      };
    }

    params.push(`${effectiveRunId}::%`);
    cond.push(`rl.run_id LIKE $${params.length}`);

    if (platform) {
      params.push(platform);
      cond.push(`nl.platform_code = $${params.length}`);
    }
    if (address) {
      params.push(`%${address}%`);
      cond.push(`nl.address_text ILIKE $${params.length}`);
    }
    if (minRent !== null) {
      params.push(minRent);
      cond.push(`nl.rent_amount IS NOT NULL AND nl.rent_amount >= $${params.length}`);
    }
    if (maxRent !== null) {
      params.push(maxRent);
      cond.push(`nl.rent_amount IS NOT NULL AND nl.rent_amount <= $${params.length}`);
    }
    if (minArea !== null) {
      params.push(minArea);
      cond.push(`COALESCE(nl.area_exclusive_m2, nl.area_gross_m2) >= $${params.length}`);
    }
    if (maxArea !== null) {
      params.push(maxArea);
      cond.push(`COALESCE(nl.area_exclusive_m2, nl.area_gross_m2) <= $${params.length}`);
    }

    params.push(limit);
    params.push(offset);
    const rows = await client.query(`
      SELECT nl.listing_id, nl.platform_code, nl.source_url,
             COALESCE(
               NULLIF(nl.source_ref, ''),
               NULLIF(nl.external_id, ''),
               NULLIF(rl.payload_json->>'articleNo', ''),
               NULLIF(rl.payload_json->>'articleId', ''),
               NULLIF(rl.payload_json->>'listingId', ''),
               NULLIF(rl.payload_json->>'id', ''),
               NULLIF(rl.payload_json->>'atclNo', '')
             ) AS source_ref,
             nl.external_id,
             nl.title, nl.lease_type, nl.rent_amount, nl.deposit_amount, nl.area_exclusive_m2, nl.area_gross_m2,
             nl.address_text, nl.address_code, nl.room_count, nl.floor, nl.total_floor, nl.direction, nl.building_use,
             nl.created_at, rl.run_id
      FROM normalized_listings nl
      JOIN raw_listings rl ON rl.raw_id = nl.raw_id
      WHERE ${cond.join(" AND ")}
      ORDER BY nl.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    const listingRows = rows.rows || [];

    const listingIds = listingRows.map((row) => toInt(row.listing_id, null)).filter((value) => value !== null);
    const imageRows = listingIds.length
      ? await client.query(`SELECT listing_id, COUNT(*) AS image_count FROM listing_images WHERE listing_id = ANY($1) GROUP BY listing_id`, [listingIds])
      : { rows: [] };
    const imageMap = parseImageMap(imageRows.rows || []);

    const mappedRows = listingRows.map((row) => {
        const listingId = toInt(row.listing_id, null);
        return {
          listing_id: listingId,
          platform_code: safeText(row.platform_code, ""),
          platform: platformNameFromCode(safeText(row.platform_code, "")),
          source_ref: safeText(row.source_ref, ""),
          external_id: safeText(row.external_id, ""),
          source_url: safeText(row.source_url, ""),
          title: safeText(row.title, ""),
          lease_type: safeText(row.lease_type, "기타"),
          rent_amount: toNumber(row.rent_amount, null),
          deposit_amount: toNumber(row.deposit_amount, null),
          area_exclusive_m2: toNumber(row.area_exclusive_m2, null),
          area_gross_m2: toNumber(row.area_gross_m2, null),
          address_text: safeText(row.address_text, ""),
          address_code: safeText(row.address_code, ""),
          room_count: toInt(row.room_count, null),
          floor: toInt(row.floor, null),
          total_floor: toInt(row.total_floor, null),
          direction: safeText(row.direction, null),
          building_use: safeText(row.building_use, null),
          image_count: Number(imageMap.get(listingId) || 0),
          run_id: safeText(row.run_id, ""),
          created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
        };
      });

    return {
      rows: mappedRows,
      listingIds,
    };
  });

  sendJson(res, 200, {
    items: listingRows.rows,
    count: listingRows.rows.length,
    limit,
    offset,
  });
}

async function listingDetailHandler(req, res, id) {
  const listing = await withDbClient(async (client) => {
    const rows = await client.query(`
      SELECT nl.*, rl.run_id, rl.payload_json
      FROM normalized_listings nl
      JOIN raw_listings rl ON rl.raw_id = nl.raw_id
      WHERE nl.listing_id = $1
    `, [id]);
    if (!rows.rows?.length) return null;
    const row = rows.rows[0];
    const imageRows = await client.query(`SELECT source_url, status, is_primary FROM listing_images WHERE listing_id = $1 ORDER BY is_primary DESC, image_id DESC`, [id]);
    const violationRows = await client.query(`SELECT violation_code, message, detail, severity, detected_at FROM contract_violations WHERE listing_id = $1 ORDER BY detected_at DESC`, [id]);

    const rawAttrs = row?.payload_json && typeof row.payload_json === "object"
      ? row.payload_json
      : null;
    const sourceRefFromRaw = rawAttrs && typeof rawAttrs === "object"
      ? toText(rawAttrs.articleNo || rawAttrs.atclNo || rawAttrs.articleId || rawAttrs.id || rawAttrs.listingId, "")
      : "";

    return {
      listing: {
        listing_id: toInt(row.listing_id, null),
        platform_code: safeText(row.platform_code, ""),
        external_id: safeText(row.external_id, ""),
        platform: platformNameFromCode(safeText(row.platform_code, "")),
        source_url: safeText(row.source_url, ""),
        title: safeText(row.title, ""),
        lease_type: safeText(row.lease_type, "기타"),
        rent_amount: toNumber(row.rent_amount, null),
        deposit_amount: toNumber(row.deposit_amount, null),
        area_exclusive_m2: toNumber(row.area_exclusive_m2, null),
        area_exclusive_m2_min: toNumber(row.area_exclusive_m2_min, null),
        area_exclusive_m2_max: toNumber(row.area_exclusive_m2_max, null),
        area_gross_m2: toNumber(row.area_gross_m2, null),
        area_gross_m2_min: toNumber(row.area_gross_m2_min, null),
        area_gross_m2_max: toNumber(row.area_gross_m2_max, null),
        area_claimed: safeText(row.area_claimed, "estimated"),
        address_text: safeText(row.address_text, ""),
        address_code: safeText(row.address_code, ""),
        room_count: toInt(row.room_count, null),
        bathroom_count: toInt(row.bathroom_count, null),
        floor: toInt(row.floor, null),
        total_floor: toInt(row.total_floor, null),
        direction: safeText(row.direction, null),
        building_use: safeText(row.building_use, null),
        building_name: safeText(row.building_name, null),
        agent_name: safeText(row.agent_name, null),
        agent_phone: safeText(row.agent_phone, null),
        listed_at: safeText(row.listed_at, null),
        available_date: safeText(row.available_date, null),
        source_ref: safeText(row.source_ref || row.external_id || sourceRefFromRaw, ""),
        run_id: safeText(row.run_id, ""),
        images: imageRows.rows || [],
        quality_flags: (() => {
          try {
            return typeof row.quality_flags === "string" ? JSON.parse(row.quality_flags) : (row.quality_flags || []);
          } catch {
            return [];
          }
        })(),
        violations: (violationRows.rows || []).map((v) => ({
          code: safeText(v.violation_code, ""),
          message: safeText(v.message, ""),
          severity: safeText(v.severity, "WARN"),
          detail: v.detail,
          detected_at: v.detected_at ? new Date(v.detected_at).toISOString() : null,
        })),
      },
    };
  });

  if (!listing) {
    sendJson(res, 404, { error: "listing_not_found" });
    return;
  }
  sendJson(res, 200, listing);
}

async function matchQueryHandler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const runId = normalizeBaseRunId(safeText(url.searchParams.get("run_id"), null));
  const status = safeText(url.searchParams.get("status"), null);
  const limit = Math.max(1, parseQueryInt(url.searchParams.get("limit"), 200));
  const offset = Math.max(0, parseQueryInt(url.searchParams.get("offset"), 0));

  const rows = await withDbClient(async (client) => {
    const baseRunId = await resolveLatestBaseRunId(client, runId);
    const matching = await getMatchingData(client, baseRunId, status, limit, offset);
    return {
      summary: matching.summary,
      items: matching.pairs,
      groups: matching.groups,
    };
  });
  sendJson(res, 200, rows);
}

async function matchGroupHandler(req, res, groupId) {
  const parsedGroupId = toInt(groupId, null);
  if (!parsedGroupId) {
    sendJson(res, 400, { error: "invalid_group_id" });
    return;
  }

  const group = await withDbClient(async (client) => {
    const base = await client.query(`SELECT * FROM match_groups WHERE group_id = $1`, [parsedGroupId]);
    if (!base.rows?.length) return null;
    const row = base.rows[0];
    const members = await client.query(`
      SELECT m.listing_id, m.score, nl.platform_code, nl.address_text, nl.address_code, nl.rent_amount, nl.deposit_amount, nl.area_exclusive_m2, nl.area_gross_m2
      FROM match_group_members m
      JOIN normalized_listings nl ON nl.listing_id = m.listing_id
      WHERE m.group_id = $1
      ORDER BY m.score DESC
    `, [parsedGroupId]);
    const imageRows = await client.query(`SELECT listing_id, COUNT(*) AS image_count FROM listing_images WHERE listing_id = ANY($1) GROUP BY listing_id`, [members.rows.map((r) => toInt(r.listing_id, null)).filter((v) => v !== null)]);
    const imageMap = parseImageMap(imageRows.rows || []);
    return {
      group_id: parsedGroupId,
      matcher_run_id: toInt(row.matcher_run_id, null),
      canonical_key: safeText(row.canonical_key, ""),
      canonical_status: safeText(row.canonical_status, "OPEN"),
      reason_json: row.reason_json || {},
      members: members.rows.map((member) => ({
        listing_id: toInt(member.listing_id, null),
        platform: platformNameFromCode(safeText(member.platform_code, "")),
        address: safeText(member.address_text, ""),
        rent: toNumber(member.rent_amount, null),
        deposit: toNumber(member.deposit_amount, null),
        area_exclusive_m2: toNumber(member.area_exclusive_m2, null),
        area_gross_m2: toNumber(member.area_gross_m2, null),
        image_count: Number(imageMap.get(toInt(member.listing_id, null)) || 0),
      })),
    };
  });

  if (!group) {
    sendJson(res, 404, { error: "group_not_found" });
    return;
  }
  sendJson(res, 200, group);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(payload);
}

function send404(res) {
  sendJson(res, 404, { error: "not_found" });
}

function sendServerError(res, error) {
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

async function route(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  if (pathname === "/api/health" || pathname.startsWith("/api/")) {
    if (pathname === "/api/health") {
      const db = await resolveDbHealth();
      sendJson(res, 200, { ok: true, ts: new Date().toISOString(), db });
      return;
    }
    if (pathname === "/api/ops") {
      const runId = safeText(url.searchParams.get("run_id"), null);
      const payload = await buildDashboardPayload(runId);
      sendJson(res, 200, payload);
      return;
    }
    if (pathname === "/api/collection/runs") {
      await listCollectionsHandler(req, res);
      return;
    }
    if (pathname === "/api/listings") {
      await listingsHandler(req, res);
      return;
    }
    if (pathname === "/api/matches") {
      await matchQueryHandler(req, res);
      return;
    }
    if (pathname.startsWith("/api/listings/")) {
      let listingIdText = null;
      try {
        listingIdText = toText(decodeURIComponent(pathname.slice("/api/listings/".length)).trim(), null);
      } catch {
        listingIdText = null;
      }
      if (!listingIdText || !/^\d+$/.test(listingIdText)) {
        sendJson(res, 400, { error: "invalid_listing_id" });
        return;
      }
      await listingDetailHandler(req, res, listingIdText);
      return;
    }
    if (pathname.startsWith("/api/match-groups/")) {
      const id = pathname.slice("/api/match-groups/".length);
      await matchGroupHandler(req, res, id);
      return;
    }
  }

  const served = serveFrontend(req, res, pathname);
  if (served) return;

  send404(res);
}

const port = getInt("--port", 4100);
const host = getArg("--host", "127.0.0.1");
const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    sendServerError(res, error);
  });
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`포트 ${port} 사용 불가: 이미 다른 프로세스가  ${host}:${port}를 사용 중입니다.`);
    console.error("해결: 기존 서버를 종료한 뒤 다시 실행하거나, 다른 포트를 지정하세요.");
    console.error("예: npm run start -- --port=4101");
    process.exit(1);
  }
  console.error(`Server error: ${error?.message || String(error)}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Rent Finder API server running on http://${host}:${port}`);
  const frontDirExists = FRONT_DIR && fs.existsSync(FRONT_DIR) ? "ENABLED" : "DISABLED";
  console.log(`Frontend static serving: ${frontDirExists} (${FRONT_DIR})`);
  console.log(`Endpoints:
  /api/health
  /api/ops?run_id=
  /api/collection/runs?platform=&hours=&limit=&offset=
  /api/listings?run_id=&platform_code=&address=&min_rent=&max_rent=&min_area=&max_area=
  /api/listings/:id
  /api/matches?run_id=&status=&limit=&offset=
  /api/match-groups/:id`);
});
