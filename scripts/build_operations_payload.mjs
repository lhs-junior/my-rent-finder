#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { persistOperationsToDb } from "./lib/ops_db_persistence.mjs";
import { getArg, getInt, getBool, toText } from "./lib/cli_utils.mjs";

const args = process.argv.slice(2);

function toSafeInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function clampRate(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n > 1) return clamp01(n / 100);
  return clamp01(n);
}

function safeDate(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function safeToken(value) {
  return toText(value)
    .replace(/[^\p{L}\p{N}\-_]/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function readJsonSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function countJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return 0;
  return raw.split("\n").filter((line) => toText(line).length > 0).length;
}

function normalizePlatform(raw) {
  return toText(raw).split(":")[0].toLowerCase();
}

function platformNameFromCode(code) {
  const names = {
    naver: "네이버 부동산",
    zigbang: "직방",
    dabang: "다방",
    r114: "부동산114",
    peterpanz: "피터팬",
  };
  return names[code] || toText(code) || "unknown";
}

function pickSummaryCandidates(runDir) {
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) return [];
  return fs.readdirSync(runDir).filter((file) => /^parallel_collect_summary_.*\.json$/.test(file))
    .map((file) => path.join(runDir, file));
}

function pickLatestSummaryFromRunRoot(runRoot) {
  const dirs = fs.readdirSync(runRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  let best = null;
  for (const dir of dirs) {
    const runDir = path.join(runRoot, dir.name);
    for (const file of pickSummaryCandidates(runDir)) {
      const stat = fs.statSync(file);
      if (!best || stat.mtimeMs > best.mtimeMs) {
        best = { file, mtimeMs: stat.mtimeMs };
      }
    }
  }
  return best ? best.file : null;
}

function guessNormalizedCandidates(platform, runId, sigungu, runDir) {
  const id = runId || "run";
  const safe = safeToken(sigungu);
  return [
    ...safe ? [
      path.join(runDir, `${platform}_normalized_${id}_${safe}.json`),
      path.join(runDir, `${platform}_normalized_${id}_${safe}.jsonl`),
    ] : [],
    path.join(runDir, `${platform}_normalized_${id}.json`),
    path.join(runDir, `${platform}_normalized_${id}.jsonl`),
    path.join(runDir, `${platform}_normalized_${id}_${safe}.json`),
    path.join(runDir, `${platform}_normalized_${id}_${safe}.jsonl`),
  ].filter(Boolean);
}

function extractListings(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.listings)) return payload.listings;
  return [];
}

function boolNum(v) {
  return v ? 1 : 0;
}

function inferMetrics(items) {
  const m = {
    req: 0,
    reqDen: 0,
    addr: 0,
    addrDen: 0,
    img: 0,
    imgDen: 0,
    area: 0,
    areaDen: 0,
    price: 0,
    priceDen: 0,
  };
  for (const item of items) {
    const addr = toText(item.address_text || item.addressText || item.address_code);
    const hasAddress = addr.length > 0;
    const imgList = Array.isArray(item.image_urls || item.imageUrls)
      ? (item.image_urls || item.imageUrls)
      : [];
    const hasImage = imgList.length > 0;
    const rent = item.rent_amount ?? item.rentAmount;
    const dep = item.deposit_amount ?? item.depositAmount;
    const area = item.area_exclusive_m2
      ?? item.areaExclusiveM2
      ?? item.area_gross_m2
      ?? item.areaGrossM2;
    const hasPrice = rent != null || dep != null;
    const hasArea = area != null;

    m.reqDen += 1;
    m.addrDen += 1;
    m.imgDen += 1;
    m.areaDen += 1;
    m.priceDen += 1;
    m.addr += boolNum(hasAddress);
    m.img += boolNum(hasImage);
    m.area += boolNum(hasArea);
    m.price += boolNum(hasPrice);
    m.req += boolNum(hasAddress && hasPrice && hasArea);
  }
  return m;
}

function makeEmptyStat() {
  return {
    jobs: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    rawCount: 0,
    normalizedCount: 0,
    rawBySigungu: [],
    qualityGrades: {
      GOOD: 0,
      PARTIAL: 0,
      EMPTY: 0,
      FAIL: 0,
      SKIP: 0,
      UNKNOWN: 0,
    },
    metrics: {
      requiredSum: 0,
      requiredDen: 0,
      addressSum: 0,
      addressDen: 0,
      imageSum: 0,
      imageDen: 0,
      areaSum: 0,
      areaDen: 0,
      priceSum: 0,
      priceDen: 0,
    },
    jobsInfo: [],
  };
}

function resolveListingId(item, index, platform) {
  return (
    item?.id
    || item?.listing_id
    || item?.external_id
    || item?.externalId
    || item?.source_ref
    || item?.sourceRef
    || item?.source_url
    || item?.sourceUrl
    || `${platform}_${index}`
  );
}

function normalizeImageList(item) {
  if (Array.isArray(item.image_urls)) return item.image_urls;
  if (Array.isArray(item.imageUrls)) return item.imageUrls;
  return [];
}

const runRoot = path.resolve(process.cwd(), "scripts", "parallel_collect_runs");
const argRunDir = getArg(args, "--run-dir", null);
const argRunId = getArg(args, "--run-id", null);
const argSummary = getArg(args, "--summary", null);
const outArg = getArg(args, "--out", "");
const payloadOut = outArg
  ? (path.isAbsolute(outArg) ? path.resolve(outArg) : path.resolve(process.cwd(), outArg))
  : path.resolve(process.cwd(), "docs", "rent_finder_operations_dashboard_payload.json");
const matcherOutArg = getArg(args, "--match-out", null);
const pairLimit = getInt(args, "--pair-limit", 400);
const groupLimit = getInt(args, "--group-limit", 200);
const keepMatchInput = getBool(args, "--keep-match-input", false);
const persistToDb = getBool(args, "--persist-to-db", false);
const persistMatches = getBool(args, "--persist-matches", true);

if (!fs.existsSync(runRoot)) {
  console.error(`parallel_collect_runs not found: ${runRoot}`);
  process.exit(1);
}

let runDir = null;
let summaryPath = null;

if (argRunDir) {
  runDir = path.resolve(process.cwd(), argRunDir);
  if (!fs.existsSync(runDir)) {
    console.error(`run-dir not found: ${runDir}`);
    process.exit(1);
  }
  const candidates = argSummary
    ? [path.resolve(process.cwd(), argSummary)]
    : pickSummaryCandidates(runDir);
  if (!candidates || candidates.length === 0) {
    console.error(`summary file not found in run-dir: ${runDir}`);
    process.exit(1);
  }
  summaryPath = candidates.reduce((acc, cur) => {
    const t = fs.statSync(cur).mtimeMs;
    if (!acc || t > acc.mtimeMs) return { file: cur, mtimeMs: t };
    return acc;
  }, null).file;
}

if (!runDir && argRunId) {
  runDir = path.join(runRoot, argRunId);
  if (!fs.existsSync(runDir)) {
    console.error(`run-id not found: ${argRunId}`);
    process.exit(1);
  }
  const candidates = argSummary ? [path.resolve(process.cwd(), argSummary)] : pickSummaryCandidates(runDir);
  if (!candidates || candidates.length === 0) {
    console.error(`summary file not found in run-id dir: ${runDir}`);
    process.exit(1);
  }
  summaryPath = candidates.reduce((acc, cur) => {
    const t = fs.statSync(cur).mtimeMs;
    if (!acc || t > acc.mtimeMs) return { file: cur, mtimeMs: t };
    return acc;
  }, null).file;
}

if (!runDir) {
  summaryPath = argSummary
    ? path.resolve(process.cwd(), argSummary)
    : pickLatestSummaryFromRunRoot(runRoot);
  if (!summaryPath || !fs.existsSync(summaryPath)) {
    console.error("no summary file found in parallel_collect_runs");
    process.exit(1);
  }
  runDir = path.dirname(summaryPath);
}

if (argSummary && !summaryPath) {
  const guessed = path.isAbsolute(argSummary) ? argSummary : path.resolve(process.cwd(), argSummary);
  if (!fs.existsSync(guessed)) {
    console.error(`summary file not found: ${guessed}`);
    process.exit(1);
  }
  summaryPath = guessed;
  runDir = path.dirname(summaryPath);
}

const summary = readJsonSafe(summaryPath);
if (!summary) {
  console.error(`summary parse failed: ${summaryPath}`);
  process.exit(1);
}
if (!Array.isArray(summary.results)) {
  console.error(`invalid summary.results: ${summaryPath}`);
  process.exit(1);
}

const startedAt = safeDate(summary.startedAt);
const finishedAt = safeDate(summary.finishedAt);
const runMeta = {
  runId: summary.runId || path.basename(runDir),
  workspace: summary.workspace || runDir,
  startedAt,
  finishedAt,
  selectedPlatforms: summary.runOptions?.selectedPlatforms || [],
  durationMs: Number.isFinite(Date.parse(summary.startedAt)) && Number.isFinite(Date.parse(summary.finishedAt))
    ? Date.parse(summary.finishedAt) - Date.parse(summary.startedAt)
    : 0,
};

const platformRows = new Map();
const byListingId = new Map();
const allListings = [];
let totalRaw = 0;
let totalNormalized = 0;
let fallbackIdx = 0;

function getPlatformRow(platform) {
  if (!platformRows.has(platform)) platformRows.set(platform, makeEmptyStat());
  return platformRows.get(platform);
}

function extractMetaRawCount(meta) {
  const rawCount = toSafeInt(
    meta?.apiCollect?.totalListings
    || meta?.totalListings
    || meta?.total
    || meta?.collectedListings
    || 0,
  );
  return rawCount;
}

for (const result of summary.results) {
  const platform = normalizePlatform(result.platform || result.name);
  const sigungu = toText(result.sigungu) || null;
  const row = getPlatformRow(platform);
  row.jobs += 1;

  const grade = toText(result.dataQuality?.grade || "UNKNOWN").toUpperCase();
  const isSkipped = Boolean(result.ok && result.skipped);
  const isSuccess = Boolean(result.ok && !isSkipped);

  row.qualityGrades[grade] = (row.qualityGrades[grade] || 0) + 1;
  row.failed += isSuccess ? 0 : 1;
  row.skipped += isSkipped ? 1 : 0;
  row.succeeded += isSuccess ? 1 : 0;

  let rawCount = 0;
  if (result.rawFile && fs.existsSync(result.rawFile)) {
    rawCount = countJsonLines(result.rawFile);
  }
  if (rawCount <= 0 && result.metaFile && fs.existsSync(result.metaFile)) {
    rawCount = extractMetaRawCount(readJsonSafe(result.metaFile) || {});
  }
  row.rawCount += rawCount;
  totalRaw += rawCount;

  let normalizedItems = [];
  let normalizedPath = result.normalizedPath || null;
  if (!normalizedPath && toText(sigungu)) {
    normalizedPath = guessNormalizedCandidates(platform, summary.runId || runMeta.runId, sigungu, runDir)
      .find((candidate) => fs.existsSync(candidate));
  }
  if (!normalizedPath && result.output && fs.existsSync(result.output)) {
    normalizedPath = result.output;
  }

  if (normalizedPath && fs.existsSync(normalizedPath)) {
    const payload = readJsonSafe(normalizedPath);
    normalizedItems = extractListings(payload);
    const stats = payload?.stats || {};

    const itemDen = toSafeInt(stats.normalizedItems || payload?.items?.length || normalizedItems.length);
    const requiredRate = clampRate(stats.requiredFieldsRate);
    const addressRate = clampRate(stats.addressRate ?? stats.address_rate);
    const imageRate = clampRate(stats.imageRate ?? stats.image_rate ?? stats.imagePresenceRate ?? 0);
    const areaRate = clampRate(stats.areaRate ?? stats.area_rate);
    const priceRate = clampRate(stats.priceRate ?? stats.price_rate);

    if (itemDen > 0 && Number.isFinite(requiredRate)) row.metrics.requiredSum += requiredRate * itemDen;
    if (itemDen > 0 && Number.isFinite(addressRate)) row.metrics.addressSum += addressRate * itemDen;
    if (itemDen > 0 && Number.isFinite(imageRate)) row.metrics.imageSum += imageRate * itemDen;
    if (itemDen > 0 && Number.isFinite(areaRate)) row.metrics.areaSum += areaRate * itemDen;
    if (itemDen > 0 && Number.isFinite(priceRate)) row.metrics.priceSum += priceRate * itemDen;

    if (itemDen > 0) {
      row.metrics.requiredDen += itemDen;
      row.metrics.addressDen += itemDen;
      row.metrics.imageDen += itemDen;
      row.metrics.areaDen += itemDen;
      row.metrics.priceDen += itemDen;
    }
  }

  if (normalizedItems.length > 0 && row.metrics.requiredDen <= 0) {
    const inferred = inferMetrics(normalizedItems);
    row.metrics.requiredSum += inferred.req;
    row.metrics.requiredDen += inferred.reqDen;
    row.metrics.addressSum += inferred.addr;
    row.metrics.addressDen += inferred.addrDen;
    row.metrics.imageSum += inferred.img;
    row.metrics.imageDen += inferred.imgDen;
    row.metrics.areaSum += inferred.area;
    row.metrics.areaDen += inferred.areaDen;
    row.metrics.priceSum += inferred.price;
    row.metrics.priceDen += inferred.priceDen;
  }

  row.rawBySigungu.push({
    platform,
    sigungu,
    status: isSuccess ? "DONE" : (isSkipped ? "SKIP" : "FAILED"),
    grade,
    rawCount,
    normalizedCount: normalizedItems.length,
  });
  row.normalizedCount += normalizedItems.length;
  totalNormalized += normalizedItems.length;

  const started = safeDate(result.startedAt);
  const ended = safeDate(result.finishedAt);
  const duration = started && ended ? Date.parse(result.finishedAt) - Date.parse(result.startedAt) : 0;
  row.jobsInfo.push({
    name: toText(result.name || `${platform}:${sigungu || "all"}`),
    platform,
    platform_name: platformNameFromCode(platform),
    sigungu,
    status: isSuccess ? "DONE" : (isSkipped ? "SKIP" : "FAILED"),
    grade,
    raw_file: result.rawFile || null,
    meta_file: result.metaFile || null,
    normalized_path: normalizedPath || null,
    raw_count: rawCount,
    normalized_count: normalizedItems.length,
    started_at: started,
    finished_at: ended,
    duration_ms: Number.isFinite(duration) ? duration : 0,
  });

  normalizedItems.forEach((item, idx) => {
    const id = resolveListingId(item, fallbackIdx, platform);
    fallbackIdx += 1;
    const normalized = {
      ...item,
      __platform_code: platform,
      __platform_name: platformNameFromCode(platform),
      __sigungu: sigungu,
      __source_job: toText(result.name),
      __listing_id: id,
      image_urls: normalizeImageList(item),
      source_url: item.source_url || item.sourceUrl || item.source,
      external_id: item.external_id || item.externalId || item.source_ref || item.sourceRef || id,
    };
    allListings.push(normalized);
    byListingId.set(id, normalized);
    byListingId.set(`${platform}::${id}`, normalized);
    if (normalized.external_id) byListingId.set(normalized.external_id, normalized);
    if (normalized.source_ref) {
      byListingId.set(normalized.source_ref, normalized);
      byListingId.set(`${platform}::${normalized.source_ref}`, normalized);
    }
  });
}

const platformSummary = Array.from(platformRows.entries())
  .map(([platform, row]) => {
    const required = row.metrics.requiredDen > 0 ? clamp01(row.metrics.requiredSum / row.metrics.requiredDen) : 0;
    const address = row.metrics.addressDen > 0 ? clamp01(row.metrics.addressSum / row.metrics.addressDen) : 0;
    const image = row.metrics.imageDen > 0 ? clamp01(row.metrics.imageSum / row.metrics.imageDen) : 0;
    const area = row.metrics.areaDen > 0 ? clamp01(row.metrics.areaSum / row.metrics.areaDen) : 0;
    const price = row.metrics.priceDen > 0 ? clamp01(row.metrics.priceSum / row.metrics.priceDen) : 0;
    return {
      platform_code: platform,
      platform_name: platformNameFromCode(platform),
      jobs: row.jobs,
      succeeded: row.succeeded,
      skipped: row.skipped,
      failed: row.failed,
      raw_count: row.rawCount,
      normalized_count: row.normalizedCount,
      quality_grades: row.qualityGrades,
      success_rate: row.jobs > 0 ? clamp01((row.succeeded + row.skipped) / row.jobs) : 0,
      metrics: {
        required_fields_rate: required,
        address_rate: address,
        image_rate: image,
        area_rate: area,
        price_rate: price,
      },
    };
  })
  .sort((a, b) => b.normalized_count - a.normalized_count);

const overallRequiredRate = allListings.length
  ? clamp01(
    allListings.filter((item) => {
      const hasAddress = toText(item.address_text || item.addressText || item.address_code).length > 0;
      const hasPrice = item.rent_amount != null || item.deposit_amount != null;
      const hasArea = item.area_exclusive_m2 != null || item.area_gross_m2 != null;
      return hasAddress && hasPrice && hasArea;
    }).length / allListings.length,
  )
  : 0;

const matcherInputPath = path.join(runDir, `operations_match_input_${Date.now()}.json`);
let matcherOutput = null;
let matchResultPath = matcherOutArg
  ? path.resolve(process.cwd(), matcherOutArg)
  : path.join(runDir, `match_result_${runMeta.runId}.json`);

writeJson(matcherInputPath, {
  run_id: `operations_${runMeta.runId}`,
  generated_at: new Date().toISOString(),
  listings: allListings,
});

if (allListings.length > 0) {
  const matcherScript = path.resolve(process.cwd(), "scripts", "matcher_v1.mjs");
  const matcherProc = spawnSync(
    process.execPath,
    [matcherScript, "--input", matcherInputPath, "--out", matchResultPath],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (matcherProc.status === 0) {
    matcherOutput = readJsonSafe(matchResultPath);
  } else if (matcherProc.stderr) {
    console.error(matcherProc.stderr);
  }
}

if (!matcherOutput) {
  matcherOutput = {
    run_id: `operations_${runMeta.runId}`,
    input_summary: {
      count: allListings.length,
      candidate_pairs: 0,
      auto_match: 0,
      review_required: 0,
      distinct: 0,
      merged_groups: 0,
    },
    pairs: [],
    match_groups: [],
  };
}

if (!keepMatchInput) {
  try {
    fs.unlinkSync(matcherInputPath);
  } catch {}
}

const allPairs = Array.isArray(matcherOutput.pairs) ? matcherOutput.pairs : [];
const sortedPairs = allPairs.slice().sort((a, b) => b.score - a.score);
const autoPairs = sortedPairs.filter((pair) => pair.status === "AUTO_MATCH").slice(0, pairLimit);
const reviewPairs = sortedPairs.filter((pair) => pair.status === "REVIEW_REQUIRED").slice(0, pairLimit);

function listingById(listingId) {
  return byListingId.get(listingId) || byListingId.get(`idx_${listingId}`) || null;
}

const pairWithListing = (pair) => {
  const source = listingById(pair.source_listing_id);
  const target = listingById(pair.target_listing_id);
  return {
    status: pair.status,
    score: pair.score,
    source_listing_id: pair.source_listing_id,
    target_listing_id: pair.target_listing_id,
    source: source
      ? {
          platform: source.__platform_name || platformNameFromCode(source.__platform_code || ""),
          sigungu: source.__sigungu || null,
          address: toText(source.address_text || source.addressText || ""),
          rent: source.rent_amount ?? source.rentAmount ?? null,
          deposit: source.deposit_amount ?? source.depositAmount ?? null,
          area_exclusive_m2: source.area_exclusive_m2 ?? source.areaExclusiveM2 ?? null,
          area_gross_m2: source.area_gross_m2 ?? source.areaGrossM2 ?? null,
          image_count: Array.isArray(source.image_urls) ? source.image_urls.length : 0,
        }
      : null,
    target: target
      ? {
          platform: target.__platform_name || platformNameFromCode(target.__platform_code || ""),
          sigungu: target.__sigungu || null,
          address: toText(target.address_text || target.addressText || ""),
          rent: target.rent_amount ?? target.rentAmount ?? null,
          deposit: target.deposit_amount ?? target.depositAmount ?? null,
          area_exclusive_m2: target.area_exclusive_m2 ?? target.areaExclusiveM2 ?? null,
          area_gross_m2: target.area_gross_m2 ?? target.areaGrossM2 ?? null,
          image_count: Array.isArray(target.image_urls) ? target.image_urls.length : 0,
        }
      : null,
    reason: pair.reason_json || null,
  };
};

const groups = Array.isArray(matcherOutput.match_groups) ? matcherOutput.match_groups : [];
const groupedMatches = groups
  .slice()
  .sort((a, b) => b.member_count - a.member_count)
  .slice(0, groupLimit)
  .map((group) => ({
    ...group,
    members: (group.members || []).map((listingId) => {
      const item = listingById(listingId);
      if (!item) return { id: listingId };
      return {
        id: listingId,
        platform: item.__platform_name || platformNameFromCode(item.__platform_code || ""),
        sigungu: item.__sigungu || null,
        address: toText(item.address_text || item.addressText || ""),
        rent: item.rent_amount ?? item.rentAmount ?? null,
        deposit: item.deposit_amount ?? item.depositAmount ?? null,
        area_exclusive_m2: item.area_exclusive_m2 ?? item.areaExclusiveM2 ?? null,
        image_count: Array.isArray(item.image_urls) ? item.image_urls.length : 0,
      };
    }),
  }));

const payload = {
  generated_at: new Date().toISOString(),
  run: {
    run_id: runMeta.runId,
    workspace: runMeta.workspace,
    started_at: runMeta.startedAt,
    finished_at: runMeta.finishedAt,
    duration_ms: runMeta.durationMs,
    selected_platforms: runMeta.selectedPlatforms,
    source_summary_path: summaryPath,
    summary_jobs: summary.totals || null,
  },
  overview: {
    total_jobs: platformSummary.reduce((sum, row) => sum + row.jobs, 0),
    succeeded_jobs: platformSummary.reduce((sum, row) => sum + row.succeeded, 0),
    skipped_jobs: platformSummary.reduce((sum, row) => sum + row.skipped, 0),
    failed_jobs: platformSummary.reduce((sum, row) => sum + row.failed, 0),
    raw_count: totalRaw,
    normalized_count: totalNormalized,
    required_quality_rate: overallRequiredRate,
  },
  platform_rows: platformSummary,
  jobs: Array.from(platformRows.values()).flatMap((row) => row.jobsInfo),
  matching: {
    summary: matcherOutput.input_summary || {
      count: allListings.length,
      candidate_pairs: allPairs.length,
      auto_match: autoPairs.length,
      review_required: reviewPairs.length,
      distinct: Math.max(0, allPairs.length - autoPairs.length - reviewPairs.length),
      merged_groups: groupedMatches.length,
    },
    auto_pairs: autoPairs.map(pairWithListing),
    review_pairs: reviewPairs.map(pairWithListing),
    groups: groupedMatches,
  },
};

writeJson(payloadOut, payload);

let dbResult = null;
if (persistToDb) {
  dbResult = await persistOperationsToDb(summaryPath, {
    runId: runMeta.runId,
    matchOutputPath: matchResultPath,
    persistMatches,
  });
}

console.log(JSON.stringify({
  run_id: runMeta.runId,
  payload_path: payloadOut,
  matcher_output_path: matcherOutput ? matchResultPath : null,
  platforms: platformSummary.length,
  normalized_listings: allListings.length,
  total_pairs: allPairs.length,
  groups: groupedMatches.length,
  db_persistence: dbResult,
}, null, 2));
