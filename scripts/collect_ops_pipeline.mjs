#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function toText(v, fallback = "") {
  if (v === null || v === undefined) return fallback;
  const text = String(v).trim();
  return text.length > 0 ? text : fallback;
}

function runPhase(label, scriptPath, extraArgs) {
  const result = spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with code ${result.status}`);
  }
}

function normalizeRunId(raw) {
  return toText(raw || new Date().toISOString(), "run").replace(/[T:.]/g, "-");
}

const runId = normalizeRunId(getArg("--run-id", null));
const outDir = getArg(
  "--out-dir",
  path.join("scripts", "parallel_collect_runs", runId),
);
const workspace = path.resolve(process.cwd(), outDir);

const collectScript = path.resolve(process.cwd(), "scripts", "run_parallel_collect.mjs");
const buildScript = path.resolve(process.cwd(), "scripts", "build_operations_payload.mjs");
const summaryPath = path.join(workspace, `parallel_collect_summary_${runId}.json`);

const collectPassThrough = args.filter((arg) => {
  return !(
    arg === "--run-id"
    || arg === "--out-dir"
    || arg.startsWith("--run-id=")
    || arg.startsWith("--out-dir=")
  );
});
const collectArgs = [
  ...collectPassThrough,
  "--run-id",
  runId,
  "--out-dir",
  workspace,
];
if (!hasArg("--persist-to-db")) {
  collectArgs.push("--persist-to-db");
}

runPhase("parallel collect", collectScript, collectArgs);

if (!fs.existsSync(summaryPath)) {
  throw new Error(`summary file not found: ${summaryPath}`);
}

const buildPassThrough = args.filter((arg) => {
  return !(
    arg === "--run-id"
    || arg === "--run-dir"
    || arg === "--summary"
    || arg.startsWith("--run-id=")
    || arg.startsWith("--run-dir=")
    || arg.startsWith("--summary=")
  );
});
const buildArgs = [
  ...buildPassThrough,
  "--run-id",
  runId,
  "--run-dir",
  workspace,
  "--summary",
  summaryPath,
  "--persist-to-db",
];
if (!hasArg("--persist-matches")) {
  buildArgs.push("--persist-matches");
}

runPhase("operations payload + matcher persistence", buildScript, buildArgs);

console.log(JSON.stringify({
  run_id: runId,
  workspace,
  summary_path: summaryPath,
  pipeline: "collect + operations persist-to-db + matcher persist",
}, null, 2));
