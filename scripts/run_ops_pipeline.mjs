#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

function hasArg(name) {
  return args.some((v) => v === name || v.startsWith(`${name}=`));
}

function getArg(name, fallback = null) {
  const idx = args.findIndex((v) => v === name || v.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=");
}

function parseBoolArg(name, fallback = false) {
  if (!hasArg(name)) {
    return fallback;
  }
  const raw = getArg(name, "true");
  if (raw === name) {
    return true;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "n"].includes(normalized)) return false;
  return true;
}

function runPhase(label, cmd, phaseArgs, spawnOpts = {}) {
  const result = spawnSync(cmd, phaseArgs, {
    stdio: "inherit",
    ...spawnOpts,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with code ${result.status}`);
  }
}

const root = process.cwd();
const bootstrapScript = path.resolve(root, "scripts", "db_bootstrap.mjs");
const pipelineScript = path.resolve(root, "scripts", "collect_ops_pipeline.mjs");
const apiServerScript = path.resolve(root, "scripts", "api_server.mjs");

if (hasArg("--help") || hasArg("-h")) {
  console.log(`Usage:
  node scripts/run_ops_pipeline.mjs [options]

수집/매칭 파이프라인 + API 서버를 순차 실행

옵션:
  --pipeline-only       수집 파이프라인만 실행 후 종료
  --serve               수집 후 API 서버 실행
  --skip-front-build    API 서버 실행 시 front:build 생략
  --start-server        --serve와 동일 동작
  --seed                bootstrap 시 시드 삽입 (샘플 seed)
  --skip-seed           bootstrap 시 시드 삽입 생략
  --skip-schema         bootstrap 스키마 실행 생략
  --schema=<path>       스키마 SQL 경로
  --seed-file=<path>    시드 SQL 경로
  --database=<name>     타깃 DB명
  --host=<host>         API 서버 host
  --port=<port>         API 서버 port
  --front-dir=<path>    API 서버 정적 프론트 경로
`);
  process.exit(0);
}

const orchestrationFlags = new Set([
  "--pipeline-only",
  "--serve",
  "--skip-front-build",
  "--start-server",
]);
const forwardedArgs = args.filter((arg) => {
  if (orchestrationFlags.has(arg)) return false;
  if (arg === "--help" || arg === "-h") return false;
  if (arg.startsWith("--front-dir")) return false;
  if (arg.startsWith("--host")) return false;
  if (arg.startsWith("--port")) return false;
  return true;
});

const pipelineOnly = hasArg("--pipeline-only");
const shouldServe = hasArg("--serve") || hasArg("--start-server");
const skipFrontBuild = hasArg("--skip-front-build");

// Step 1: bootstrap DB (schema)
const bootstrapPass = [
  ...forwardedArgs.filter((arg) => ![
    "--skip-schema",
    "--skip-seed",
    "--seed",
    "--seed-file",
    "--schema",
    "--database",
  ].some((prefix) => arg === prefix || arg.startsWith(`${prefix}=`))),
  ...(parseBoolArg("--skip-schema", false) ? ["--skip-schema"] : []),
  ...(hasArg("--schema") ? ["--schema", getArg("--schema")] : []),
  ...(hasArg("--seed-file") ? ["--seed-file", getArg("--seed-file")] : []),
  ...(hasArg("--database") ? ["--database", getArg("--database")] : []),
  ...(parseBoolArg("--skip-seed", false) ? ["--skip-seed"] : []),
];
if (!bootstrapPass.some((arg) => arg === "--database")) {
  bootstrapPass.push("--database", getArg("--database", "my_rent_finder"));
}
if (parseBoolArg("--seed", false) && !parseBoolArg("--skip-seed", false)) {
  bootstrapPass.push("--seed");
}

runPhase("DB bootstrap", process.execPath, [bootstrapScript, ...bootstrapPass]);

// Step 2: collect + matcher payload + DB persistence
const pipelinePass = [
  ...forwardedArgs,
  "--persist-to-db",
  "--persist-matches",
];
if (!hasArg("--normalize")) pipelinePass.push("--normalize");
runPhase(
  "Ops pipeline",
  process.execPath,
  [pipelineScript, ...pipelinePass],
  {},
);

if (pipelineOnly) {
  process.exit(0);
}

if (!shouldServe) {
  process.exit(0);
}

// Step 3: serve API + frontend
if (!skipFrontBuild) {
  runPhase("Frontend build", "npm", ["run", "front:build"], { cwd: root, shell: true });
}

const serverArgs = args.filter((arg) => (
  arg.startsWith("--host")
  || arg.startsWith("--port")
  || arg.startsWith("--front-dir")
));
if (!serverArgs.some((arg) => arg.startsWith("--front-dir"))) {
  serverArgs.push("--front-dir=frontend/dist");
}
if (!serverArgs.some((arg) => arg.startsWith("--host"))) {
  serverArgs.push("--host=127.0.0.1");
}
if (!serverArgs.some((arg) => arg.startsWith("--port"))) {
  serverArgs.push("--port=4100");
}

runPhase(
  "API server",
  process.execPath,
  [apiServerScript, ...serverArgs],
  { cwd: root },
);
