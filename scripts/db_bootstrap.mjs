#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

import { getDbConfig, toSafeNumber, toSafeString } from "./lib/db_client.mjs";

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.findIndex((v) => v === name || v.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=");
}

function hasArg(name) {
  return args.some((v) => v === name || v.startsWith(`${name}=`));
}

function parseBool(value, fallback = false) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(raw)) return true;
  if (["0", "false", "no", "off", "n"].includes(raw)) return false;
  return fallback;
}

function parseBoolArg(name, fallback = false) {
  if (!hasArg(name)) return fallback;
  return parseBool(getArg(name, "true"), fallback);
}

function quoteIdent(name) {
  const safe = String(name || "").replace(/"/g, "\\\"");
  return `"${safe}"`;
}

function quoteLiteral(value) {
  const safe = String(value || "").replace(/'/g, "''");
  return `'${safe}'`;
}

function readSql(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQL file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    throw new Error(`SQL file is empty: ${filePath}`);
  }
  return raw;
}

async function dbExists(adminClient, databaseName) {
  const result = await adminClient.query(
    `SELECT 1 FROM pg_database WHERE datname = $1 LIMIT 1`,
    [databaseName],
  );
  return result.rowCount > 0;
}

function isDbMissingError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("does not exist") && message.includes("database");
}

async function runSqlBlock(dbClient, sql, label) {
  if (!sql || !sql.trim()) {
    console.log(`[DB bootstrap] ${label}: skip (empty)`);
    return;
  }
  await dbClient.query(sql);
  console.log(`[DB bootstrap] ${label}: applied`);
}

async function ensureLegacyMigrations(dbClient) {
  await dbClient.query(`ALTER TABLE IF EXISTS collection_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await dbClient.query(`ALTER TABLE IF EXISTS raw_listings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await dbClient.query(`ALTER TABLE IF EXISTS normalized_listings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await dbClient.query(`ALTER TABLE IF EXISTS normalized_listings ADD COLUMN IF NOT EXISTS direction TEXT`);
  await dbClient.query(`ALTER TABLE IF EXISTS normalized_listings ADD COLUMN IF NOT EXISTS building_use TEXT`);
}

async function createDatabase(adminClient, databaseName, owner) {
  const ownerClause = owner ? ` OWNER ${quoteIdent(owner)}` : "";
  await adminClient.query(`CREATE DATABASE ${quoteIdent(databaseName)}${ownerClause}`);
  console.log(`[DB bootstrap] database created: ${databaseName}`);
}

async function ensureRole(adminClient, roleName, password) {
  const role = toSafeString(roleName, null);
  if (!role) return;

  const existing = await adminClient.query(
    `SELECT 1 FROM pg_roles WHERE rolname = $1 LIMIT 1`,
    [role],
  );
  const pwd = toSafeString(password, null);
  const quotedRole = quoteIdent(role);

  if (existing.rowCount > 0) {
    if (pwd) {
      await adminClient.query(`ALTER ROLE ${quotedRole} WITH LOGIN PASSWORD ${quoteLiteral(pwd)}`);
    }
    return;
  }

  if (!pwd) {
    throw new Error(`role '${role}' does not exist and no password was provided`);
  }
  await adminClient.query(
    `CREATE ROLE ${quotedRole} LOGIN PASSWORD ${quoteLiteral(pwd)}`,
  );
  console.log(`[DB bootstrap] role created: ${role}`);
}

async function grantAppPrivileges(adminClient, databaseName, appUser, schemaOwnerUser) {
  const targetRole = toSafeString(appUser, null);
  if (!targetRole) return;

  const quotedRole = quoteIdent(targetRole);
  const quotedDb = quoteIdent(databaseName);
  const schemaOwner = toSafeString(schemaOwnerUser, null);
  const ownerClause = schemaOwner ? `FOR ROLE ${quoteIdent(schemaOwner)}` : "";

  await adminClient.query(`GRANT CONNECT ON DATABASE ${quotedDb} TO ${quotedRole}`);
  await adminClient.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`);
  await adminClient.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${quotedRole}`);
  await adminClient.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole}`);
  await adminClient.query(`GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO ${quotedRole}`);

  await adminClient.query(
    `ALTER DEFAULT PRIVILEGES ${ownerClause} IN SCHEMA public ` +
    `GRANT ALL PRIVILEGES ON TABLES TO ${quotedRole}`,
  );
  await adminClient.query(
    `ALTER DEFAULT PRIVILEGES ${ownerClause} IN SCHEMA public ` +
    `GRANT ALL PRIVILEGES ON SEQUENCES TO ${quotedRole}`,
  );
  await adminClient.query(
    `ALTER DEFAULT PRIVILEGES ${ownerClause} IN SCHEMA public ` +
    `GRANT ALL PRIVILEGES ON FUNCTIONS TO ${quotedRole}`,
  );
  console.log(`[DB bootstrap] privileges granted to ${targetRole} on ${databaseName}`);
}

function getAdminDbConfig(cfg) {
  const adminUser = toSafeString(process.env.PGADMIN_USER, null);
  if (!adminUser) return cfg;
  return {
    ...cfg,
    user: adminUser,
    password: toSafeString(process.env.PGADMIN_PASSWORD, cfg.password),
    host: toSafeString(process.env.PGADMIN_HOST, cfg.host),
    port: toSafeNumber(process.env.PGADMIN_PORT, cfg.port),
    database: toSafeString(process.env.PGADMIN_DATABASE, cfg.database),
  };
}

async function main() {
  if (hasArg("--help") || hasArg("-h")) {
    console.log(`Usage:
  node scripts/db_bootstrap.mjs [--database=my_rent_finder] [--seed]

Options:
  --seed             Insert sample seed data (db_dml_seed.sql)
  --skip-seed        Skip inserting sample seed data (default)
  --skip-schema      Skip schema execution (schema_v1.sql)
  --schema=<path>    Override schema SQL path
  --seed-file=<path> Override seed SQL path
  --database=<name>  Target database name
  --help, -h         Show this help
`);
    return;
  }

  const cfg = getDbConfig();
  const database = getArg("--database", cfg.database || "my_rent_finder");
  const seed = parseBoolArg("--seed", false);
  const skipSeed = parseBoolArg("--skip-seed", false);
  const shouldSeed = skipSeed ? false : seed;
  const skipSchema = hasArg("--skip-schema");

  const schemaPath = path.resolve(
    process.cwd(),
    getArg("--schema", path.join("db", "schema_v1.sql")),
  );
  const seedPath = path.resolve(
    process.cwd(),
    getArg("--seed-file", path.join("scripts", "db_dml_seed.sql")),
  );

  const adminBaseConfig = getAdminDbConfig(cfg);
  const adminConfig = {
    ...adminBaseConfig,
    database: "postgres",
  };

  const ensureDatabase = async () => {
    const admin = new Client(adminConfig);
    try {
      await admin.connect();
      await ensureRole(admin, cfg.user, cfg.password);
      const exists = await dbExists(admin, database);
      if (!exists) {
        console.log(`[DB bootstrap] database not found, create: ${database}`);
        await createDatabase(admin, database, cfg.user);
      } else {
        console.log(`[DB bootstrap] database exists: ${database}`);
      }
    } finally {
      await admin.end().catch(() => {});
    }
  };

  try {
    await ensureDatabase();
  } catch (error) {
    if (!cfg.host || !cfg.user) {
      throw new Error(`DB admin connection failed: ${error?.message || error}`);
    }
    if (isDbMissingError(error)) {
      throw new Error(`database not available yet: ${database}. Check PG service: ${error?.message || error}`);
    }
    throw error;
  }

  const targetConfig = {
    ...adminBaseConfig,
    database,
  };

  const dbClient = new Client(targetConfig);
  try {
    await dbClient.connect();
    if (!skipSchema) {
      const schemaSql = readSql(schemaPath);
      await runSqlBlock(dbClient, schemaSql, `schema ${schemaPath}`);
    }

    if (shouldSeed) {
      const seedSql = readSql(seedPath);
      await runSqlBlock(dbClient, seedSql, `seed ${seedPath}`);
    }
    await ensureLegacyMigrations(dbClient);
    await grantAppPrivileges(dbClient, database, cfg.user, adminBaseConfig.user);

    console.log(`[DB bootstrap] done. db=${database}`);
  } finally {
    await dbClient.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[DB bootstrap] failed: ${error?.message || error}`);
  process.exit(1);
});
