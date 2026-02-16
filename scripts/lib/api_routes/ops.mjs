import { toInt, toNumber, toText, withDbClient } from "../db_client.mjs";
import {
  safeText,
  safeNum,
  clamp01,
  toNumDate,
  sendJson,
  platformNameFromCode,
  inferItemQuality,
  statusFromCode,
  normalizeBaseRunId,
  parseRunIdFilter,
  parseImageMap,
  parseQueryInt,
  resolveLatestBaseRunId,
  listingSummary,
} from "../api_helpers.mjs";

// ---------------------------------------------------------------------------
// DB query helpers
// ---------------------------------------------------------------------------

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
      lease_type: safeText(row.lease_type, "\uAE30\uD0C0"),
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

export async function getMatchingData(client, baseRunId, statusFilter = null, limit = 400, offset = 0) {
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

// ---------------------------------------------------------------------------
// Dashboard payload builder
// ---------------------------------------------------------------------------

async function buildDashboardPayload(baseRunId) {
  const normalizedBaseRunId = normalizeBaseRunId(baseRunId);
  return withDbClient(async (client) => {
    const resolvedRunId = await resolveLatestBaseRunId(client, normalizedBaseRunId);
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

// ---------------------------------------------------------------------------
// Collection runs list handler
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleOps(req, res) {
  const url = new URL(req.url, "http://localhost");
  const runId = safeText(url.searchParams.get("run_id"), null);
  const payload = await buildDashboardPayload(runId);
  sendJson(res, 200, payload);
}

export async function handleCollectionRuns(req, res) {
  await listCollectionsHandler(req, res);
}
