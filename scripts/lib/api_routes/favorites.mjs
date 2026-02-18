import { toInt, toNumber, withDbClient } from "../db_client.mjs";
import { safeText, sendJson, platformNameFromCode, parseImageMap } from "../api_helpers.mjs";

// ---------------------------------------------------------------------------
// GET /api/favorites — list all favorites with listing details
// ---------------------------------------------------------------------------

export async function handleFavorites(req, res) {
  const result = await withDbClient(async (client) => {
    const rows = await client.query(`
      SELECT uf.favorite_id, uf.memo, uf.created_at AS favorited_at,
             nl.listing_id, nl.platform_code, nl.source_url, nl.external_id,
             nl.title, nl.lease_type, nl.rent_amount, nl.deposit_amount,
             nl.area_exclusive_m2, nl.area_gross_m2, nl.address_text, nl.address_code,
             nl.room_count, nl.floor, nl.total_floor, nl.direction, nl.building_use,
             nl.lat, nl.lng, nl.quality_flags, nl.created_at
      FROM user_favorites uf
      JOIN normalized_listings nl ON nl.listing_id = uf.listing_id
      WHERE nl.deleted_at IS NULL
      ORDER BY uf.created_at DESC
    `);

    const listingIds = rows.rows.map((r) => toInt(r.listing_id, null)).filter(Boolean);
    const imageRows = listingIds.length
      ? await client.query(
          `SELECT listing_id, COUNT(*) AS image_count FROM listing_images WHERE listing_id = ANY($1) GROUP BY listing_id`,
          [listingIds],
        )
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

    return rows.rows.map((row) => {
      const listingId = toInt(row.listing_id, null);
      return {
        favorite_id: toInt(row.favorite_id, null),
        memo: safeText(row.memo, null),
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
        floor: toInt(row.floor, null),
        total_floor: toInt(row.total_floor, null),
        direction: safeText(row.direction, null),
        building_use: safeText(row.building_use, null),
        lat: toNumber(row.lat, null),
        lng: toNumber(row.lng, null),
        image_count: Number(imageMap.get(listingId) || 0),
        first_image_url: firstImageMap.get(listingId) || null,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      };
    });
  });

  sendJson(res, 200, { items: result, total: result.length });
}

// ---------------------------------------------------------------------------
// GET /api/favorites/ids — just listing_id set (for quick frontend lookup)
// ---------------------------------------------------------------------------

export async function handleFavoriteIds(req, res) {
  const result = await withDbClient(async (client) => {
    const rows = await client.query(`
      SELECT uf.listing_id
      FROM user_favorites uf
      JOIN normalized_listings nl ON nl.listing_id = uf.listing_id
      WHERE nl.deleted_at IS NULL
    `);
    return rows.rows.map((r) => toInt(r.listing_id, null)).filter(Boolean);
  });

  sendJson(res, 200, { ids: result });
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

  const memo = safeText(body.memo, null);

  const result = await withDbClient(async (client) => {
    // Check listing exists
    const check = await client.query(
      `SELECT listing_id FROM normalized_listings WHERE listing_id = $1 AND deleted_at IS NULL`,
      [listingId],
    );
    if (!check.rows.length) return { error: "listing_not_found" };

    const row = await client.query(
      `INSERT INTO user_favorites (listing_id, memo)
       VALUES ($1, $2)
       ON CONFLICT (listing_id) DO UPDATE SET memo = COALESCE(EXCLUDED.memo, user_favorites.memo)
       RETURNING favorite_id, listing_id, memo, created_at`,
      [listingId, memo],
    );
    return row.rows[0];
  });

  if (result?.error) {
    sendJson(res, 404, { error: result.error });
    return;
  }

  sendJson(res, 200, {
    favorite_id: toInt(result.favorite_id, null),
    listing_id: toInt(result.listing_id, null),
    memo: safeText(result.memo, null),
    created_at: result.created_at ? new Date(result.created_at).toISOString() : null,
  });
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

  const deleted = await withDbClient(async (client) => {
    const result = await client.query(
      `DELETE FROM user_favorites WHERE listing_id = $1 RETURNING favorite_id`,
      [id],
    );
    return result.rowCount > 0;
  });

  sendJson(res, 200, { deleted, listing_id: id });
}
