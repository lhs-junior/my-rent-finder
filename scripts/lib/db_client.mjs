#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

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
    const cfg = { connectionString: process.env.DATABASE_URL };
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

export function createClient() {
  return new Client(getDbConfig());
}

export async function withDbClient(handler) {
  const client = createClient();
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

export function sanitizeIdentifier(name, fallback = "value") {
  return toText(name, fallback).replace(/[^a-zA-Z0-9_\-]/g, "_");
}

export function platformNameFromCode(code) {
  const names = {
    naver: "네이버 부동산",
    zigbang: "직방",
    dabang: "다방",
    r114: "부동산114",
    peterpanz: "피터팬",
    daangn: "당근부동산",
    kbland: "KB부동산",
  };
  return names[normalizePlatform(code)] || toText(code, "unknown");
}

export const DB_CONNECTION_KEYS = DB_ENV_KEYS;

export { toSafeString, toSafeNumber, toSafePath };
