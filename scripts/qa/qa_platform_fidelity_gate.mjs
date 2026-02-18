#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const argsByName = new Map();
for (let i = 0; i < argv.length; i += 1) {
  const raw = argv[i];
  if (!raw.startsWith("--")) continue;
  if (raw.includes("=")) {
    const [name, ...rest] = raw.split("=");
    argsByName.set(name, rest.join("="));
    continue;
  }
  const next = argv[i + 1];
  if (next !== undefined && !next.startsWith("--")) {
    argsByName.set(raw, next);
    i += 1;
  } else {
    argsByName.set(raw, "true");
  }
}

const getArg = (name, fallback = null) => (argsByName.has(name) ? argsByName.get(name) : fallback);
const getBool = (name, fallback = false) => {
  const raw = getArg(name, fallback ? "true" : "false");
  if (typeof raw === "boolean") return raw;
  return ["1", "true", "on", "yes", "y"].includes(String(raw).trim().toLowerCase());
};
const getList = (name, fallback = []) => {
  const raw = getArg(name, null);
  if (raw === null || raw === undefined) return fallback;
  if (Array.isArray(raw)) return raw;
  return String(raw).split(",").map((v) => v.trim()).filter(Boolean);
};

const toAbs = (value) => path.resolve(process.cwd(), String(value));

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function listDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function resolveSummaryPath() {
  const provided = getArg("--summary", null);
  if (provided) {
    const resolved = toAbs(provided);
    if (!fileExists(resolved)) {
      throw new Error(`summary not found: ${resolved}`);
    }
    return resolved;
  }

  const baseDir = toAbs(getArg("--workspace", "scripts/parallel_collect_runs"));
  let latest = null;
  const entries = listDir(baseDir).filter((entry) => entry.isDirectory());
  for (const entry of entries) {
    const dir = path.resolve(baseDir, entry.name);
    for (const file of listDir(dir)) {
      if (!file.isFile() || !file.name.startsWith("parallel_collect_summary_") || !file.name.endsWith(".json")) {
        continue;
      }
      const fullPath = path.resolve(dir, file.name);
      const stat = fs.statSync(fullPath);
      if (!latest || stat.mtimeMs > latest.mtimeMs) {
        latest = {
          path: fullPath,
          mtimeMs: stat.mtimeMs,
        };
      }
    }
  }

  if (!latest) {
    throw new Error("parallel collect summary file not found");
  }
  return latest.path;
}

function parsePlatformsFromSummary(summaryPath) {
  const raw = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const results = Array.isArray(raw.results) ? raw.results : [];
  return Array.from(new Set(results.map((item) => String(item.platform || "").toLowerCase()).filter(Boolean)));
}

function runFidelityCheck(summaryPath, platform, options) {
  const qaScript = toAbs("scripts/qa/qa_platform_data_fidelity.mjs");
  const out = [];
  const reportPath = toAbs(`${options.reportDir}/${platform}_fidelity_${Date.now()}.json`);
  const args = [qaScript,
    `--summary=${summaryPath}`,
    `--platform=${platform}`,
    `--report=${reportPath}`,
    `--strict=${options.strict ? "true" : "false"}`,
  ];
  if (options.maxItems !== null) args.push(`--max-items=${options.maxItems}`);
  if (options.maxFailPrint !== null) args.push(`--max-fail-print=${options.maxFailPrint}`);

  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    maxBuffer: 10_000_000,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.stdout) out.push(result.stdout);
  if (result.stderr) out.push(result.stderr);
  const output = out.join("\n");

  const summaryMatch = /QA_PLATFORM_DATA_FIDELITY_SUMMARY total=(\d+) fail=(\d+) pairs=(\d+) pass=(\w+)/.exec(output);
  const total = Number(summaryMatch?.[1] || 0);
  const fail = Number(summaryMatch?.[2] || 0);
  const pairs = Number(summaryMatch?.[3] || 0);
  const pass = summaryMatch ? String(summaryMatch[4]).toLowerCase() === "true" : false;

  return {
    platform,
    reportPath,
    total,
    pairs,
    fail,
    pass,
    exitCode: result.status || 0,
    output: output.trim(),
  };
}

function main() {
  const strict = getBool("--strict", true);
  const maxItemsRaw = Number(getArg("--max-items", "0"));
  const maxItems = Number.isFinite(maxItemsRaw) && maxItemsRaw > 0 ? maxItemsRaw : null;
  const maxFailPrintRaw = Number(getArg("--max-fail-print", "40"));
  const maxFailPrint = Number.isFinite(maxFailPrintRaw) && maxFailPrintRaw > 0 ? maxFailPrintRaw : 40;
  const explicitPlatforms = getList("--platforms", []);
  const reportDir = getArg("--report-dir", path.dirname(toAbs("scripts/qa")));

  const summaryPath = resolveSummaryPath();
  const availablePlatforms = parsePlatformsFromSummary(summaryPath);
  const platforms = explicitPlatforms.length ? explicitPlatforms : availablePlatforms;

  const results = [];
  let overallPass = true;

  for (const platform of platforms) {
    const check = runFidelityCheck(summaryPath, platform, {
      strict,
      maxItems,
      maxFailPrint,
      reportDir,
    });
    results.push(check);
    if (!check.pass || check.exitCode !== 0 || check.fail > 0) {
      overallPass = false;
    }
  }

  const payload = {
    startedAt: new Date().toISOString(),
    summaryPath,
    options: {
      strict,
      maxItems,
      maxFailPrint,
      platforms,
    },
    results,
    passed: results.every((item) => item.pass && item.exitCode === 0 && item.fail === 0),
  };

  const outReport = toAbs(getArg("--report", `${reportDir}/platform_fidelity_gate_${Date.now()}.json`));
  fs.writeFileSync(outReport, JSON.stringify(payload, null, 2));

  for (const item of results) {
    console.log(`[QA GATE] ${item.platform}: total=${item.total} fail=${item.fail} pairs=${item.pairs} pass=${item.pass}`);
  }

  if (payload.passed) {
    console.log(`QA_GATING_SUMMARY pass=true`);
    process.exit(0);
  }

  console.error(`QA_GATING_SUMMARY pass=false`);
  process.exit(1);
}

main();
