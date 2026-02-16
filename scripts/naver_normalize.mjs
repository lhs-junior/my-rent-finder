#!/usr/bin/env node

/**
 * 네이버 raw 캡처 결과 -> normalized 변환
 * (quality 업그레이드 버전)
 */

import fs from "node:fs";
import path from "node:path";
import { NaverListingAdapter } from "./adapters/naver_listings_adapter.mjs";

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}

const inputFile = path.resolve(
  getArg("--input", path.join(process.cwd(), "scripts/naver_raw_samples.jsonl")),
);
const outputFile = path.resolve(
  getArg("--output", path.join(process.cwd(), "scripts/naver_normalized_samples.json")),
);
const maxItems = Number(getArg("--max-items", "400"));
const leaseTypeFilter = getArg("--lease-type", getArg("--lease-filter", null));
const filterRentMax = Number(getArg("--rent-max", "0")) || 0;
const filterDepositMax = Number(getArg("--deposit-max", "0")) || 0;
const filterMinArea = Number(getArg("--min-area", "0")) || 0;

console.log(`📥 Input: ${inputFile}`);
console.log(`📤 Output: ${outputFile}`);
console.log(`📊 Max items: ${maxItems}`);
if (leaseTypeFilter) {
  console.log(`🔎 Lease filter: ${leaseTypeFilter}`);
}
if (filterRentMax > 0) console.log(`🔎 Filter: 월세 ≤ ${filterRentMax}만원`);
if (filterDepositMax > 0) console.log(`🔎 Filter: 보증금 ≤ ${filterDepositMax}만원`);
if (filterMinArea > 0) console.log(`🔎 Filter: 면적 ≥ ${filterMinArea}m²`);

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Input not found: ${inputFile}`);
  process.exit(1);
}

const adapter = new NaverListingAdapter({ inputFile, leaseTypeFilter });
const result = await adapter.normalizeFromRawFile(inputFile, {
  maxItems,
  includeRaw: false,
});

let filteredItems = result.items;
let filteredCount = 0;

if (filterRentMax > 0 || filterDepositMax > 0 || filterMinArea > 0) {
  filteredItems = result.items.filter((item) => {
    if (filterRentMax > 0 && item.rent_amount !== null && item.rent_amount > filterRentMax) {
      return false;
    }
    if (filterDepositMax > 0 && item.deposit_amount !== null && item.deposit_amount > filterDepositMax) {
      return false;
    }
    if (filterMinArea > 0) {
      const area = item.area_exclusive_m2 || item.area_gross_m2 || 0;
      if (area > 0 && area < filterMinArea) {
        return false;
      }
    }
    return true;
  });
  filteredCount = result.items.length - filteredItems.length;
}

const output = {
  metadata: {
    source: inputFile,
    generatedAt: result.metadata.generated_at,
    totalRawRecords: result.metadata.raw_records,
    totalNormalizedItems: filteredItems.length,
    filteredByCondition: filteredCount,
    durationMs: result.metadata.durationMs,
    stats: {
      ...result.stats,
      preFilterCount: result.items.length,
      postFilterCount: filteredItems.length,
      filteredByCondition: filteredCount,
    },
    filters: {
      rentMax: filterRentMax || null,
      depositMax: filterDepositMax || null,
      minArea: filterMinArea || null,
    },
  },
  items: filteredItems,
};

fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");

console.log(`✅ done`);
console.log(`   normalized: ${result.items.length}`);
if (filteredCount > 0) {
  console.log(`   filtered: ${filteredCount} (조건 미충족)`);
  console.log(`   final: ${filteredItems.length}`);
}
console.log(
  `   requiredFields: ${(Math.round(result.stats.requiredFieldsRate * 1000) / 10).toFixed(1)}%`,
);
console.log(
  `   imageUrlRate: ${(Math.round(result.stats.imageRate * 1000) / 10).toFixed(1)}%`,
);
