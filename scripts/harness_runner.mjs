#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getArg, hasArg, toText, getBool } from "./lib/cli_utils.mjs";
import { evaluateCollection } from "./lib/harness/collection_gate.mjs";
import { evaluateNormalization } from "./lib/harness/normalization_gate.mjs";
import { evaluateListingQuality } from "./lib/harness/listing_quality.mjs";
import { evaluateMatches } from "./lib/harness/match_evaluator.mjs";
import { buildReport } from "./lib/harness/report_builder.mjs";
import { COLLECTION_THRESHOLDS } from "./lib/harness/constants.mjs";

const args = process.argv.slice(2);
const startTime = Date.now();

function normalizeRunId(raw) {
  return toText(raw || new Date().toISOString(), "run").replace(/[T:.]/g, "-");
}

function runPhase(label, scriptPath, extraArgs) {
  console.log(`\n[harness] ▶ ${label}`);
  const result = spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with code ${result.status}`);
}

function readJsonSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// summary.results 배열(platform×sigungu 조합)을 플랫폼별로 집계
// 실제 매물은 각 result의 normalizedPath JSONL에서 읽어옴
function buildPlatformData(summary) {
  const rawResults = summary.results || summary.platforms || {};
  const platformData = {};

  if (Array.isArray(rawResults)) {
    for (const r of rawResults) {
      const platform = r.platform || (r.name || "").split(":")[0] || "unknown";
      if (!platformData[platform]) {
        platformData[platform] = { requested: 0, collected: 0, listings: [] };
      }
      // normalizedPath JSON에서 실제 매물 로드 (형식: { items: [...] })
      if (r.normalizedPath && fs.existsSync(r.normalizedPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(r.normalizedPath, "utf8"));
          const parsed = Array.isArray(raw) ? raw : (raw.items || []);
          platformData[platform].collected += parsed.length;
          platformData[platform].listings.push(...parsed);
        } catch {}
      }
      // targetCap이 있으면 요청 건수로 사용, 없으면 수집 건수로 대체
      if (r.targetCap && Number.isFinite(r.targetCap)) {
        platformData[platform].requested += r.targetCap;
      }
    }
    // requested가 0이면 collected로 대체 (targetCap 없는 플랫폼)
    for (const p of Object.values(platformData)) {
      if (p.requested === 0) p.requested = p.collected;
    }
  } else {
    for (const [platform, data] of Object.entries(rawResults)) {
      const listings = data.listings || data.normalized || [];
      platformData[platform] = {
        requested: data.requested || data.target_count || listings.length,
        collected: data.collected || data.count || listings.length,
        listings,
      };
    }
  }
  return platformData;
}

// 모든 플랫폼의 정규화 매물 목록을 합산
function gatherAllListings(summary) {
  const rawResults = summary.results || summary.platforms || {};
  const allListings = [];
  const items = Array.isArray(rawResults) ? rawResults : Object.values(rawResults);
  for (const r of items) {
    if (r.normalizedPath && fs.existsSync(r.normalizedPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(r.normalizedPath, "utf8"));
        const parsed = Array.isArray(raw) ? raw : (raw.items || []);
        allListings.push(...parsed);
      } catch {}
    } else {
      const listings = r.normalized || r.listings || [];
      allListings.push(...listings);
    }
  }
  return allListings;
}

const runId = normalizeRunId(getArg(args, "--run-id", null));
const outDir = getArg(args, "--out-dir", path.join("scripts", "parallel_collect_runs", runId));
const workspace = path.resolve(process.cwd(), outDir);
const skipCollect = getBool(args, "--skip-collect", false);
const inputSummaryPath = getArg(args, "--input-summary", null);

const collectScript = path.resolve(process.cwd(), "scripts", "run_parallel_collect.mjs");
const buildScript = path.resolve(process.cwd(), "scripts", "build_operations_payload.mjs");
const summaryFileName = `parallel_collect_summary_${runId}.json`;
const summaryPath = inputSummaryPath || path.join(workspace, summaryFileName);

const reportsDir = path.resolve(process.cwd(), "reports");
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

const collectPassThrough = args.filter((arg) => {
  return !(
    arg === "--run-id" || arg === "--out-dir" || arg === "--skip-collect" ||
    arg === "--input-summary" ||
    arg.startsWith("--run-id=") || arg.startsWith("--out-dir=") ||
    arg.startsWith("--input-summary=")
  );
});

// per-phase timing
const phaseTimes = {};

// ═══════════════════════════════════════════
// Phase 1: Collection + Quality Gate
// ═══════════════════════════════════════════
let collectionResult;

if (!skipCollect) {
  phaseTimes.collection_start = Date.now();
  const collectArgs = [
    ...collectPassThrough,
    "--run-id", runId,
    "--out-dir", workspace,
  ];
  if (!hasArg(args, "--persist-to-db")) collectArgs.push("--persist-to-db");
  if (!hasArg(args, "--normalize")) collectArgs.push("--normalize");

  let retries = 0;
  while (retries <= COLLECTION_THRESHOLDS.maxRetries) {
    try {
      runPhase(`collection (attempt ${retries + 1})`, collectScript, collectArgs);
    } catch (err) {
      console.error(`[harness] collection error: ${err.message}`);
    }

    const summary = readJsonSafe(summaryPath);
    if (summary) {
      const platformData = buildPlatformData(summary);
      collectionResult = evaluateCollection({ platforms: platformData });
      collectionResult.retries = retries;

      if (collectionResult.status === "pass" || retries >= COLLECTION_THRESHOLDS.maxRetries) break;
    } else if (retries >= COLLECTION_THRESHOLDS.maxRetries) {
      collectionResult = {
        phase: "collection", status: "fail", score: 0, retries,
        per_platform: {}, failed_platforms: ["all"],
        timestamp: new Date().toISOString(),
      };
      break;
    }
    retries++;
  }
} else {
  console.log("[harness] ▶ skipping collection (--skip-collect)");
  phaseTimes.collection_start = Date.now();
  collectionResult = { phase: "collection", status: "pass", score: 100, retries: 0, per_platform: {}, failed_platforms: [] };
}
phaseTimes.collection_end = Date.now();
const collectionDurationMs = phaseTimes.collection_end - phaseTimes.collection_start;
collectionResult.duration_ms = collectionDurationMs;
console.log(`[harness] ✓ collection: ${collectionResult.status} (score: ${collectionResult.score}) — ${(collectionDurationMs / 1000).toFixed(1)}s`);

// ═══════════════════════════════════════════
// Phase 2: Build operations (normalization + matching)
// ═══════════════════════════════════════════
phaseTimes.matching_start = Date.now();
if (fs.existsSync(summaryPath)) {
  const buildPassThrough = collectPassThrough.filter((arg) => {
    return !(
      arg === "--run-dir" || arg === "--summary" ||
      arg.startsWith("--run-dir=") || arg.startsWith("--summary=")
    );
  });
  const buildArgs = [
    ...buildPassThrough,
    "--run-id", runId,
    "--run-dir", workspace,
    "--summary", summaryPath,
    "--persist-to-db",
  ];
  if (!hasArg(args, "--persist-matches")) buildArgs.push("--persist-matches");

  try {
    runPhase("operations payload + matcher", buildScript, buildArgs);
  } catch (err) {
    console.error(`[harness] build phase error: ${err.message}`);
  }
}

phaseTimes.matching_end = Date.now();
const matchingDurationMs = phaseTimes.matching_end - phaseTimes.matching_start;

// ═══════════════════════════════════════════
// Phase 3: Normalization Gate (from summary data)
// ═══════════════════════════════════════════
phaseTimes.normalization_start = Date.now();
let normalizationResult;
const summary = readJsonSafe(summaryPath);
if (summary) {
  const allListings = gatherAllListings(summary);
  normalizationResult = evaluateNormalization(allListings);
} else {
  normalizationResult = { phase: "normalization", status: "warn", completeness: 0, null_field_counts: {}, total_normalized: 0 };
}
phaseTimes.normalization_end = Date.now();
const normalizationDurationMs = phaseTimes.normalization_end - phaseTimes.normalization_start;
normalizationResult.duration_ms = normalizationDurationMs;
console.log(`[harness] ✓ normalization: ${normalizationResult.status} (completeness: ${normalizationResult.completeness}%) — ${(normalizationDurationMs / 1000).toFixed(1)}s`);

// ═══════════════════════════════════════════
// Phase 4: Listing Quality
// ═══════════════════════════════════════════
let qualityResult;
if (summary) {
  const allListings = gatherAllListings(summary);
  const rents = allListings.map((l) => l.rent_amount).filter((v) => v != null && v > 0);
  const sortedRents = [...rents].sort((a, b) => a - b);
  const medianRent = sortedRents.length > 0 ? sortedRents[Math.floor(sortedRents.length / 2)] : null;

  const enriched = allListings.map((l) => ({
    ...l,
    image_count: (l.image_urls || l.imageUrls || []).length,
    median_rent: medianRent,
    stale_hours: l.collected_at ? Math.floor((Date.now() - new Date(l.collected_at).getTime()) / 3600000) : 0,
    same_contact_count: 0,
  }));
  qualityResult = evaluateListingQuality(enriched);
} else {
  qualityResult = { phase: "quality", status: "warn", total: 0, tiers: {}, suspicious_rate: 0, flagged_count: 0, flagged: [] };
}
console.log(`[harness] ✓ quality: ${qualityResult.status} (suspicious rate: ${qualityResult.suspicious_rate})`);

// ═══════════════════════════════════════════
// Phase 5: Match Evaluator
// ═══════════════════════════════════════════
let matchResult;
const matcherFiles = fs.existsSync(workspace) ? fs.readdirSync(workspace).filter((f) => f.includes("matcher") && f.endsWith(".json")) : [];
const matcherOutputPath = matcherFiles.length > 0 ? path.join(workspace, matcherFiles[0]) : null;
const matcherOutput = matcherOutputPath ? readJsonSafe(matcherOutputPath) : null;

if (matcherOutput?.pairs) {
  matchResult = evaluateMatches(matcherOutput.pairs);
} else {
  matchResult = { phase: "matching", status: "pass", auto_matched: 0, evaluator_promoted: 0, evaluator_demoted: 0, still_uncertain: 0, uncertain_pairs: [] };
}
matchResult.duration_ms = matchingDurationMs;
console.log(`[harness] ✓ matching: ${matchResult.status} (auto: ${matchResult.auto_matched}, promoted: ${matchResult.evaluator_promoted}, uncertain: ${matchResult.still_uncertain}) — ${(matchingDurationMs / 1000).toFixed(1)}s`);

// ═══════════════════════════════════════════
// Phase 6: 종료 매물 체크 (HTTP 기반)
// ═══════════════════════════════════════════
phaseTimes.status_check_start = Date.now();
if (!hasArg(args, "--skip-status")) {
  try {
    const statusScript = path.resolve(import.meta.dirname, "check_listing_status.mjs");
    runPhase("listing status check", statusScript, ["--platform", "all"]);
    const statusCheckDurationMs = Date.now() - phaseTimes.status_check_start;
    console.log(`[harness] ✓ listing status check complete — ${(statusCheckDurationMs / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error(`[harness] ⚠ listing status check error: ${err.message}`);
  }

  // Phase 6.2: 수집 누락 기반 stale 판정 (HTTP 체크로 못 잡힌 매물 보완)
  try {
    const { detectStaleListings } = await import("./lib/stale_detector.mjs");
    const staleResult = await detectStaleListings({ threshold: 3, hardDeleteThreshold: 6 });
    console.log(
      `[harness] ✓ stale detection — stale=${staleResult.marked_stale} cleared=${staleResult.cleared} hard_deleted=${staleResult.hard_deleted}`,
    );
  } catch (err) {
    console.error(`[harness] ⚠ stale detection error: ${err.message}`);
  }
} else {
  console.log("[harness] ▶ skipping listing status check (--skip-status)");
}
phaseTimes.status_check_end = Date.now();
const statusCheckDurationMs = phaseTimes.status_check_end - phaseTimes.status_check_start;

// ═══════════════════════════════════════════
// Phase 6.5: 지하철 거리 계산 (신규/좌표 반영된 매물 대상)
// ═══════════════════════════════════════════
if (!hasArg(args, "--skip-subway")) {
  try {
    const subwayScript = path.resolve(import.meta.dirname, "compute_subway_distance.mjs");
    runPhase("compute subway distance", subwayScript, []);
    console.log("[harness] ✓ subway distance complete");
  } catch (err) {
    console.error(`[harness] ⚠ subway distance error: ${err.message}`);
  }
} else {
  console.log("[harness] ▶ skipping subway distance (--skip-subway)");
}

// ═══════════════════════════════════════════
// Phase 7: AI 배점 (scored_listings 저장)
// ═══════════════════════════════════════════
phaseTimes.scoring_start = Date.now();
if (!hasArg(args, "--skip-score")) {
  try {
    const scoreScript = path.resolve(import.meta.dirname, "score_listings.mjs");
    runPhase("score listings", scoreScript, [
      "--interest-rate=0.04",
    ]);
    const scoringDurationMs = Date.now() - phaseTimes.scoring_start;
    console.log(`[harness] ✓ score listings complete — ${(scoringDurationMs / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error(`[harness] ⚠ score listings error: ${err.message}`);
  }
} else {
  console.log("[harness] ▶ skipping score (--skip-score)");
}
phaseTimes.scoring_end = Date.now();
const scoringDurationMs = phaseTimes.scoring_end - phaseTimes.scoring_start;

// ═══════════════════════════════════════════
// Phase 8: Build Final Report
// ═══════════════════════════════════════════
const durationMs = Date.now() - startTime;

// attach status_check and scoring durations to report phases via extension
const statusCheckPhase = { phase: "status_check", duration_ms: statusCheckDurationMs };
const scoringPhase = { phase: "scoring", duration_ms: scoringDurationMs };

const report = buildReport(runId, {
  collection: collectionResult,
  normalization: normalizationResult,
  quality: qualityResult,
  matching: matchResult,
}, durationMs);

// inject status_check + scoring phases into report
report.phases.status_check = statusCheckPhase;
report.phases.scoring = scoringPhase;

console.log(`[harness] collection: ${(collectionDurationMs / 1000).toFixed(1)}s, normalization: ${(normalizationDurationMs / 1000).toFixed(1)}s, matching: ${(matchingDurationMs / 1000).toFixed(1)}s, status_check: ${(statusCheckDurationMs / 1000).toFixed(1)}s, scoring: ${(scoringDurationMs / 1000).toFixed(1)}s`);

const reportPath = path.join(reportsDir, `harness-${runId}.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(`\n[harness] ═══════════════════════════════════`);
console.log(`[harness] Report: ${reportPath}`);
console.log(`[harness] Overall: ${report.overall}`);
console.log(`[harness] Duration: ${(durationMs / 1000).toFixed(1)}s`);
if (report.next_actions.length > 0) {
  console.log(`[harness] Next actions:`);
  for (const action of report.next_actions) {
    console.log(`[harness]   → ${action}`);
  }
}
console.log(`[harness] ═══════════════════════════════════\n`);

if (report.overall === "fail") process.exit(2);
if (report.overall === "warn") process.exit(1);
process.exit(0);
