#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const DB_ENV_KEYS = [
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
];
const DB_OVERRIDE_KEYS = new Set([
  ...DB_ENV_KEYS,
  "DATABASE_URL",
  "PGHOST_PORT",
]);

function shouldSetEnvVar(key) {
  if (DB_OVERRIDE_KEYS.has(key)) return true;
  return !(key in process.env);
}

function loadLocalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.indexOf("=");
      if (sep <= 0) continue;
      const key = trimmed.slice(0, sep).trim();
      let value = trimmed.slice(sep + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (shouldSetEnvVar(key)) {
        process.env[key] = value;
      }
    }
  } catch {
    // environment file is optional; skip on parse/read failure
  }
}

function loadProjectEnv() {
  const cwd = process.cwd();
  loadLocalEnvFile(path.resolve(cwd, ".env"));
  loadLocalEnvFile(path.resolve(cwd, ".env.local"));
}

loadProjectEnv();

function toSafeString(v, fallback = null) {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length > 0 ? s : fallback;
}

function toSafeNumber(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toSafePath(v, fallback = null) {
  if (!v) return fallback;
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  return s.length > 0 ? s : fallback;
}

export function toText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : fallback;
}

export function toNumber(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const raw = String(value).trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  return fallback;
}

export function toInt(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const raw = String(value).trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.trunc(n);
  return fallback;
}

export function toBool(value, fallback = false) {
  if (value === null || value === undefined) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y", "ok"].includes(raw)) return true;
  if (["0", "false", "no", "off", "n", "skip", "nok"].includes(raw)) return false;
  return fallback;
}

export function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  const s = value.trim();
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function normalizePlatform(raw) {
  return toText(raw, "unknown").toLowerCase().split(":")[0];
}

export function normalizeLeaseType(raw) {
  const v = toText(raw, "월세").toLowerCase();
  if (/전세|jeonse/.test(v)) return "전세";
  if (/단기|day|short/.test(v)) return "단기";
  if (/월세|rent|wolse/.test(v)) return "월세";
  if (/매매|sale|a1/.test(v)) return "매매";
  return "기타";
}

function hasKoreanBoundaryToken(value, token) {
  const normalized = String(value || "").toLowerCase();
  if (!normalized) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundaryRe = new RegExp(`(^|[^가-힣a-z0-9])${escaped}(?=$|[^가-힣a-z0-9])`, "i");
  return boundaryRe.test(` ${normalized} `);
}

export function normalizeAreaClaimed(raw) {
  const normalized = toText(raw, "").trim().toLowerCase();

  if (!normalized) {
    return "estimated";
  }

  if (normalized === "exclusive" || /(?:^|[^a-z])exclusive(?:$|[^a-z])/i.test(normalized)
    || hasKoreanBoundaryToken(normalized, "전용")
    || hasKoreanBoundaryToken(normalized, "전용면적")
    || hasKoreanBoundaryToken(normalized, "실면적")
    || /실\s*면적/.test(normalized)
  ) {
    return "exclusive";
  }

  if (normalized === "gross" || /\bgross\b/i.test(normalized)
    || hasKoreanBoundaryToken(normalized, "공급")
    || hasKoreanBoundaryToken(normalized, "연면적")
    || hasKoreanBoundaryToken(normalized, "건물면적")
    || hasKoreanBoundaryToken(normalized, "총면적")
    || /실제\s*면적/.test(normalized)
  ) {
    return "gross";
  }

  if (normalized === "range" || /\brange\b/i.test(normalized)
    || hasKoreanBoundaryToken(normalized, "범위")
  ) {
    return "range";
  }

  if (normalized === "estimated" || /estimated/i.test(normalized)
    || hasKoreanBoundaryToken(normalized, "추정")
    || hasKoreanBoundaryToken(normalized, "대략")
  ) {
    return "estimated";
  }

  return "estimated";
}

export function ensureFnv11(value) {
  const base = toText(value, "");
  if (!base) return null;
  let acc = 2166136261 >>> 0;
  for (let i = 0; i < base.length; i += 1) {
    acc ^= base.charCodeAt(i);
    acc = Math.imul(acc, 16777619);
  }
  return `11${String((acc >>> 0) % 900000000).padStart(9, "0")}`;
}

function isFiniteDate(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function normalizeDate(value) {
  const ts = isFiniteDate(value);
  if (ts === null) return new Date().toISOString();
  return new Date(ts).toISOString();
}

export function getDbConfig() {
  if (toSafeString(process.env.DATABASE_URL)) {
    // When using DATABASE_URL, clear PG* env vars that conflict with connectionString.
    // pg library reads PGHOST/PGPORT from process.env even when connectionString is provided.
    for (const key of ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"]) {
      delete process.env[key];
    }
    const cfg = {
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 15000,
      // 10s: dead connection을 30s 대기 대신 빠르게 감지 → withDbClient 새 커넥션 재시도 진입 단축
      query_timeout: 10000,
    };
    if (process.env.DATABASE_URL.includes("neon.tech") || process.env.DATABASE_URL.includes("sslmode=require")) {
      cfg.ssl = { rejectUnauthorized: false };
    }
    return cfg;
  }

  const cfg = {
    host: toSafeString(process.env.PGHOST, "127.0.0.1"),
    port: toSafeNumber(process.env.PGPORT, 5432),
    database: toSafeString(process.env.PGDATABASE, "my_rent_finder"),
    user: toSafeString(process.env.PGUSER, "postgres"),
  };

  const password = toSafeString(process.env.PGPASSWORD)
    || toSafeString(process.env.POSTGRES_PASSWORD)
    || "postgres";
  if (password) cfg.password = password;

  return Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== null && v !== undefined));
}

const pool = new pg.Pool({
  ...getDbConfig(),
  max: 5,
  // Neon은 ~5분 idle 후 서버 사이드에서 연결을 끊음. 그 전에 pool이 먼저 정리.
  idleTimeoutMillis: 120_000,
  // TCP keepalive로 죽은 연결을 빠르게 감지
  keepAlive: true,
  keepAliveInitialDelayMillis: 30_000,
});

pool.on("error", (err) => {
  console.error("[db] pool background error:", err.message);
});

process.on("SIGTERM", () => pool.end());

export async function withDbClient(handler) {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = await pool.connect();
    try {
      const result = await handler(client);
      client.release();
      return result;
    } catch (err) {
      // transient 에러(죽은 커넥션)는 pool에 폐기 신호 전달
      client.release(isTransientDbError(err) ? err : undefined);
      // 비-transient 에러 또는 마지막 시도: 즉시 throw
      if (!isTransientDbError(err) || attempt >= MAX_RETRIES) throw err;
      const delay = 500 * (2 ** (attempt - 1)); // 500ms, 1000ms
      console.warn(`[db] withDbClient retry ${attempt}/${MAX_RETRIES} in ${delay}ms: ${err.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "53300", // too_many_connections
  "57P01", // admin_shutdown (Neon scaledown)
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now (Neon cold start)
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment
]);

function isTransientDbError(err) {
  if (!err) return false;
  const msg = String(err.message || "").toLowerCase();
  if (msg.includes("query read timeout")) return true;
  if (msg.includes("connection terminated")) return true;
  if (msg.includes("connection reset")) return true;
  if (msg.includes("connect etimedout")) return true;
  if (msg.includes("server closed the connection unexpectedly")) return true;
  if (err.code && TRANSIENT_ERROR_CODES.has(String(err.code))) return true;
  return false;
}

// 동일 client 내 일시적 네트워크 블립 대응. 새 커넥션 재시도는 withDbClient가 담당.
export async function queryWithRetry(client, sql, params, options = {}) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const baseDelayMs = options.baseDelayMs ?? 500;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.query(sql, params);
    } catch (err) {
      if (attempt >= maxAttempts || !isTransientDbError(err)) throw err;
      const delay = baseDelayMs * (3 ** (attempt - 1));
      console.warn(`[db] transient error (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Neon cold-start 대응: persist 시작 전 DB를 깨우는 ping.
export async function warmUpDb() {
  return withDbClient((client) =>
    queryWithRetry(client, "SELECT 1", [], { maxAttempts: 5, baseDelayMs: 2000 }),
  );
}

export function sanitizeIdentifier(name, fallback = "value") {
  return toText(name, fallback).replace(/[^a-zA-Z0-9_\-]/g, "_");
}

export const DB_CONNECTION_KEYS = DB_ENV_KEYS;

export { toSafeString, toSafeNumber, toSafePath };
