// scripts/lib/api_routes/settings.mjs
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { withDbClient } from "../db_client.mjs";
import { sendJson } from "../api_helpers.mjs";

const scryptAsync = promisify(scrypt);

async function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  const buf = await scryptAsync(pin, salt, 32);
  return `${salt}:${buf.toString("hex")}`;
}

async function verifyPin(pin, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const buf = await scryptAsync(pin, salt, 32);
  const storedBuf = Buffer.from(hash, "hex");
  return timingSafeEqual(buf, storedBuf);
}

async function hasPinConfigured() {
  if (process.env.SETTINGS_PIN) return true;
  try {
    const rows = await withDbClient((client) =>
      client.query("SELECT 1 FROM user_settings WHERE key = '_system_pin' LIMIT 1")
    );
    return rows.rows.length > 0;
  } catch {
    return false;
  }
}

async function resolveAndValidatePin(inputPin) {
  if (!inputPin) return false;
  // Priority 1: env var (plaintext, backward compatible)
  const envPin = process.env.SETTINGS_PIN;
  if (envPin) return inputPin === envPin;
  // Priority 2: DB-stored hash
  try {
    const rows = await withDbClient((client) =>
      client.query("SELECT value FROM user_settings WHERE key = '_system_pin' LIMIT 1")
    );
    if (!rows.rows.length) return false;
    return verifyPin(inputPin, rows.rows[0].value);
  } catch {
    return false;
  }
}

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
  const body = req._parsedBody || {};

  const parsedUrl = new URL(req.url || "", "http://localhost");
  const pathname = parsedUrl.pathname;

  // GET /api/settings/has-pin — no auth required
  if (req.method === "GET" && pathname === "/api/settings/has-pin") {
    const configured = await hasPinConfigured();
    sendJson(res, 200, { configured });
    return;
  }

  // POST /api/settings/init-pin — only if no PIN exists
  if (req.method === "POST" && pathname === "/api/settings/init-pin") {
    const alreadySet = await hasPinConfigured();
    if (alreadySet) {
      sendJson(res, 409, { error: "PIN already configured" });
      return;
    }
    const { pin } = body;
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      sendJson(res, 400, { error: "PIN must be 4-6 digits" });
      return;
    }
    const hashed = await hashPin(pin);
    try {
      await withDbClient((client) =>
        client.query(
          `INSERT INTO user_settings (key, value, updated_at)
           VALUES ('_system_pin', $1, NOW())
           ON CONFLICT (key) DO NOTHING`,
          [hashed]
        )
      );
    } catch (e) {
      sendJson(res, 500, { error: "Database error" });
      return;
    }
    // Verify it was actually inserted (race condition guard)
    const confirmed = await hasPinConfigured();
    if (!confirmed) {
      sendJson(res, 409, { error: "PIN already set by concurrent request" });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  // POST /api/settings/read — 설정 조회
  if (req.method === "POST" && pathname === "/api/settings/read") {
    if (!(await resolveAndValidatePin(body.pin))) {
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
    const settings = Object.fromEntries(
      rows.rows
        .filter((r) => r.key !== "_system_pin")
        .map((r) => [r.key, r.value])
    );
    sendJson(res, 200, { settings });
    return;
  }

  // POST /api/settings — 설정 저장
  if (req.method === "POST") {
    if (!(await resolveAndValidatePin(body.pin))) {
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
