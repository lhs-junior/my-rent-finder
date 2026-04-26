import { toInt, toNumber, withDbClient } from "../db_client.mjs";
import { safeText, sendJson, platformNameFromCode, parseImageMap, extractImageUrlsFromPayload } from "../api_helpers.mjs";

const ANON_PIN_HASH = "__anon__";

// ---------------------------------------------------------------------------
// GET /api/favorites — list all favorites with listing details
// ---------------------------------------------------------------------------

export async function handleFavorites(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const sort = (url.searchParams.get("sort") || "").trim();
    // 만료된 찜 매물은 항상 맨 뒤로, 유효 매물 내에서 정렬
    const orderBy = sort === "newest"
      ? "nl.deleted_at NULLS FIRST, nl.listed_at DESC NULLS LAST, pf.added_at DESC"
      : "nl.deleted_at NULLS FIRST, pf.added_at DESC";

    const result = await withDbClient(async (client) => {
      const rows = await client.query(`
        SELECT pf.listing_id, pf.added_at AS favorited_at, pf.grade,
               nl.platform_code, nl.source_url, nl.external_id,
               nl.title, nl.lease_type, nl.rent_amount, nl.deposit_amount,
               nl.area_exclusive_m2, nl.area_gross_m2, nl.address_text, nl.address_code,
               nl.room_count, nl.bathroom_count, nl.floor, nl.total_floor, nl.direction, nl.building_use,
               nl.building_year, nl.description_text,
               nl.monthly_management_cost, nl.walk_time_to_subway, nl.parking_possible,
               nl.lat, nl.lng, nl.quality_flags, nl.listed_at, nl.created_at,
               nl.nearest_subway_station, nl.nearest_subway_line,
               nl.subway_distance_m, nl.subway_walk_min,
               nl.deleted_at,
               rl.payload_json
        FROM pin_favorites pf
        JOIN normalized_listings nl ON nl.listing_id = pf.listing_id
        JOIN raw_listings rl ON rl.raw_id = nl.raw_id
        WHERE pf.pin_hash = $1
        ORDER BY ${orderBy}
      `, [ANON_PIN_HASH]);

      const listingIds = rows.rows.map((r) => toInt(r.listing_id, null)).filter(Boolean);
      const [imageRows, firstImageRows] = listingIds.length
        ? await Promise.all([
            client.query(
              `SELECT listing_id, COUNT(*) AS image_count FROM listing_images WHERE listing_id = ANY($1) GROUP BY listing_id`,
              [listingIds],
            ),
            client.query(
              `SELECT DISTINCT ON (listing_id) listing_id, source_url
               FROM listing_images
               WHERE listing_id = ANY($1) AND source_url IS NOT NULL AND source_url != ''
               ORDER BY listing_id, is_primary DESC, image_id ASC`,
              [listingIds],
            ),
          ])
        : [{ rows: [] }, { rows: [] }];
      const imageMap = parseImageMap(imageRows.rows || []);
      const firstImageMap = new Map();
      for (const row of firstImageRows.rows || []) {
        const lid = toInt(row.listing_id, null);
        if (lid !== null) firstImageMap.set(lid, row.source_url);
      }

      return rows.rows.map((row) => {
        const listingId = toInt(row.listing_id, null);
        const fallbackImageUrls = extractImageUrlsFromPayload(row.payload_json);
        return {
          favorite_id: listingId,
          memo: null,
          favorited_at: row.favorited_at ? new Date(row.favorited_at).toISOString() : null,
          listing_id: listingId,
          platform_code: safeText(row.platform_code, ""),
          platform: platformNameFromCode(safeText(row.platform_code, "")),
          source_url: safeText(row.source_url, ""),
          external_id: safeText(row.external_id, ""),
          title: safeText(row.title, ""),
          lease_type: safeText(row.lease_type, "기타"),
          rent_amount: toNumber(row.rent_amount, null),
          deposit_amount: toNumber(row.deposit_amount, null),
          area_exclusive_m2: toNumber(row.area_exclusive_m2, null),
          area_gross_m2: toNumber(row.area_gross_m2, null),
          address_text: safeText(row.address_text, ""),
          address_code: safeText(row.address_code, ""),
          room_count: toInt(row.room_count, null),
          bathroom_count: toInt(row.bathroom_count, null),
          floor: toInt(row.floor, null),
          total_floor: toInt(row.total_floor, null),
          direction: safeText(row.direction, null),
          building_use: safeText(row.building_use, null),
          building_year: toInt(row.building_year, null),
          description_text: safeText(row.description_text, null),
          monthly_management_cost: toInt(row.monthly_management_cost, null),
          walk_time_to_subway: toInt(row.walk_time_to_subway, null),
          parking_possible: row.parking_possible ?? null,
          lat: toNumber(row.lat, null),
          lng: toNumber(row.lng, null),
          image_count: Number(imageMap.get(listingId) || fallbackImageUrls.length || 0),
          first_image_url: firstImageMap.get(listingId) || fallbackImageUrls[0] || null,
          listed_at: safeText(row.listed_at, null),
          nearest_subway_station: safeText(row.nearest_subway_station, null),
          nearest_subway_line: safeText(row.nearest_subway_line, null),
          subway_distance_m: toInt(row.subway_distance_m, null),
          subway_walk_min: toInt(row.subway_walk_min, null),
          created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
          is_expired: row.deleted_at != null,
        };
      });
    });

    sendJson(res, 200, { items: result, total: result.length });
  } catch (e) {
    console.error("[favorites] error:", e.message);
    sendJson(res, 500, { error: "DB error" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/favorites/ids — just listing_id set (for quick frontend lookup)
// ---------------------------------------------------------------------------

export async function handleFavoriteIds(req, res) {
  try {
    const result = await withDbClient(async (client) => {
      const rows = await client.query(`
        SELECT pf.listing_id
        FROM pin_favorites pf
        JOIN normalized_listings nl ON nl.listing_id = pf.listing_id
        WHERE pf.pin_hash = $1
      `, [ANON_PIN_HASH]);
      return rows.rows.map((r) => toInt(r.listing_id, null)).filter(Boolean);
    });

    sendJson(res, 200, { ids: result });
  } catch (e) {
    console.error("[favorites/ids] error:", e.message);
    sendJson(res, 500, { error: "DB error" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/favorites — add favorite
// body: { listing_id, memo? }
// ---------------------------------------------------------------------------

export async function handleAddFavorite(req, res) {
  const body = req._parsedBody;
  if (!body || !body.listing_id) {
    sendJson(res, 400, { error: "listing_id_required" });
    return;
  }

  const listingId = toInt(body.listing_id, null);
  if (!listingId) {
    sendJson(res, 400, { error: "invalid_listing_id" });
    return;
  }

  try {
    const result = await withDbClient(async (client) => {
      const check = await client.query(
        `SELECT listing_id FROM normalized_listings WHERE listing_id = $1 AND deleted_at IS NULL`,
        [listingId],
      );
      if (!check.rows.length) return { error: "listing_not_found" };

      await client.query(
        `INSERT INTO pin_favorites (pin_hash, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [ANON_PIN_HASH, listingId],
      );
      return { listing_id: listingId };
    });

    if (result?.error) {
      sendJson(res, 404, { error: result.error });
      return;
    }

    sendJson(res, 200, {
      favorite_id: result.listing_id,
      listing_id: result.listing_id,
    });
  } catch (e) {
    console.error("[favorites/add] error:", e.message);
    sendJson(res, 500, { error: "DB error" });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/favorites/:listing_id — remove favorite
// ---------------------------------------------------------------------------

export async function handleRemoveFavorite(req, res, listingId) {
  const id = toInt(listingId, null);
  if (!id) {
    sendJson(res, 400, { error: "invalid_listing_id" });
    return;
  }

  try {
    const deleted = await withDbClient(async (client) => {
      const result = await client.query(
        `DELETE FROM pin_favorites WHERE pin_hash = $1 AND listing_id = $2 RETURNING listing_id`,
        [ANON_PIN_HASH, id],
      );
      return result.rowCount > 0;
    });

    sendJson(res, 200, { deleted, listing_id: id });
  } catch (e) {
    console.error("[favorites/remove] error:", e.message);
    sendJson(res, 500, { error: "DB error" });
  }
}
