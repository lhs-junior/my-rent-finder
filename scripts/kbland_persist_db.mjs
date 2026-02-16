#!/usr/bin/env node

/**
 * KB부동산 수집 결과 → PostgreSQL DB 저장
 *
 * 사용법:
 *   node scripts/kbland_persist_db.mjs [--summary <path>]
 *
 * --summary: kbland_capture_results.json 경로 (기본: scripts/kbland_capture_results.json)
 */

import path from "node:path";
import { persistSummaryToDb } from "./lib/ops_db_persistence.mjs";

const args = process.argv.slice(2);
function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}

const summaryPath = path.resolve(
  getArg("--summary", path.join(process.cwd(), "scripts", "kbland_capture_results.json")),
);

console.log(`📦 KB부동산 DB 저장 시작`);
console.log(`   Summary: ${summaryPath}`);

try {
  const result = await persistSummaryToDb(summaryPath);
  console.log(`\n✅ DB 저장 완료`);
  console.log(`   Run ID: ${result.runId}`);
  console.log(`   플랫폼: ${result.storedPlatforms?.join(", ") || "kbland"}`);
  console.log(`   Raw: ${result.rawCount}건`);
  console.log(`   Normalized: ${result.normalizedCount}건`);
  console.log(`   Collection Runs: ${result.collectionRuns?.length || 0}건`);
} catch (err) {
  console.error(`\n❌ DB 저장 실패:`, err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
