#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDbConfig } from "./lib/db_client.mjs";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "db", "migrations");

const CREATE_SCHEMA_MIGRATIONS = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filename TEXT NOT NULL
);
`;

function extractVersion(filename) {
  const match = filename.match(/^(\d+)/);
  return match ? match[1] : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Read migration files sorted by name
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("[migrate] No migration files found.");
    return;
  }

  // In dry-run mode, try to connect but fall back to listing all files
  let client;
  let applied = new Set();

  try {
    client = new pg.Client(getDbConfig());
    await client.connect();
    await client.query(CREATE_SCHEMA_MIGRATIONS);
    const { rows } = await client.query("SELECT version FROM schema_migrations");
    applied = new Set(rows.map((r) => r.version));
  } catch (err) {
    if (dryRun) {
      console.log("[migrate] Dry run — no DB connection, listing all migrations:");
      for (const f of files) {
        console.log(`  - ${f}`);
      }
      console.log(`[migrate] ${files.length} migration(s) found.`);
      return;
    }
    throw err;
  }

  try {
    const pending = files.filter((f) => {
      const version = extractVersion(f);
      return version && !applied.has(version);
    });

    if (pending.length === 0) {
      console.log("[migrate] All migrations already applied.");
      return;
    }

    if (dryRun) {
      console.log("[migrate] Dry run — would apply:");
      for (const f of pending) {
        console.log(`  - ${f}`);
      }
      console.log(`[migrate] ${pending.length} migration(s) pending.`);
      return;
    }

    let appliedCount = 0;
    for (const f of pending) {
      const version = extractVersion(f);
      const filePath = path.join(MIGRATIONS_DIR, f);
      const sql = fs.readFileSync(filePath, "utf8");

      console.log(`[migrate] Applying ${f}...`);

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)",
          [version, f],
        );
        await client.query("COMMIT");
        appliedCount++;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[migrate] Failed on ${f}: ${err.message}`);
        process.exit(1);
      }
    }

    console.log(`[migrate] Done. Applied ${appliedCount} migration(s).`);
  } finally {
    if (client) {
      await client.end();
    }
  }
}

main().catch((err) => {
  console.error("[migrate] Fatal:", err.message);
  process.exit(1);
});
