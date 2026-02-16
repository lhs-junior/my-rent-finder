#!/usr/bin/env node

import { Client } from "pg";
import {
  getDbConfig,
  toSafeNumber,
  toSafeString,
} from "./lib/db_client.mjs";

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.findIndex((v) => v === name || v.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=");
}

function getInt(name, fallback) {
  const raw = getArg(name, null);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage:
  node scripts/wait_db_ready.mjs [--timeout-ms=120000] [--interval-ms=1000]

옵션:
  --timeout-ms      최대 대기 시간(ms)
  --interval-ms     재시도 간격(ms)
`);
  process.exit(0);
}

const timeoutMs = getInt("--timeout-ms", 120000);
const intervalMs = Math.max(200, getInt("--interval-ms", 1000));

const deadline = Date.now() + timeoutMs;
const baseConfig = getDbConfig();
const adminConfig = (() => {
  const adminUser = toSafeString(process.env.PGADMIN_USER, null);
  if (!adminUser) return baseConfig;
  return {
    ...baseConfig,
    user: adminUser,
    password: toSafeString(process.env.PGADMIN_PASSWORD, baseConfig.password),
    host: toSafeString(process.env.PGADMIN_HOST, baseConfig.host),
    port: toSafeNumber(process.env.PGADMIN_PORT, baseConfig.port),
    database: toSafeString(process.env.PGADMIN_DATABASE, baseConfig.database),
  };
})();
const config = {
  ...adminConfig,
  database: toSafeString(process.env.PGDATABASE, adminConfig.database),
};

let attempt = 0;
let lastError = null;

async function tryConnect() {
  attempt += 1;
  const client = new Client(config);
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } finally {
    await client.end().catch(() => {});
  }
}

(async () => {
  while (Date.now() < deadline) {
    try {
      const ok = await tryConnect();
      if (ok) {
        console.log(`[wait_db_ready] postgres is ready (attempt ${attempt})`);
        process.exit(0);
      }
    } catch (error) {
      lastError = error;
      if (Date.now() + intervalMs > deadline) break;
      await sleep(intervalMs);
    }
  }

  console.error(`[wait_db_ready] timeout after ${timeoutMs}ms (attempt ${attempt})`);
  if (lastError) {
    console.error(`[wait_db_ready] last error: ${lastError?.message || lastError}`);
  }
  process.exit(1);
})();
