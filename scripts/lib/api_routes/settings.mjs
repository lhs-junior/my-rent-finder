// scripts/lib/api_routes/settings.mjs
import { withDbClient } from "../db_client.mjs";
import { sendJson } from "../api_helpers.mjs";

const ALLOWED_KEYS = new Set([
  "my_capital", "my_income", "loan_type", "ltv_ratio", "dti_limit",
]);

export function validatePin(inputPin, serverPin) {
  if (!inputPin || !serverPin) return false;
  return inputPin === serverPin;
}

export function parseSettingsBody(body) {
  const { key, value } = body || {};
  if (!ALLOWED_KEYS.has(key)) throw new Error(`Invalid key: ${key}`);
  if (value === undefined || value === null) throw new Error("value required");
  return { key, value: String(value) };
}

export async function handleSettings(req, res) {
  const serverPin = process.env.SETTINGS_PIN;
  if (!serverPin) {
    sendJson(res, 500, { error: "SETTINGS_PIN not configured" });
    return;
  }

  const body = req._parsedBody || {};

  // POST /api/settings/read — 설정 조회
  const parsedUrl = new URL(req.url || "", "http://localhost");
  const pathname = parsedUrl.pathname;
  if (req.method === "POST" && pathname === "/api/settings/read") {
    if (!validatePin(body.pin, serverPin)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }
    let rows;
    try {
      rows = await withDbClient((client) =>
        client.query("SELECT key, value FROM user_settings ORDER BY key")
      );
    } catch (e) {
      sendJson(res, 500, { error: "Database query failed" });
      return;
    }
    const settings = Object.fromEntries(rows.rows.map((r) => [r.key, r.value]));
    sendJson(res, 200, { settings });
    return;
  }

  // POST /api/settings — 설정 저장
  if (req.method === "POST") {
    if (!validatePin(body.pin, serverPin)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }
    let parsed;
    try {
      parsed = parseSettingsBody(body);
    } catch (e) {
      sendJson(res, 400, { error: e.message });
      return;
    }
    try {
      await withDbClient((client) =>
        client.query(
          `INSERT INTO user_settings (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [parsed.key, parsed.value]
        )
      );
    } catch (e) {
      sendJson(res, 500, { error: "Database query failed" });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}
