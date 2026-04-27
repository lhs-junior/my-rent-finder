// scripts/lib/api_routes/profile.mjs
import { withDbClient, toInt, toNumber } from "../db_client.mjs";
import { sendJson, safeText, platformNameFromCode, parseImageMap, extractImageUrlsFromPayload } from "../api_helpers.mjs";
import { hashPin } from "../pin_hash.mjs";

const ALLOWED_SETTINGS_KEYS = new Set([
  "my_capital", "my_income", "ltv_ratio", "dti_limit", "loan_type",
]);

function getPinHash(body) {
  try {
    return hashPin(body?.pin);
  } catch {
    return null;
  }
}

// POST /api/profile/read — 내 설정 + 찜 목록 조회
export async function handleProfileRead(req, res) {
  const body = req._parsedBody || {};
  const pinHash = getPinHash(body);
  if (!pinHash) { sendJson(res, 401, { error: "PIN required" }); return; }

  try {
    const [profileRows, favRows, scoreRows] = await withDbClient(async (client) => {
      // 비인증(__anon__) 찜을 현재 사용자 pin_hash로 병합 (최초 로그인 시 1회성)
      await client.query(
        `INSERT INTO pin_favorites (pin_hash, listing_id, added_at)
         SELECT $1, listing_id, added_at FROM pin_favorites WHERE pin_hash = '__anon__'
         ON CONFLICT DO NOTHING`,
        [pinHash]
      );

      const p = await client.query(
        "SELECT my_capital, my_income, ltv_ratio, dti_limit, loan_type FROM user_profiles WHERE pin_hash = $1",
        [pinHash]
      );
      const f = await client.query(
        `SELECT pf.listing_id, pf.grade FROM pin_favorites pf
         JOIN normalized_listings nl ON nl.listing_id = pf.listing_id
         WHERE pf.pin_hash = $1 AND nl.deleted_at IS NULL
         ORDER BY pf.added_at DESC`,
        [pinHash]
      );
      const s = await client.query(
        `SELECT sl.listing_id, sl.grade, sl.total_score, sl.effective_monthly_cost
         FROM scored_listings sl
         JOIN normalized_listings nl ON nl.listing_id = sl.listing_id
         WHERE nl.deleted_at IS NULL AND sl.grade IN ('SS','S','A')
         ORDER BY sl.total_score DESC`
      );
      return [p.rows, f.rows, s.rows];
    });

    const settings = profileRows[0] || {};
    const favoriteIds = favRows.map((r) => r.listing_id);
    const favoriteGrades = Object.fromEntries(
      favRows.filter((r) => r.grade).map((r) => [r.listing_id, r.grade])
    );
    const scoredGrades = Object.fromEntries(
      scoreRows.map((r) => [r.listing_id, r.grade])
    );
    sendJson(res, 200, { settings, favoriteIds, favoriteGrades, scoredGrades });
  } catch {
    sendJson(res, 500, { error: "DB error" });
  }
}

// POST /api/profile/settings — 설정 저장
export async function handleProfileSettings(req, res) {
  const body = req._parsedBody || {};
  const pinHash = getPinHash(body);
  if (!pinHash) { sendJson(res, 401, { error: "PIN required" }); return; }

  const { key, value } = body;
  if (!ALLOWED_SETTINGS_KEYS.has(key)) {
    sendJson(res, 400, { error: `Invalid key: ${key}` });
    return;
  }

  try {
    await withDbClient((client) =>
      client.query(
        `INSERT INTO user_profiles (pin_hash, ${key}, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (pin_hash) DO UPDATE SET ${key} = $2, updated_at = NOW()`,
        [pinHash, String(value)]
      )
    );
    sendJson(res, 200, { ok: true });
  } catch {
    sendJson(res, 500, { error: "DB error" });
  }
}

// POST /api/profile/favorites — PIN 찜 목록 상세 조회
export async function handleProfileFavorites(req, res) {
  const body = req._parsedBody || {};
  const pinHash = getPinHash(body);
  if (!pinHash) { sendJson(res, 401, { error: "PIN required" }); return; }

  const sort = typeof body?.sort === "string" ? body.sort.trim() : "";
  const orderBy = sort === "newest"
    ? "nl.deleted_at NULLS FIRST, nl.listed_at DESC NULLS LAST, pf.added_at DESC"
    : "nl.deleted_at NULLS FIRST, pf.added_at DESC";

  try {
    const result = await withDbClient(async (client) => {
      const rows = await client.query(`
        SELECT pf.added_at AS favorited_at, pf.grade,
               nl.listing_id, nl.platform_code, nl.source_url, nl.external_id,
               nl.title, nl.lease_type, nl.rent_amount, nl.deposit_amount,
               nl.area_exclusive_m2, nl.area_gross_m2, nl.address_text, nl.address_code,
               nl.room_count, nl.bathroom_count, nl.floor, nl.total_floor, nl.direction, nl.building_use,
               nl.building_year, nl.description_text,
               nl.monthly_management_cost, nl.walk_time_to_subway, nl.parking_possible,
               nl.lat, nl.lng, nl.quality_flags, nl.listed_at, nl.created_at,
               nl.nearest_subway_station, nl.nearest_subway_line,
               nl.subway_distance_m, nl.subway_walk_min,
               rl.payload_json,
               nl.deleted_at IS NOT NULL AS is_expired
        FROM pin_favorites pf
        JOIN normalized_listings nl ON nl.listing_id = pf.listing_id
        JOIN raw_listings rl ON rl.raw_id = nl.raw_id
        WHERE pf.pin_hash = $1
        ORDER BY ${orderBy}
      `, [pinHash]);

      const listingIds = rows.rows.map((r) => toInt(r.listing_id, null)).filter(Boolean);
      const imageRows = listingIds.length
        ? await client.query(
            `SELECT listing_id, COUNT(*) AS image_count FROM listing_images WHERE listing_id = ANY($1) GROUP BY listing_id`,
            [listingIds],
          )
        : { rows: [] };
      const imageMap = parseImageMap(imageRows.rows || []);

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
        const fallbackImageUrls = extractImageUrlsFromPayload(row.payload_json);
        return {
          favorited_at: row.favorited_at ? new Date(row.favorited_at).toISOString() : null,
          grade: row.grade || null,
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
          is_expired: row.is_expired === true,
          image_count: Number(imageMap.get(listingId) || fallbackImageUrls.length || 0),
          first_image_url: firstImageMap.get(listingId) || fallbackImageUrls[0] || null,
          listed_at: safeText(row.listed_at, null),
          nearest_subway_station: safeText(row.nearest_subway_station, null),
          nearest_subway_line: safeText(row.nearest_subway_line, null),
          subway_distance_m: toInt(row.subway_distance_m, null),
          subway_walk_min: toInt(row.subway_walk_min, null),
          created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
        };
      });
    });

    sendJson(res, 200, { items: result, total: result.length });
  } catch {
    sendJson(res, 500, { error: "DB error" });
  }
}

// POST /api/profile/favorites/toggle — 찜 추가/제거
export async function handleProfileFavoriteToggle(req, res) {
  const body = req._parsedBody || {};
  const pinHash = getPinHash(body);
  if (!pinHash) { sendJson(res, 401, { error: "PIN required" }); return; }

  const listingId = parseInt(body.listing_id, 10);
  if (!Number.isFinite(listingId) || listingId <= 0) {
    sendJson(res, 400, { error: "listing_id required" });
    return;
  }

  try {
    const action = await withDbClient(async (client) => {
      await client.query("BEGIN");
      try {
        const del = await client.query(
          "DELETE FROM pin_favorites WHERE pin_hash = $1 AND listing_id = $2 RETURNING listing_id",
          [pinHash, listingId]
        );
        if (del.rowCount > 0) {
          await client.query("COMMIT");
          return "removed";
        }
        await client.query(
          "INSERT INTO pin_favorites (pin_hash, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [pinHash, listingId]
        );
        await client.query("COMMIT");
        return "added";
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    });
    sendJson(res, 200, { action, listing_id: listingId });
  } catch {
    sendJson(res, 500, { error: "DB error" });
  }
}
