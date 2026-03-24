#!/usr/bin/env node
import { persistSummaryToDb } from "./lib/ops_db_persistence.mjs";

const summaryPath = process.argv[2];
if (!summaryPath) {
  console.error("Usage: node persist_naver_run.mjs <summary.json>");
  process.exit(1);
}

console.log(`[persist] Loading summary: ${summaryPath}`);
const result = await persistSummaryToDb(summaryPath);
console.log(`[persist] Done:`, JSON.stringify(result, null, 2));
