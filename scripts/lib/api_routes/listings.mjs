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

const MONEY_ORIENTED_PLATFORMS = new Set(["dabang", "daangn"]);
const MONEY_SWAP_RENT_MIN = 500;
const MONEY_SWAP_DEPOSIT_MAX = 200;

function normalizeMoneyText(v) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().toLowerCase() : "";
}

function parseMoneyInText(value) {
  const s = normalizeMoneyText(value);
  if (!s) return null;
  const match = /([0-9]+(?:\.[0-9]+)?)/.exec(s);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function parseMoneyPairFromText(value) {
  const text = normalizeMoneyText(value);
  if (!text) return null;

  const slashIndex = text.indexOf("/");
  const barIndex = text.indexOf("|");
  const dividerIndex = slashIndex >= 0 ? slashIndex : barIndex;
  if (dividerIndex < 0) return null;

  const left = parseMoneyInText(text.slice(0, dividerIndex));
  const right = parseMoneyInText(text.slice(dividerIndex + 1));
  if (left === null || right === null) return null;
  return { left, right };
}

function normalizeMoneyHintOrder(text) {
  const normalized = normalizeMoneyText(text);
  if (!normalized) return null;
  const depositIndex = normalized.indexOf("보증금");
  const rentIndex = normalized.indexOf("월세");
  if (depositIndex < 0 || rentIndex < 0) return null;
  if (depositIndex < rentIndex) return "deposit-first";
  if (rentIndex < depositIndex) return "rent-first";
  return null;
}

function shouldSwapDabangDaangnMoney({
  platformCode,
  leaseType,
  rentAmount,
  depositAmount,
  rawText,
}) {
  if (!MONEY_ORIENTED_PLATFORMS.has(normalizeMoneyText(platformCode))) {
    return false;
  }

  const normalizedLease = normalizeMoneyText(leaseType);
  if (normalizedLease && normalizedLease !== "월세") return false;

  const rent = Number(rentAmount);
  const deposit = Number(depositAmount);
  if (!Number.isFinite(rent) || !Number.isFinite(deposit)) return false;
  if (rent <= 0 || deposit <= 0) return false;
  if (rent <= deposit) return false;
  if (deposit > MONEY_SWAP_DEPOSIT_MAX) return false;

  const orderHint = normalizeMoneyHintOrder(rawText);
  if (orderHint === "deposit-first") return true;
  if (orderHint === "rent-first") return false;

  if (rent >= MONEY_SWAP_RENT_MIN) return true;

  const pair = parseMoneyPairFromText(rawText);
  if (!pair) return false;
  return pair.left >= MONEY_SWAP_RENT_MIN && pair.right <= MONEY_SWAP_DEPOSIT_MAX;
}

function normalizeListingMoney({
  platformCode,
  leaseType,
  rawText,
  rentAmount,
  depositAmount,
}) {
  const rent = toNumber(rentAmount, null);
  const deposit = toNumber(depositAmount, null);
  if (rent === null || deposit === null) {
    return {
      rent_amount: rent,
      deposit_amount: deposit,
    };
  }

  const platform = normalizeMoneyText(platformCode);
  if (platform === "dabang") {
    return {
      rent_amount: rent,
      deposit_amount: deposit,
    };
  }

  if (!shouldSwapDabangDaangnMoney({
    platformCode,
    leaseType,
    rentAmount: rent,
    depositAmount: deposit,
    rawText,
  })) {
    return {
      rent_amount: rent,
      deposit_amount: deposit,
    };
  }

  return {
    rent_amount: deposit,
    deposit_amount: rent,
  };
}

function dedupRankExpression(alias = "nl") {
  return `ROW_NUMBER() OVER (
           PARTITION BY COALESCE(
             NULLIF(BTRIM(${alias}.source_ref), ''),
             NULLIF(BTRIM(${alias}.external_id), ''),
             md5(CONCAT_WS(
               '|',
               COALESCE(${alias}.platform_code, ''),
               COALESCE(${alias}.address_text, ''),
               COALESCE(${alias}.rent_amount::text, ''),
               COALESCE(${alias}.deposit_amount::text, ''),
               COALESCE(${alias}.room_count::text, '0'),
               COALESCE(${alias}.floor::text, '0')
             ))
           )
           ORDER BY COALESCE(${alias}.area_exclusive_m2, ${alias}.area_gross_m2, 0) DESC, ${alias}.created_at DESC
         )`;
}

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
    const cond = ["1=1", "nl.deleted_at IS NULL"];
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

    // Dedup: prefer stable identity keys (source_ref / external_id) and fallback signature
    const DEDUP_RK = dedupRankExpression("nl");

    const countResult = await client.query(`
      SELECT COUNT(*) AS total FROM (
        SELECT nl.listing_id, ${DEDUP_RK} AS _rk
        FROM normalized_listings nl
        JOIN raw_listings rl ON rl.raw_id = nl.raw_id
        WHERE ${cond.join(" AND ")}
      ) _d WHERE _d._rk = 1
    `, [...params]);
    const total = parseInt(countResult.rows?.[0]?.total || "0", 10);

    params.push(limit);
    params.push(offset);
    const rows = await client.query(`
      SELECT * FROM (
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
               nl.quality_flags, nl.lat, nl.lng,
               nl.created_at, rl.run_id,
               ${DEDUP_RK} AS _rk
        FROM normalized_listings nl
        JOIN raw_listings rl ON rl.raw_id = nl.raw_id
        WHERE ${cond.join(" AND ")}
      ) _d WHERE _d._rk = 1
      ORDER BY _d.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    const listingRowsInner = rows.rows || [];

    const listingIds = listingRowsInner.map((row) => toInt(row.listing_id, null)).filter((value) => value !== null);
    const imageRows = listingIds.length
      ? await client.query(`SELECT listing_id, COUNT(*) AS image_count FROM listing_images WHERE listing_id = ANY($1) GROUP BY listing_id`, [listingIds])
      : { rows: [] };
    const imageMap = parseImageMap(imageRows.rows || []);

    // Fetch first image URL per listing for card thumbnails
    const firstImageRows = listingIds.length
      ? await client.query(
          `SELECT DISTINCT ON (listing_id) listing_id, source_url
           FROM listing_images
           WHERE listing_id = ANY($1) AND source_url IS NOT NULL AND source_url != ''
           ORDER BY listing_id, is_primary DESC, image_id ASC`,
          [listingIds],
        )
      : { rows: [] };
    const firstImageMap = new Map();
    for (const row of firstImageRows.rows || []) {
      const lid = toInt(row.listing_id, null);
      if (lid !== null) firstImageMap.set(lid, row.source_url);
    }

    const mappedRows = listingRowsInner.map((row) => {
      const normalizedMoney = normalizeListingMoney({
        platformCode: row.platform_code,
        leaseType: row.lease_type,
        rawText: row.title || row.address_text || row.source_ref || row.external_id || row.listing_id,
        rentAmount: row.rent_amount,
        depositAmount: row.deposit_amount,
      });
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
        rent_amount: normalizedMoney.rent_amount,
        deposit_amount: normalizedMoney.deposit_amount,
        area_exclusive_m2: toNumber(row.area_exclusive_m2, null),
        area_gross_m2: toNumber(row.area_gross_m2, null),
        address_text: safeText(row.address_text, ""),
        address_code: safeText(row.address_code, ""),
        room_count: toInt(row.room_count, null),
        floor: toInt(row.floor, null),
        total_floor: toInt(row.total_floor, null),
        direction: safeText(row.direction, null),
        building_use: safeText(row.building_use, null),
        lat: toNumber(row.lat, null),
        lng: toNumber(row.lng, null),
        image_count: Number(imageMap.get(listingId) || 0),
        first_image_url: firstImageMap.get(listingId) || null,
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
      WHERE nl.listing_id = $1 AND nl.deleted_at IS NULL
    `, [id]);
    if (!rows.rows?.length) return null;
    const row = rows.rows[0];
    const normalizedMoney = normalizeListingMoney({
      platformCode: row.platform_code,
      leaseType: row.lease_type,
      rawText: row.title || row.address_text || row.source_ref || row.external_id || row.listing_id,
      rentAmount: row.rent_amount,
      depositAmount: row.deposit_amount,
    });
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
        rent_amount: normalizedMoney.rent_amount,
        deposit_amount: normalizedMoney.deposit_amount,
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
        lat: toNumber(row.lat, null),
        lng: toNumber(row.lng, null),
        geocode_status: safeText(row.geocode_status, null),
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
        price_history: priceHistory.map((h) => {
          const historyMoney = normalizeListingMoney({
            platformCode: row.platform_code,
            leaseType: row.lease_type,
            rawText: row.title || row.address_text || row.source_ref || row.external_id || h.history_id,
            rentAmount: h.rent_amount,
            depositAmount: h.deposit_amount,
          });
          const prevRent = normalizeListingMoney({
            platformCode: row.platform_code,
            leaseType: row.lease_type,
            rawText: row.title || row.address_text || row.source_ref || row.external_id || h.history_id,
            rentAmount: h.previous_rent,
            depositAmount: h.previous_deposit,
          });
          return {
            history_id: toInt(h.history_id, null),
            rent_amount: historyMoney.rent_amount,
            deposit_amount: historyMoney.deposit_amount,
            previous_rent: prevRent.rent_amount,
            previous_deposit: prevRent.deposit_amount,
            detected_at: h.detected_at ? new Date(h.detected_at).toISOString() : null,
            run_id: safeText(h.run_id, ""),
          };
        }),
      },
    };
  });

  if (!listing) {
    sendJson(res, 404, { error: "listing_not_found" });
    return;
  }
  sendJson(res, 200, listing);
}

// ---------------------------------------------------------------------------
// /api/listings/geo
// ---------------------------------------------------------------------------

export async function handleListingsGeo(req, res) {
  const url = new URL(req.url, "http://localhost");
  const swLat = parseQueryNumber(url.searchParams.get("sw_lat"), null);
  const swLng = parseQueryNumber(url.searchParams.get("sw_lng"), null);
  const neLat = parseQueryNumber(url.searchParams.get("ne_lat"), null);
  const neLng = parseQueryNumber(url.searchParams.get("ne_lng"), null);

  if (swLat === null || swLng === null || neLat === null || neLng === null) {
    sendJson(res, 400, { error: "bounds_required", message: "sw_lat, sw_lng, ne_lat, ne_lng are required" });
    return;
  }

  // Clamp bounds to South Korea range (don't reject — user may be zoomed out)
  const KR_LAT_MIN = 32, KR_LAT_MAX = 40, KR_LNG_MIN = 123, KR_LNG_MAX = 133;
  const cSwLat = Math.max(KR_LAT_MIN, Math.min(KR_LAT_MAX, swLat));
  const cNeLat = Math.max(KR_LAT_MIN, Math.min(KR_LAT_MAX, neLat));
  const cSwLng = Math.max(KR_LNG_MIN, Math.min(KR_LNG_MAX, swLng));
  const cNeLng = Math.max(KR_LNG_MIN, Math.min(KR_LNG_MAX, neLng));
  if (cSwLat >= cNeLat || cSwLng >= cNeLng) {
    sendJson(res, 200, { markers: [], total_in_bounds: 0 });
    return;
  }

  const platform = safeText(url.searchParams.get("platform_code"), null);
  const minRent = parseQueryNumber(url.searchParams.get("min_rent"), null);
  const maxRent = parseQueryNumber(url.searchParams.get("max_rent"), null);
  const minDeposit = parseQueryNumber(url.searchParams.get("min_deposit"), null);
  const maxDeposit = parseQueryNumber(url.searchParams.get("max_deposit"), null);
  const minArea = parseQueryNumber(url.searchParams.get("min_area"), null);
  const maxArea = parseQueryNumber(url.searchParams.get("max_area"), null);
  const minFloor = url.searchParams.has("min_floor")
    ? parseQueryInt(url.searchParams.get("min_floor"), null)
    : null;
  const limit = Math.min(500, Math.max(1, parseQueryInt(url.searchParams.get("limit"), 500)));

  const result = await withDbClient(async (client) => {
    const cond = [
      "nl.lat IS NOT NULL",
      "nl.lng IS NOT NULL",
      "nl.deleted_at IS NULL",
    ];
    const params = [];

    params.push(cSwLat, cNeLat);
    cond.push(`nl.lat BETWEEN $${params.length - 1} AND $${params.length}`);
    params.push(cSwLng, cNeLng);
    cond.push(`nl.lng BETWEEN $${params.length - 1} AND $${params.length}`);

    if (platform) {
      const platforms = platform.split(",").map(p => p.trim()).filter(Boolean);
      if (platforms.length === 1) {
        params.push(platforms[0]);
        cond.push(`nl.platform_code = $${params.length}`);
      } else if (platforms.length > 1) {
        params.push(platforms);
        cond.push(`nl.platform_code = ANY($${params.length})`);
      }
    }
    if (minRent !== null) {
      params.push(minRent);
      cond.push(`nl.rent_amount >= $${params.length}`);
    }
    if (maxRent !== null) {
      params.push(maxRent);
      cond.push(`nl.rent_amount <= $${params.length}`);
    }
    if (minArea !== null) {
      params.push(minArea);
      cond.push(`COALESCE(nl.area_exclusive_m2, nl.area_gross_m2) >= $${params.length}`);
    }
    if (maxArea !== null) {
      params.push(maxArea);
      cond.push(`COALESCE(nl.area_exclusive_m2, nl.area_gross_m2) <= $${params.length}`);
    }
    if (minDeposit !== null) {
      params.push(minDeposit);
      cond.push(`nl.deposit_amount >= $${params.length}`);
    }
    if (maxDeposit !== null) {
      params.push(maxDeposit);
      cond.push(`nl.deposit_amount <= $${params.length}`);
    }
    if (minFloor !== null) {
      params.push(minFloor);
      cond.push(`nl.floor >= $${params.length}`);
    }

    // Dedup: prefer stable identity keys (source_ref / external_id) and fallback signature
    const GEO_DEDUP_RK = dedupRankExpression("nl");

    params.push(limit);
    const rows = await client.query(`
      SELECT * FROM (
        SELECT nl.listing_id, nl.lat, nl.lng, nl.platform_code,
               nl.lease_type, nl.title,
               nl.rent_amount, nl.deposit_amount,
               COALESCE(nl.area_exclusive_m2, nl.area_gross_m2) AS area_m2,
               nl.address_text, nl.room_count, nl.floor, nl.building_use,
               nl.created_at,
               ${GEO_DEDUP_RK} AS _rk
        FROM normalized_listings nl
        WHERE ${cond.join(" AND ")}
      ) _d WHERE _d._rk = 1
      ORDER BY _d.created_at DESC
      LIMIT $${params.length}
    `, params);

    const countResult = await client.query(`
      SELECT COUNT(*) AS total FROM (
        SELECT nl.listing_id, ${GEO_DEDUP_RK} AS _rk
        FROM normalized_listings nl
        WHERE ${cond.join(" AND ")}
      ) _d WHERE _d._rk = 1
    `, params.slice(0, -1));

    return {
      markers: (rows.rows || []).map((row) => {
        const normalizedMoney = normalizeListingMoney({
          platformCode: row.platform_code,
          leaseType: row.lease_type,
          rawText: row.title || row.address_text || row.source_ref || row.listing_id,
          rentAmount: row.rent_amount,
          depositAmount: row.deposit_amount,
        });
        return {
          listing_id: toInt(row.listing_id, null),
          lat: toNumber(row.lat, null),
          lng: toNumber(row.lng, null),
          platform_code: safeText(row.platform_code, ""),
          rent_amount: normalizedMoney.rent_amount,
          deposit_amount: normalizedMoney.deposit_amount,
          area_m2: toNumber(row.area_m2, null),
          address_text: safeText(row.address_text, ""),
          room_count: toInt(row.room_count, null),
          floor: toInt(row.floor, null),
          building_use: safeText(row.building_use, null),
        };
      }),
      total_in_bounds: parseInt(countResult.rows?.[0]?.total || "0", 10),
    };
  });

  sendJson(res, 200, result);
}
