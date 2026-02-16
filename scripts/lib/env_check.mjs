const REQUIRED_VARS = ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"];

export function validateEnv(_options = {}) {
  const missing = [];
  const warnings = [];

  // Check if DATABASE_URL is set as alternative
  if (process.env.DATABASE_URL) {
    return { ok: true, missing: [], warnings: ["Using DATABASE_URL instead of individual PG* vars"] };
  }

  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  // Optional warnings
  if (!process.env.PGPORT) {
    warnings.push("PGPORT not set, defaulting to 5432");
  }

  if (missing.length > 0) {
    return { ok: false, missing, warnings };
  }
  return { ok: true, missing: [], warnings };
}

export function requireEnv() {
  const result = validateEnv();
  if (!result.ok) {
    console.error("\u274C \uD658\uACBD\uBCC0\uC218 \uB204\uB77D:");
    for (const key of result.missing) {
      console.error(`  - ${key}`);
    }
    console.error("\n.env \uD30C\uC77C\uC744 \uC0DD\uC131\uD558\uAC70\uB098 \uD658\uACBD\uBCC0\uC218\uB97C \uC124\uC815\uD558\uC138\uC694.");
    console.error("\uCC38\uACE0: .env.example");
    process.exit(1);
  }
  for (const w of result.warnings) {
    console.warn(`\u26A0 ${w}`);
  }
  return result;
}
