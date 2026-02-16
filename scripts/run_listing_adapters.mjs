#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { getAdapter, listAdapters } from "./adapters/adapter_registry.mjs";

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const idx = args.findIndex((v) => v === name || v.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=");
};
const hasFlag = (name) => args.includes(name);

const platform = getArg("--platform", "naver");
const defaultInput =
  String(platform).toLowerCase() === "all"
    ? path.join(process.cwd(), "scripts/%p_raw_samples.jsonl")
    : path.join(process.cwd(), `scripts/${platform}_raw_samples.jsonl`);
const input = getArg("--input", defaultInput);
const outPath = getArg("--out", null);
function normalizeMaxItems(raw, fallback = 200) {
  const parsed = Number(raw);
  if (raw === null || raw === undefined || Number.isNaN(parsed)) return fallback;
  if (parsed < 0) return fallback;
  if (parsed === 0 || !Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.floor(parsed);
}
const maxItems = normalizeMaxItems(getArg("--max-items", "200"), 200);
const listOnly = hasFlag("--list");
const allowPlanned = hasFlag("--allow-planned");
const runAllPlatforms = String(platform).toLowerCase() === "all";

const inputTemplate = input;
const shouldRunFor = (cfg) => allowPlanned || cfg.readiness === "READY";

if (listOnly) {
  const rows = listAdapters();
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

if (runAllPlatforms) {
  const targetPlatforms = listAdapters().filter(shouldRunFor);
  if (targetPlatforms.length === 0) {
    console.error(`실행 가능한 플랫폼이 없습니다.`);
    process.exit(1);
  }

  const resolvedOut = outPath || path.join(process.cwd(), "scripts/adapters_all_output.json");
  const allRuns = [];
  const allItems = [];
  const summary = {
    platformCode: "all",
    runAt: new Date().toISOString(),
    inputTemplate,
    runs: [],
    merged_items: [],
  };

  for (const cfg of targetPlatforms) {
    const adapter = getAdapter(cfg.platform_code);
    if (!adapter) continue;
    const platformInput = inputTemplate.includes("%p")
      ? inputTemplate.replace(/%p/g, cfg.platform_code)
      : inputTemplate;

    if (!fs.existsSync(platformInput)) {
      console.warn(`[SKIP] raw 파일 없음: ${cfg.platform_code} -> ${platformInput}`);
      continue;
    }

    console.log(`🚀 Adapter run: ${cfg.platform_code}`);
    console.log(`📥 INPUT: ${platformInput}`);
    const result = await adapter.normalizeFromRawFile(platformInput, { maxItems });
    const run = {
      platform_code: cfg.platform_code,
      platform_name: adapter.platformName,
      collection_mode: adapter.collectionMode,
      readiness: cfg.readiness,
      input: platformInput,
      metadata: result.metadata,
      stats: result.stats,
      items: result.items,
    };
    allRuns.push(run);
    allItems.push(...result.items);
  }

  summary.runs = allRuns;
  summary.merged_items = allItems;

  fs.writeFileSync(
    resolvedOut,
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  const mergedCount = allItems.length;
  const totalRuns = allRuns.length;
  const requiredRates = allRuns.map((r) => r.stats?.requiredFieldsRate || 0);
  const bestRate = requiredRates.length ? Math.max(...requiredRates) : 0;
  console.log(`✅ 완료: runs=${totalRuns}, merged_items=${mergedCount}, max_requiredRate=${Math.round(bestRate * 1000) / 10}%`);
  console.log(`💾 저장: ${resolvedOut}`);
  process.exit(0);
}

const adapter = getAdapter(platform);
if (!adapter) {
  console.error(`지원하지 않는 플랫폼: ${platform}`);
  console.error(`현재 등록된 플랫폼: ${listAdapters().map((x) => x.platform_code).join(", ")}`);
  process.exit(1);
}

if (!fs.existsSync(input)) {
  console.error(`raw 파일이 없습니다: ${input}`);
  process.exit(1);
}

const resolvedOut = outPath || path.join(process.cwd(), `scripts/${platform}_adapter_output.json`);

console.log(`🚀 Adapter run: ${platform}`);
console.log(`📥 INPUT: ${input}`);
console.log(`📤 OUTPUT: ${resolvedOut}`);

const result = await adapter.normalizeFromRawFile(input, { maxItems });

const output = {
  platform_code: platform,
  platform_name: adapter.platformName,
  collection_mode: adapter.collectionMode,
  runAt: new Date().toISOString(),
  input,
  options: { maxItems },
  metadata: result.metadata,
  stats: result.stats,
  samples: result.samples.slice(0, 20),
  items: result.items,
};

fs.writeFileSync(resolvedOut, JSON.stringify(output, null, 2), "utf8");
console.log(
  `✅ 완료: items=${result.items.length}, required=${Math.round(result.stats.requiredFieldsRate * 1000) / 10}%, raw=${result.stats.rawRecords}`,
);
console.log(`💾 저장: ${resolvedOut}`);
