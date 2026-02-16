import { getDbConfig, withDbClient } from "../db_client.mjs";
import { sendJson } from "../api_helpers.mjs";

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

export async function handleHealth(_req, res) {
  const db = await resolveDbHealth();
  sendJson(res, 200, { ok: true, ts: new Date().toISOString(), db });
}
