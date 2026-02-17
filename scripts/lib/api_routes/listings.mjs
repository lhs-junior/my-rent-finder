import { toInt, toNumber, toText, withDbClient } from "../db_client.mjs";
import {
  safeText,
  sendJson,
  platformNameFromCode,
  normalizeBaseRunId,
  parseQueryNumber,
  parseQueryInt,
  parseImageMap,
  resolveLatestBaseRunId,
} from "../api_helpers.mjs";

// ---------------------------------------------------------------------------
// /api/listings
// ---------------------------------------------------------------------------

export async function handleListings(req, res) {
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
  const minFloor = url.searchParams.has("min_floor")
    ? parseQueryInt(url.searchParams.get("min_floor"), null)
    : null;
  const limit = Math.max(1, parseQueryInt(url.searchParams.get("limit"), 50));
  const offset = Math.max(0, parseQueryInt(url.searchParams.get("offset"), 0));

  const listingRows = await withDbClient(async (client) => {
    const cond = ["1=1"];
    const params = [];
    const normalizedRunId = normalizeBaseRunId(runId);
    if (normalizedRunId) {
      const effectiveRunId = normalizedRunId;
      params.push(`${effectiveRunId}::%`);
      cond.push(`rl.run_id LIKE $${params.length}`);
    }

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
    if (minFloor !== null) {
      params.push(minFloor);
      cond.push(`(nl.floor IS NULL OR nl.floor = 0 OR nl.floor >= $${params.length})`);
    }

    const countResult = await client.query(`
      SELECT COUNT(*) AS total
      FROM normalized_listings nl
      JOIN raw_listings rl ON rl.raw_id = nl.raw_id
      WHERE ${cond.join(" AND ")}
    `, [...params]);
    const total = parseInt(countResult.rows?.[0]?.total || "0", 10);

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
             nl.quality_flags,
             nl.created_at, rl.run_id
      FROM normalized_listings nl
      JOIN raw_listings rl ON rl.raw_id = nl.raw_id
      WHERE ${cond.join(" AND ")}
      ORDER BY nl.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    const listingRowsInner = rows.rows || [];

    const listingIds = listingRowsInner.map((row) => toInt(row.listing_id, null)).filter((value) => value !== null);
    const imageRows = listingIds.length
      ? await client.query(`SELECT listing_id, COUNT(*) AS image_count FROM listing_images WHERE listing_id = ANY($1) GROUP BY listing_id`, [listingIds])
      : { rows: [] };
    const imageMap = parseImageMap(imageRows.rows || []);

    const mappedRows = listingRowsInner.map((row) => {
      const listingId = toInt(row.listing_id, null);
      return {
        listing_id: listingId,
        platform_code: safeText(row.platform_code, ""),
        platform: platformNameFromCode(safeText(row.platform_code, "")),
        source_ref: safeText(row.source_ref, ""),
        external_id: safeText(row.external_id, ""),
        source_url: safeText(row.source_url, ""),
        title: safeText(row.title, ""),
        lease_type: safeText(row.lease_type, "\uAE30\uD0C0"),
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
        is_stale: (() => {
          try {
            const flags = typeof row.quality_flags === "string" ? JSON.parse(row.quality_flags) : (row.quality_flags || []);
            return Array.isArray(flags) && flags.includes("STALE_SUSPECT");
          } catch {
            return false;
          }
        })(),
        run_id: safeText(row.run_id, ""),
        created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      };
    });

    return {
      rows: mappedRows,
      listingIds,
      total,
    };
  });

  sendJson(res, 200, {
    items: listingRows.rows,
    total: listingRows.total,
    count: listingRows.rows.length,
    limit,
    offset,
  });
}

// ---------------------------------------------------------------------------
// /api/listings/:id
// ---------------------------------------------------------------------------

export async function handleListingDetail(req, res, id) {
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

    let priceHistory = [];
    try {
      const histResult = await client.query(
        `SELECT history_id, rent_amount, deposit_amount, previous_rent, previous_deposit, detected_at, run_id
         FROM listing_price_history WHERE listing_id = $1 ORDER BY detected_at DESC LIMIT 50`,
        [id]
      );
      priceHistory = histResult.rows;
    } catch (err) {
      // Table may not exist yet (pre-migration)
      if (!err.message?.includes("does not exist")) throw err;
    }

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
        lease_type: safeText(row.lease_type, "\uAE30\uD0C0"),
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
        price_history: priceHistory.map((h) => ({
          history_id: toInt(h.history_id, null),
          rent_amount: toNumber(h.rent_amount, null),
          deposit_amount: toNumber(h.deposit_amount, null),
          previous_rent: toNumber(h.previous_rent, null),
          previous_deposit: toNumber(h.previous_deposit, null),
          detected_at: h.detected_at ? new Date(h.detected_at).toISOString() : null,
          run_id: safeText(h.run_id, ""),
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
