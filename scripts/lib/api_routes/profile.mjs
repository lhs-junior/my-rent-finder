// scripts/lib/api_routes/profile.mjs
import { withDbClient } from "../db_client.mjs";
import { sendJson } from "../api_helpers.mjs";
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
    const [profileRows, favRows] = await withDbClient(async (client) => {
      const p = await client.query(
        "SELECT my_capital, my_income, ltv_ratio, dti_limit, loan_type FROM user_profiles WHERE pin_hash = $1",
        [pinHash]
      );
      const f = await client.query(
        "SELECT listing_id FROM pin_favorites WHERE pin_hash = $1 ORDER BY added_at DESC",
        [pinHash]
      );
      return [p.rows, f.rows];
    });

    const settings = profileRows[0] || {};
    const favoriteIds = favRows.map((r) => r.listing_id);
    sendJson(res, 200, { settings, favoriteIds });
  } catch (e) {
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
  } catch (e) {
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
    const existing = await withDbClient((client) =>
      client.query(
        "SELECT 1 FROM pin_favorites WHERE pin_hash = $1 AND listing_id = $2",
        [pinHash, listingId]
      )
    );

    if (existing.rows.length > 0) {
      await withDbClient((client) =>
        client.query(
          "DELETE FROM pin_favorites WHERE pin_hash = $1 AND listing_id = $2",
          [pinHash, listingId]
        )
      );
      sendJson(res, 200, { action: "removed", listing_id: listingId });
    } else {
      await withDbClient((client) =>
        client.query(
          "INSERT INTO pin_favorites (pin_hash, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [pinHash, listingId]
        )
      );
      sendJson(res, 200, { action: "added", listing_id: listingId });
    }
  } catch (e) {
    sendJson(res, 500, { error: "DB error" });
  }
}
