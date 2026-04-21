#!/usr/bin/env node

/**
 * 플랫폼 병렬 수집 오케스트레이터
 * - 조건으로 플랫폼 probe 실행
 * - 네이버는 Playwright stealth 수집기로 자동 실행
 * - 그 외는 platform_sampling_collect로 병렬 실행
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { persistSummaryToDb } from "./lib/ops_db_persistence.mjs";
import { warmUpDb } from "./lib/db_client.mjs";
import { buildFilterArgs, getArg, getBool, getInt, getList, normalizeCap } from "./lib/cli_utils.mjs";
import { TARGET_DISTRICTS as SEOULSUP_DISTRICTS } from "./lib/target_districts.mjs";

const args = process.argv.slice(2);

function asSampleCapArg(value) {
  if (Number.isFinite(value) && value > 0) return String(Math.floor(value));
  return "Infinity";
}

function asAdapterMaxArg(value) {
  if (Number.isFinite(value) && value > 0) return String(Math.floor(value));
  return "Infinity";
}

function splitCap(value, buckets) {
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  if (value <= 0 || !Number.isFinite(buckets) || buckets <= 0) return 0;
  const normalizedBuckets = Math.floor(Math.max(1, buckets));
  return Math.ceil(value / normalizedBuckets);
}

function resolveAbs(v, fallback = null) {
  if (fallback !== null && (v === null || String(v).trim() === "")) return path.resolve(process.cwd(), fallback);
  return path.resolve(process.cwd(), String(v));
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function sanitizeFileToken(v) {
  return (
    String(v || "")
      .replace(/[^\p{L}\p{N}\-_]/gu, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "item"
  );
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function expandSeoulsup(list) {
  return list.flatMap((s) => (s === "서울숲권역" ? SEOULSUP_DISTRICTS : [s]));
}

const scriptPaths = {
  probe: (() => {
    const candidates = [
      path.resolve(process.cwd(), "scripts/platform_query_probe.mjs"),
      path.resolve(process.cwd(), "scripts/archive/platform_query_probe.mjs"),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  })(),
  collect: path.resolve(process.cwd(), "scripts/platform_sampling_collect.mjs"),
  naverCollect: path.resolve(process.cwd(), "scripts/naver_auto_collector.mjs"),
  naverNormalize: path.resolve(process.cwd(), "scripts/naver_normalize.mjs"),
  zigbangCollect: path.resolve(process.cwd(), "scripts/zigbang_auto_collector.mjs"),
  dabangCollect: path.resolve(process.cwd(), "scripts/dabang_auto_collector.mjs"),
  listingAdapters: path.resolve(process.cwd(), "scripts/run_listing_adapters.mjs"),
  platformFidelityQa: path.resolve(process.cwd(), "scripts/qa/qa_platform_data_fidelity.mjs"),
  peterpanzCollect: path.resolve(process.cwd(), "scripts/peterpanz_auto_collector.mjs"),
  daangnCollect: path.resolve(process.cwd(), "scripts/daangn_auto_collector.mjs"),
  kblandCollect: path.resolve(process.cwd(), "scripts/kbland_auto_collector.mjs"),
  serveCollect: path.resolve(process.cwd(), "scripts/serve_auto_collector.mjs"),
};

const runId = getArg(args, "--run-id", new Date().toISOString().replace(/[T:.]/g, "-"));

const workspace = resolveAbs(getArg(args, "--out-dir", path.join("scripts", "parallel_collect_runs", runId)));
const qaReportPath = resolveAbs(
  getArg(args, "--qa-report", null),
  path.join(workspace, "qa_platform_data_fidelity_report.json"),
);
const probeOut = resolveAbs(getArg(args, "--probe-out", path.join(workspace, "platform_query_probe_results.json")));
const targetsIn = resolveAbs(getArg(args, "--targets", path.join(workspace, "platform_sampling_targets.json")));
const targetsOut = resolveAbs(
  getArg(args, "--targets-out", path.join(workspace, "platform_sampling_targets_parallel.json")),
);
const probeConditions = resolveAbs(
  getArg(args, "--conditions", path.join("scripts", "platform_search_conditions.json")),
  path.join("scripts", "platform_search_conditions.json"),
);

const maxParallel = Math.max(1, getInt(args, "--parallel", 3));
const sampleCap = normalizeCap(getArg(args, "--sample-cap", "0"), 0);
const delayMs = Math.max(100, getInt(args, "--delay-ms", 700));
const persistToDb = getBool(args, "--persist-to-db", false);
const runFidelityQA = !getBool(args, "--skip-platform-fidelity-qa", false);
const qaStrict = getBool(args, "--qa-strict", false); // advisory by default — use --qa-strict=true to fail on QA errors
const qaMaxItems = getInt(args, "--qa-max-items", 0);
const platformAlias = {
  zigbang: "zigbang",
  직방: "zigbang",
  dabang: "dabang",
  다방: "dabang",
  naver: "naver",
  "네이버 부동산": "naver",
  네이버부동산: "naver",
  피터팬: "peterpanz",
  peterpanz: "peterpanz",
  네모: "nemo",
  nemo: "nemo",
  호갱노노: "hogangnono",
  hogangnono: "hogangnono",
  당근: "daangn",
  당근마켓: "daangn",
  daangn: "daangn",
  kbland: "kbland",
  kb부동산: "kbland",
  kb: "kbland",
  KB부동산: "kbland",
  serve: "serve",
  부동산써브: "serve",
};
const selectedPlatforms = getList(args, "--platforms", ["zigbang", "dabang", "naver", "peterpanz", "daangn", "serve", "kbland"]);
function normalizePlatform(raw) {
  return (
    platformAlias[raw] ||
    String(raw || "")
      .trim()
      .toLowerCase()
  );
}
// kbland는 기본 목록에 없지만 --platforms=kbland로 명시적 지정 시 실행 가능 (점진적 활성화)
const normalizedRequestedPlatforms = selectedPlatforms
  .map((p) => normalizePlatform(p))
  .filter(Boolean);

if (normalizedRequestedPlatforms.length === 0) {
  console.error("[WARN] 실행 대상 플랫폼이 없습니다. 기본/요청된 플랫폼이 비활성화되었을 수 있습니다.");
}

const selectedPlatformList = normalizedRequestedPlatforms;
const verbose = getBool(args, "--verbose", false);
const runNormalize = getBool(args, "--normalize", true);
const forceNoNaver = getBool(args, "--no-naver", false);
const skipProbe = getBool(args, "--skip-probe", false);
const selectedSigunguList = getList(args, "--sigungu-list", []);
const naverMaxRegions = getInt(args, "--naver-max-regions", 8);
const overrideSigungu = getArg(args, "--sigungu", null);
const overrideSido = getArg(args, "--sido", null);
const overrideRentMax = getArg(args, "--rent-max", null);
const overrideDepositMax = getArg(args, "--deposit-max", null);
const overrideMinArea = getArg(args, "--min-area", null);
const overrideTradeType = getArg(args, "--trade-type", null);
const overridePropertyTypes = getList(args, "--property-types", []);

const timeoutMs = Math.max(500, getInt(args, "--timeout-ms", 12000));

function runNode(label, script, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const command = [script, ...args];
    if (verbose) {
      console.log(`[run] node ${command.join(" ")}`);
    }

    const cp = spawn(process.execPath, command, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    cp.stdout.on("data", (chunk) => {
      const txt = String(chunk);
      stdout += txt;
      if (options.stream) process.stdout.write(txt);
    });

    cp.stderr.on("data", (chunk) => {
      const txt = String(chunk);
      stderr += txt;
      if (options.stream) process.stderr.write(txt);
    });

    cp.on("error", (err) => {
      reject(err);
    });

    cp.on("close", (code) => {
      const result = {
        label,
        code,
        args,
        exitCode: code,
        durationMs: Date.now() - startedAt,
        stdout: stdout.slice(0, 4000),
        stderr: stderr.slice(0, 4000),
      };
      if (code === 0) {
        resolve(result);
      } else {
        const err = new Error(`[${label}] failed with code ${code}`);
        err.result = result;
        reject(err);
      }
    });
  });
}

function mergeConditions(baseConditionPath) {
  const base = readJson(baseConditionPath);
  const overrideHasValue = [
    overrideSido,
    overrideSigungu,
    overrideRentMax,
    overrideDepositMax,
    overrideMinArea,
    overrideTradeType,
    overridePropertyTypes.length > 0,
    selectedSigunguList.length,
  ].some((v) => v !== null && v !== undefined && v !== "" && v !== 0);

  if (!overrideHasValue) {
    return { file: baseConditionPath, merged: false };
  }

  const merged = {
    ...base,
    target: {
      ...(base.target || {}),
      ...(overrideSido ? { sido: overrideSido } : {}),
      ...(overrideSigungu ? { sigungu: overrideSigungu } : {}),
      ...(overrideRentMax ? { rentMax: Number(overrideRentMax) } : {}),
      ...(overrideDepositMax ? { depositMax: Number(overrideDepositMax) } : {}),
      ...(overrideMinArea ? { minAreaM2: Number(overrideMinArea) } : {}),
      ...(overrideTradeType ? { leaseType: overrideTradeType } : {}),
      ...(overridePropertyTypes.length ? { propertyTypes: overridePropertyTypes } : {}),
      ...(selectedSigunguList.length ? { sigunguList: unique(selectedSigunguList) } : {}),
    },
  };
  const mergedPath = path.join(workspace, "platform_search_conditions_merged.json");
  writeJson(mergedPath, merged);
  return { file: mergedPath, merged: true };
}

function resolveNaverTradeType(leaseTypeRaw) {
  if (!leaseTypeRaw) return "B2";
  const leaseType = String(leaseTypeRaw);
  if (/(B1|전세|jeonse)/i.test(leaseType)) return "B1";
  if (/(A1|매매|sale|매입)/i.test(leaseType)) return "A1";
  if (/(B2|월세|wolse|rent)/i.test(leaseType)) return "B2";
  return "B2";
}

function mapNaverPropertyTypes(propertyTypes) {
  const mapping = {
    "빌라/연립": "VL",
    연립: "YR",
    "단독/다가구": "DDDGG",
    단독: "DDDGG",
    다가구: "DDDGG",
    오피스텔: "OP",
    상가주택: "SGJT",
  };
  const mapped = new Set();
  for (const name of propertyTypes) {
    const code = mapping[String(name || "").trim()];
    if (code) mapped.add(code);
  }
  if (mapped.size === 0) return "DDDGG:JWJT:SGJT:VL:YR:DSD";
  mapped.add("DSD");
  return [...mapped].join(":");
}

function readConditionInput(conditionPath) {
  try {
    return readJson(conditionPath);
  } catch {
    return null;
  }
}

function normalizeNaverCondition(conditionInput, fallback) {
  const target = conditionInput?.target || conditionInput?.condition_input?.target || fallback || {};
  const propertyTypes =
    target.propertyTypes && Array.isArray(target.propertyTypes)
      ? target.propertyTypes
      : Array.isArray(fallback?.propertyTypes)
        ? fallback.propertyTypes
        : [];
  const sigunguList = Array.isArray(target.sigunguList) && target.sigunguList.length
    ? target.sigunguList
    : Array.isArray(fallback?.sigunguList) && fallback.sigunguList.length
      ? fallback.sigunguList
      : null;
  return {
    sigungu: target.sigungu || fallback?.sigungu || null,
    sigunguList,
    rentMax: Number.isFinite(Number(target.rentMax)) ? Number(target.rentMax) : null,
    depositMax: Number.isFinite(Number(target.depositMax)) ? Number(target.depositMax) : null,
    minAreaM2: Number.isFinite(Number(target.minAreaM2))
      ? Number(target.minAreaM2)
      : Number.isFinite(Number(target.minArea))
        ? Number(target.minArea)
        : null,
    tradeType: resolveNaverTradeType(overrideTradeType || target.tradeType || target.leaseType || target.lease_type),
    realEstateTypes: mapNaverPropertyTypes(overridePropertyTypes.length ? overridePropertyTypes : propertyTypes),
  };
}

async function runProbe() {
  const argsBase = [
    "--conditions",
    probeConditionsPath,
    "--timeout-ms",
    String(timeoutMs),
    "--delay-ms",
    String(delayMs),
    "--sample-cap",
    asSampleCapArg(sampleCap),
    "--probe-out",
    probeOut,
    "--targets-out",
    targetsOut,
  ];
  await runNode("platform_query_probe", scriptPaths.probe, argsBase, { stream: false });
}

function makePlatformTargets(rawTargets) {
  const map = new Map();
  for (const t of rawTargets) {
    const code = normalizePlatform(t.platform_code || t.platform || "");
    if (!code) continue;
    if (!selectedCodesSet.has(code)) continue;
    if (!map.has(code)) map.set(code, []);
    map.get(code).push({
      ...t,
      platform_code: code,
    });
  }
  return map;
}

function extractSigunguCandidates(rawTargets) {
  const list = rawTargets.map((t) => t?.query_hint?.sigungu || t?.query_hint?.gu).filter(Boolean);
  return unique(list).filter(Boolean);
}

function buildJobs(targetMap, targetsFileUsed, conditionData) {
  const jobs = [];

  for (const code of selectedPlatformList) {
    if (code === "naver" && forceNoNaver) {
      continue;
    }

    const normalizedCode = code;
    const targets = targetMap.get(normalizedCode) || [];
    if (normalizedCode === "naver") {
      const naverSigunguFromTarget = extractSigunguCandidates(targets);
      const fallbackSigungu = conditionData?.target?.sigungu || conditionData?.target?.siGunGu;
      const naverFilters = conditionData?.filters || {};
      const sigunguCandidates = unique(
        expandSeoulsup([
          ...naverSigunguFromTarget,
          ...selectedSigunguList,
          ...(overrideSigungu ? [overrideSigungu] : []),
          ...(fallbackSigungu ? [fallbackSigungu] : ["노원구"]),
        ].filter(Boolean)),
      ).slice(0, Math.max(1, naverMaxRegions));

      if (sigunguCandidates.length === 0) {
        jobs.push({
          name: "naver",
          run: async () => ({
            platform: "naver",
            success: true,
            skipped: true,
            reason: "sigungu target missing",
          }),
        });
        continue;
      }

      const perSigunguCap = splitCap(sampleCap, sigunguCandidates.length);
      for (const sigungu of sigunguCandidates) {
        jobs.push({
          name: `naver:${sigungu}`,
          run: async () => {
            const safe = sanitizeFileToken(sigungu);
            const rawFile = path.join(workspace, `naver_raw_${runId}_${safe}.jsonl`);
            const metaFile = path.join(workspace, `naver_meta_${runId}_${safe}.json`);
            const naverArgs = [
              "--sigungu",
              sigungu,
              "--sample-cap",
              asSampleCapArg(perSigunguCap),
              "--output-raw",
              rawFile,
              "--output-meta",
              metaFile,
            ];

            if (naverFilters.tradeType) {
              naverArgs.push("--trade-type", naverFilters.tradeType);
            }
            if (Number.isFinite(Number(naverFilters.rentMax))) {
              naverArgs.push("--rent-max", String(naverFilters.rentMax));
            }
            if (Number.isFinite(Number(naverFilters.depositMax))) {
              naverArgs.push("--deposit-max", String(naverFilters.depositMax));
            }
            if (Number.isFinite(Number(naverFilters.minAreaM2))) {
              naverArgs.push("--min-area", String(Math.floor(naverFilters.minAreaM2)));
            }
            if (naverFilters.realEstateTypes) {
              naverArgs.push("--real-estate-types", naverFilters.realEstateTypes);
            }
            const collectResult = await runNode(`naver_auto:${sigungu}`, scriptPaths.naverCollect, naverArgs, {
              stream: true,
            });

            let normalizedPath = null;
            if (runNormalize) {
              normalizedPath = path.join(workspace, `naver_normalized_${runId}_${safe}.json`);
              const normalizeResult = await runNode(
                `naver_normalize:${sigungu}`,
                scriptPaths.naverNormalize,
                [
                  "--input",
                  rawFile,
                  "--output",
                  normalizedPath,
                  "--max-items",
                  asAdapterMaxArg(perSigunguCap * 2),
                  "--lease-type",
                  naverFilters.tradeType || "B2",
                  ...(Number.isFinite(Number(naverFilters.rentMax))
                    ? ["--rent-max", String(naverFilters.rentMax)]
                    : []),
                  ...(Number.isFinite(Number(naverFilters.depositMax))
                    ? ["--deposit-max", String(naverFilters.depositMax)]
                    : []),
                  ...(Number.isFinite(Number(naverFilters.minAreaM2))
                    ? ["--min-area", String(Math.floor(naverFilters.minAreaM2))]
                    : []),
                ],
                { stream: false },
              );
              normalizedPath = path.join(workspace, `naver_normalized_${runId}_${safe}.json`);
              const adapterResult = await runNode(
                `naver_adapter:${sigungu}`,
                scriptPaths.listingAdapters,
                [
                  "--platform",
                  "naver",
                  "--input",
                  rawFile,
                  "--out",
                  normalizedPath,
                  "--max-items",
                  asAdapterMaxArg(perSigunguCap),
                  ...(Number.isFinite(Number(naverFilters.rentMax))
                    ? ["--rent-max", String(naverFilters.rentMax)]
                    : []),
                  ...(Number.isFinite(Number(naverFilters.depositMax))
                    ? ["--deposit-max", String(naverFilters.depositMax)]
                    : []),
                  ...(Number.isFinite(Number(naverFilters.minAreaM2))
                    ? ["--min-area", String(Math.floor(naverFilters.minAreaM2))]
                    : []),
                  // serve 2-phase dedup: serve 먼저 수집된 경우 동일 매물 스킵
                  ...(collectCtx.serveNaverCrossRefsFile
                    ? ["--skip-cross-refs-file", collectCtx.serveNaverCrossRefsFile]
                    : []),
                ],
                { stream: false },
              );
              return {
                platform: "naver",
                sigungu,
                rawFile,
                metaFile,
                normalizedPath,
                collectResult,
                normalizeResult,
                adapterResult,
                targetCap: perSigunguCap,
                success: true,
              };
            }

            return {
              platform: "naver",
              sigungu,
              rawFile,
              metaFile,
              targetCap: perSigunguCap,
              collectResult,
              success: true,
            };
          },
        });
      }
      continue;
    }

    if (normalizedCode === "zigbang") {
      const zigbangSigunguFromTarget = extractSigunguCandidates(targets);
      const fallbackSigunguList = conditionData?.target?.sigunguList || [];
      const fallbackSigungu = conditionData?.target?.sigungu;
      const sigunguCandidates = unique(
        expandSeoulsup([
          ...zigbangSigunguFromTarget,
          ...selectedSigunguList,
          ...(overrideSigungu ? [overrideSigungu] : []),
          ...(fallbackSigunguList.length ? fallbackSigunguList : fallbackSigungu ? [fallbackSigungu] : ["노원구"]),
        ].filter(Boolean)),
      ).slice(0, Math.max(1, naverMaxRegions));

      if (sigunguCandidates.length === 0) {
        jobs.push({
          name: "zigbang",
          run: async () => ({
            platform: "zigbang",
            success: true,
            skipped: true,
            reason: "sigungu target missing",
          }),
        });
        continue;
      }

      const perSigunguCap = splitCap(sampleCap, sigunguCandidates.length);
      for (const sigungu of sigunguCandidates) {
        jobs.push({
          name: `zigbang:${sigungu}`,
          run: async () => {
            const safe = sanitizeFileToken(sigungu);
            const rawFile = path.join(workspace, `zigbang_raw_${runId}_${safe}.jsonl`);
            const metaFile = path.join(workspace, `zigbang_meta_${runId}_${safe}.json`);
            const zigbangArgs = [
              "--sigungu",
              sigungu,
              "--sample-cap",
              asSampleCapArg(perSigunguCap),
              "--output-raw",
              rawFile,
              "--output-meta",
              metaFile,
            ];

            const zbFilters = conditionData?.filters || {};
            const zbFilterArgs = buildFilterArgs({
              rentMax: zbFilters.rentMax,
              depositMax: zbFilters.depositMax,
              minAreaM2: zbFilters.minAreaM2,
            });
            zigbangArgs.push(...zbFilterArgs);

            const collectResult = await runNode(`zigbang_auto:${sigungu}`, scriptPaths.zigbangCollect, zigbangArgs, {
              stream: true,
            });

            let normalizedPath = null;
            let normalizeResult = null;
            if (runNormalize) {
              normalizedPath = path.join(workspace, `zigbang_normalized_${runId}_${safe}.json`);
              normalizeResult = await runNode(
                `zigbang_adapter:${sigungu}`,
                scriptPaths.listingAdapters,
                [
                  "--platform",
                  "zigbang",
                  "--input",
                  rawFile,
                  "--out",
                  normalizedPath,
                  "--max-items",
                  asAdapterMaxArg(perSigunguCap),
                  ...zbFilterArgs,
                ],
                { stream: false },
              );
            }

            return {
              platform: "zigbang",
              sigungu,
              rawFile,
              metaFile,
              normalizedPath,
              collectResult,
              normalizeResult,
              targetCap: perSigunguCap,
              success: true,
            };
          },
        });
      }
      continue;
    }

    if (normalizedCode === "peterpanz") {
      const ppSigunguFromTarget = extractSigunguCandidates(targets);
      const fallbackSigunguList = conditionData?.target?.sigunguList || [];
      const fallbackSigungu = conditionData?.target?.sigungu;
      const sigunguCandidates = unique(
        expandSeoulsup([
          ...ppSigunguFromTarget,
          ...selectedSigunguList,
          ...(overrideSigungu ? [overrideSigungu] : []),
          ...(fallbackSigunguList.length ? fallbackSigunguList : fallbackSigungu ? [fallbackSigungu] : ["노원구"]),
        ].filter(Boolean)),
      ).slice(0, Math.max(1, naverMaxRegions));

      if (sigunguCandidates.length === 0) {
        jobs.push({
          name: "peterpanz",
          run: async () => ({
            platform: "peterpanz",
            success: true,
            skipped: true,
            reason: "sigungu target missing",
          }),
        });
        continue;
      }

      const perSigunguCap = splitCap(sampleCap, sigunguCandidates.length);
      for (const sigungu of sigunguCandidates) {
        jobs.push({
          name: `peterpanz:${sigungu}`,
          run: async () => {
            const safe = sanitizeFileToken(sigungu);
            const rawFile = path.join(workspace, `peterpanz_raw_${runId}_${safe}.jsonl`);
            const metaFile = path.join(workspace, `peterpanz_meta_${runId}_${safe}.json`);
            const ppArgs = [
              "--sigungu",
              sigungu,
              "--sample-cap",
              asSampleCapArg(perSigunguCap),
              "--output-raw",
              rawFile,
              "--output-meta",
              metaFile,
            ];

            const ppFilters = conditionData?.filters || {};
            const ppFilterArgs = buildFilterArgs({
              rentMax: overrideRentMax || ppFilters.rentMax,
              depositMax: overrideDepositMax || ppFilters.depositMax,
              minAreaM2: overrideMinArea || ppFilters.minAreaM2,
            });
            ppArgs.push(...ppFilterArgs);

            const collectResult = await runNode(`peterpanz_auto:${sigungu}`, scriptPaths.peterpanzCollect, ppArgs, {
              stream: true,
            });

            let normalizedPath = null;
            let normalizeResult = null;
            if (runNormalize) {
              normalizedPath = path.join(workspace, `peterpanz_normalized_${runId}_${safe}.json`);
              normalizeResult = await runNode(
                `peterpanz_adapter:${sigungu}`,
                scriptPaths.listingAdapters,
                [
                  "--platform",
                  "peterpanz",
                  "--input",
                  rawFile,
                  "--out",
                  normalizedPath,
                  "--max-items",
                  asAdapterMaxArg(perSigunguCap),
                  ...ppFilterArgs,
                ],
                { stream: false },
              );
            }

            return {
              platform: "peterpanz",
              sigungu,
              rawFile,
              metaFile,
              normalizedPath,
              normalizeResult,
              collectResult,
              targetCap: perSigunguCap,
              success: true,
            };
          },
        });
      }
      continue;
    }

    if (normalizedCode === "daangn") {
      const daangnSigunguFromTarget = extractSigunguCandidates(targets);
      const daangnKnownDistricts = ["종로구", "중구", "성북구", "성동구", "동대문구", "광진구", "중랑구", "노원구"];
      const fallbackSigungu = conditionData?.target?.sigungu;
      const sigunguCandidates = unique(
        expandSeoulsup([
          ...daangnSigunguFromTarget,
          ...selectedSigunguList,
          ...(overrideSigungu ? [overrideSigungu] : []),
          ...(daangnSigunguFromTarget.length === 0 && !selectedSigunguList.length ? daangnKnownDistricts : []),
          ...(fallbackSigungu ? [fallbackSigungu] : []),
        ].filter(Boolean)),
      ).slice(0, Math.max(1, naverMaxRegions));

      if (sigunguCandidates.length === 0) {
        jobs.push({
          name: "daangn",
          run: async () => ({
            platform: "daangn",
            success: true,
            skipped: true,
            reason: "sigungu target missing",
          }),
        });
        continue;
      }

      const perSigunguCap = splitCap(sampleCap, sigunguCandidates.length);
      for (const sigungu of sigunguCandidates) {
        jobs.push({
          name: `daangn:${sigungu}`,
          run: async () => {
            const safe = sanitizeFileToken(sigungu);
            const rawFile = path.join(workspace, `daangn_raw_${runId}_${safe}.jsonl`);
            const metaFile = path.join(workspace, `daangn_meta_${runId}_${safe}.json`);
            const daangnArgs = [
              "--sigungu",
              sigungu,
              "--sample-cap",
              asSampleCapArg(perSigunguCap),
              "--output-raw",
              rawFile,
              "--output-meta",
              metaFile,
            ];

            const daangnFilters = conditionData?.filters || {};
            const daangnFilterArgs = buildFilterArgs({
              rentMax: overrideRentMax || daangnFilters.rentMax,
              depositMax: overrideDepositMax || daangnFilters.depositMax,
              minAreaM2: overrideMinArea || daangnFilters.minAreaM2,
            });
            daangnArgs.push(...daangnFilterArgs);

            const collectResult = await runNode(`daangn_auto:${sigungu}`, scriptPaths.daangnCollect, daangnArgs, {
              stream: true,
            });

            let normalizedPath = null;
            let normalizeResult = null;
            if (runNormalize) {
              normalizedPath = path.join(workspace, `daangn_normalized_${runId}_${safe}.json`);
              normalizeResult = await runNode(
                `daangn_adapter:${sigungu}`,
                scriptPaths.listingAdapters,
                [
                  "--platform",
                  "daangn",
                  "--input",
                  rawFile,
                  "--out",
                  normalizedPath,
                  "--max-items",
                  asAdapterMaxArg(perSigunguCap),
                  ...daangnFilterArgs,
                ],
                { stream: false },
              );
            }

            return {
              platform: "daangn",
              sigungu,
              rawFile,
              metaFile,
              normalizedPath,
              normalizeResult,
              collectResult,
              targetCap: perSigunguCap,
              success: true,
            };
          },
        });
      }
      continue;
    }

    if (normalizedCode === "dabang") {
      const dabangSigunguFromTarget = extractSigunguCandidates(targets);
      const fallbackSigungu = conditionData?.target?.sigungu;
      const sigunguCandidates = unique(
        [
          ...dabangSigunguFromTarget,
          ...selectedSigunguList,
          ...(overrideSigungu ? [overrideSigungu] : []),
          ...(fallbackSigungu ? [fallbackSigungu] : ["노원구"]),
        ].filter(Boolean),
      ).slice(0, Math.max(1, naverMaxRegions));

      if (sigunguCandidates.length === 0) {
        jobs.push({
          name: "dabang",
          run: async () => ({
            platform: "dabang",
            success: true,
            skipped: true,
            reason: "sigungu target missing",
          }),
        });
        continue;
      }

      const perSigunguCap = splitCap(sampleCap, sigunguCandidates.length);
      for (const sigungu of sigunguCandidates) {
        jobs.push({
          name: `dabang:${sigungu}`,
          run: async () => {
            const safe = sanitizeFileToken(sigungu);
            const rawFile = path.join(workspace, `dabang_raw_${runId}_${safe}.jsonl`);
            const metaFile = path.join(workspace, `dabang_meta_${runId}_${safe}.json`);
            const dabangArgs = [
              "--sigungu",
              sigungu,
              "--sample-cap",
              asSampleCapArg(perSigunguCap),
              "--output-raw",
              rawFile,
              "--output-meta",
              metaFile,
            ];

            const dabangFilters = conditionData?.filters || {};
            const dabangFilterArgs = buildFilterArgs({
              rentMax: dabangFilters.rentMax,
              depositMax: dabangFilters.depositMax,
              minAreaM2: dabangFilters.minAreaM2,
            });
            dabangArgs.push(...dabangFilterArgs);

            const collectResult = await runNode(`dabang_auto:${sigungu}`, scriptPaths.dabangCollect, dabangArgs, {
              stream: true,
            });

            let normalizedPath = null;
            let normalizeResult = null;
            if (runNormalize) {
              normalizedPath = path.join(workspace, `dabang_normalized_${runId}_${safe}.json`);
              normalizeResult = await runNode(
                `dabang_adapter:${sigungu}`,
                scriptPaths.listingAdapters,
                [
                  "--platform",
                  "dabang",
                  "--input",
                  rawFile,
                  "--out",
                  normalizedPath,
                  "--max-items",
                  asAdapterMaxArg(perSigunguCap),
                  ...dabangFilterArgs,
                ],
                { stream: false },
              );
            }

            return {
              platform: "dabang",
              sigungu,
              rawFile,
              metaFile,
              normalizedPath,
              collectResult,
              normalizeResult,
              targetCap: perSigunguCap,
              success: true,
            };
          },
        });
      }
      continue;
    }

    if (normalizedCode === "kbland") {
      const kblandSigunguFromTarget = extractSigunguCandidates(targets);
      const fallbackSigunguList = conditionData?.target?.sigunguList || [];
      const fallbackSigungu = conditionData?.target?.sigungu;
      const sigunguCandidates = unique(
        expandSeoulsup([
          ...kblandSigunguFromTarget,
          ...selectedSigunguList,
          ...(overrideSigungu ? [overrideSigungu] : []),
          ...(fallbackSigunguList.length ? fallbackSigunguList : fallbackSigungu ? [fallbackSigungu] : ["노원구"]),
        ].filter(Boolean)),
      ).slice(0, Math.max(1, naverMaxRegions));

      if (sigunguCandidates.length === 0) {
        jobs.push({
          name: "kbland",
          run: async () => ({
            platform: "kbland",
            success: true,
            skipped: true,
            reason: "sigungu target missing",
          }),
        });
        continue;
      }

      // kbland는 Chrome CDP 단일 세션 사용 → 하나의 프로세스가 --sigungu-list로 순차 처리
      jobs.push({
        name: "kbland",
        run: async () => {
          const rawFile = path.join(workspace, `kbland_raw_${runId}.jsonl`);
          const metaFile = path.join(workspace, `kbland_meta_${runId}.json`);
          const kblandArgs = [
            "--sigungu-list",
            sigunguCandidates.join(","),
            "--sample-cap",
            asSampleCapArg(sampleCap),
            "--output-raw",
            rawFile,
            "--output-meta",
            metaFile,
            "--cdp-port=9998",
          ];

          const kblandFilters = conditionData?.filters || {};
          const kblandFilterArgs = buildFilterArgs({
            rentMax: kblandFilters.rentMax,
            depositMax: kblandFilters.depositMax,
            minAreaM2: kblandFilters.minAreaM2,
          });
          kblandArgs.push(...kblandFilterArgs);

          const collectResult = await runNode("kbland_auto", scriptPaths.kblandCollect, kblandArgs, {
            stream: true,
          });

          let normalizedPath = null;
          let normalizeResult = null;
          if (runNormalize) {
            normalizedPath = path.join(workspace, `kbland_normalized_${runId}.json`);
            normalizeResult = await runNode(
              "kbland_adapter",
              scriptPaths.listingAdapters,
              [
                "--platform",
                "kbland",
                "--input",
                rawFile,
                "--out",
                normalizedPath,
                "--max-items",
                asAdapterMaxArg(sampleCap),
                ...kblandFilterArgs,
              ],
              { stream: false },
            );
          }

          return {
            platform: "kbland",
            sigungu: sigunguCandidates.join(","),
            rawFile,
            metaFile,
            normalizedPath,
            collectResult,
            normalizeResult,
            targetCap: sampleCap,
            success: true,
          };
        },
      });
      continue;
    }

    if (normalizedCode === "serve") {
      const serveSigunguFromTarget = extractSigunguCandidates(targets);
      const fallbackSigunguList = conditionData?.target?.sigunguList || [];
      const fallbackSigungu = conditionData?.target?.sigungu;
      const sigunguCandidates = unique(
        expandSeoulsup([
          ...serveSigunguFromTarget,
          ...selectedSigunguList,
          ...(overrideSigungu ? [overrideSigungu] : []),
          ...(fallbackSigunguList.length ? fallbackSigunguList : fallbackSigungu ? [fallbackSigungu] : ["성동구"]),
        ].filter(Boolean)),
      ).slice(0, Math.max(1, naverMaxRegions));

      const perSigunguCap = splitCap(sampleCap, sigunguCandidates.length);
      for (const sigungu of sigunguCandidates) {
        jobs.push({
          name: `serve:${sigungu}`,
          _phase: 1,
          run: async () => {
            const safe = sanitizeFileToken(sigungu);
            const rawFile = path.join(workspace, `serve_raw_${runId}_${safe}.jsonl`);
            const metaFile = path.join(workspace, `serve_meta_${runId}_${safe}.json`);
            const serveArgs = [
              "--sigungu",
              sigungu,
              "--sample-cap",
              asSampleCapArg(perSigunguCap),
              "--output-raw",
              rawFile,
              "--output-meta",
              metaFile,
            ];

            const serveFilters = conditionData?.filters || {};
            const serveFilterArgs = buildFilterArgs({
              rentMax: serveFilters.rentMax,
              depositMax: serveFilters.depositMax,
              minAreaM2: serveFilters.minAreaM2,
            });
            serveArgs.push(...serveFilterArgs);

            const collectResult = await runNode(`serve_auto:${sigungu}`, scriptPaths.serveCollect, serveArgs, {
              stream: true,
            });

            let normalizedPath = null;
            let normalizeResult = null;
            if (runNormalize) {
              normalizedPath = path.join(workspace, `serve_normalized_${runId}_${safe}.json`);
              normalizeResult = await runNode(
                "serve_adapter",
                scriptPaths.listingAdapters,
                [
                  "--platform",
                  "serve",
                  "--input",
                  rawFile,
                  "--out",
                  normalizedPath,
                  "--max-items",
                  asAdapterMaxArg(perSigunguCap),
                  ...serveFilterArgs,
                ],
                { stream: false },
              );
            }

            return {
              platform: "serve",
              sigungu,
              rawFile,
              metaFile,
              normalizedPath,
              collectResult,
              normalizeResult,
              targetCap: perSigunguCap,
              success: true,
            };
          },
        });
      }
      continue;
    }

    if (targets.length === 0) {
      jobs.push({
        name: normalizedCode,
        run: async () => ({
          platform: normalizedCode,
          skipped: true,
          reason: "target missing",
        }),
      });
      continue;
    }

    const platformTargetPath = path.join(workspace, `${normalizedCode}_targets_${runId}.json`);
    writeJson(platformTargetPath, {
      runMeta: targetFile.runMeta || {
        runId,
        createdAt: new Date().toISOString(),
      },
      thresholds: targetFile.thresholds || {
        requiredFieldsRate: 0.85,
        violationRate: 0.08,
        parseFailRate: 0.08,
        imageValidRate: 0.9,
      },
      targets,
    });

    const outFile = path.join(workspace, `${normalizedCode}_collect_${runId}.json`);
    jobs.push({
      name: normalizedCode,
      run: async () => {
        const collectResult = await runNode(
          `collect:${normalizedCode}`,
          scriptPaths.collect,
          [
            "--input",
            platformTargetPath,
            "--out",
            outFile,
            "--sample-cap",
            asSampleCapArg(sampleCap),
            "--delay-ms",
            String(delayMs),
          ],
          { stream: false },
        );
        return {
          platform: normalizedCode,
          input: platformTargetPath,
          output: outFile,
          countTargets: targets.length,
          sampleCap,
          collectResult,
          success: true,
        };
      },
    });
  }

  return jobs;
}

async function runJobs(jobs, concurrency, { onComplete } = {}) {
  const results = [];
  let pointer = 0;
  // persist는 직렬화: 동시 실행 시 Neon에 쿼리 폭탄이 몰려 query timeout 유발
  let persistQueue = Promise.resolve();

  async function worker() {
    while (pointer < jobs.length) {
      const current = pointer++;
      const job = jobs[current];
      const jobLabel = job.name || `job_${current + 1}`;
      const started = new Date().toISOString();

      try {
        const data = await job.run();
        results[current] = {
          name: jobLabel,
          startedAt: started,
          finishedAt: new Date().toISOString(),
          ok: true,
          ...data,
        };
        // 잡 완료 직후 스트리밍 persist — 직렬 큐로 실행 (동시 persist 금지)
        if (onComplete) {
          persistQueue = persistQueue.then(() =>
            onComplete(results[current]).catch((e) =>
              console.error(`[STREAM_PERSIST] ${jobLabel} DB 저장 실패: ${e?.message || e}`),
            ),
          );
        }
      } catch (error) {
        const result = {
          name: jobLabel,
          startedAt: started,
          finishedAt: new Date().toISOString(),
          ok: false,
          error: {
            message: error?.message || "unknown",
          },
        };
        if (error?.result) {
          result.process = error.result;
        }
        results[current] = result;
      }
    }
  }

  const loops = Array.from({ length: Math.min(concurrency, Math.max(1, jobs.length)) }, () => worker());
  await Promise.all(loops);
  await persistQueue;
  return results.filter(Boolean);
}

function isAlias(value) {
  return normalizePlatform(value) !== null;
}

const selectedCodesSet = new Set(selectedPlatformList.map((p) => normalizePlatform(p)).filter(Boolean));

let probeConditionsPath = probeConditions;
const mergeResult = mergeConditions(probeConditions);
if (mergeResult.merged) {
  probeConditionsPath = mergeResult.file;
}
const conditionInput = readConditionInput(probeConditionsPath);
const naverCondition = normalizeNaverCondition(conditionInput, {
  propertyTypes: conditionInput?.condition_input?.target?.propertyTypes || [],
});

const startAt = new Date().toISOString();
if (!skipProbe || !fs.existsSync(targetsIn)) {
  if (!skipProbe) {
    await runProbe();
  }
}

const baseDir = path.dirname(targetsIn);
if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir, { recursive: true });
}

const targetsFile = skipProbe ? readJson(targetsIn) : readJson(targetsOut);
const targetFile = {
  ...targetsFile,
  target: naverCondition,
};
const targetMap = makePlatformTargets(targetFile.targets || []);
// 2-phase 수집: serve가 Phase 1으로 먼저 완료 → naverAtclNo 추출 → Phase 2(naver/kbland 등)에서 중복 스킵
const collectCtx = { serveNaverCrossRefsFile: null };

const jobs = buildJobs(targetMap, targetFile, {
  target: naverCondition,
  filters: naverCondition,
});

// 잡 완료 직후 해당 플랫폼만 즉시 DB에 저장 (upsert라 중복 안전)
async function persistJobResult(result) {
  if (!result?.ok || result?.skipped) return;
  if (!result?.normalizedPath && !result?.rawFile) return;
  const safe = (result.name || "job").replace(/[:/\\]/g, "_");
  const miniPath = path.join(workspace, `mini_summary_${safe}_${runId}.json`);
  writeJson(miniPath, {
    runId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    workspace,
    results: [result],
  });
  // withDbClient가 커넥션 단위 재시도, 여기선 Neon 장기 다운 대응 (30s/60s 간격)
  const MAX_PERSIST_RETRIES = 3;
  try {
    for (let attempt = 1; attempt <= MAX_PERSIST_RETRIES; attempt++) {
      try {
        const persisted = await persistSummaryToDb(miniPath, { runId });
        console.log(`[STREAM_PERSIST] ${result.name}: ${persisted?.normalizedCount ?? 0}건 DB 저장 완료`);
        return;
      } catch (e) {
        if (attempt >= MAX_PERSIST_RETRIES) throw e;
        const delay = 30000 * attempt; // 30s, 60s
        console.warn(`[STREAM_PERSIST] ${result.name} 저장 실패 (${attempt}/${MAX_PERSIST_RETRIES}), ${delay / 1000}s 후 재시도: ${e.message}`);
        await new Promise((r) => setTimeout(r, delay));
        await warmUpDb().catch(() => {});
      }
    }
  } finally {
    try { fs.unlinkSync(miniPath); } catch {}
  }
}

const streamPersist = persistToDb ? persistJobResult : undefined;

// 수집 시작 전 Neon DB를 미리 웜업 — persist 첫 요청이 cold start를 만나 timeout 폭탄 방지
if (persistToDb) {
  await warmUpDb().catch((e) => console.warn("[db] warm-up 실패 (무시):", e.message));
}

const phase1Jobs = jobs.filter((j) => j._phase === 1);
const phase2Jobs = jobs.filter((j) => j._phase !== 1);

let phase1Results = [];
if (phase1Jobs.length > 0) {
  phase1Results = await runJobs(phase1Jobs, maxParallel, { onComplete: streamPersist });

  // serve raw 파일에서 naverAtclNo 추출
  const serveNaverIds = [];
  for (const r of phase1Results) {
    if (r?.ok && r.rawFile && fs.existsSync(r.rawFile)) {
      const lines = fs.readFileSync(r.rawFile, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.naverAtclNo) serveNaverIds.push(String(obj.naverAtclNo));
        } catch {}
      }
    }
  }

  if (serveNaverIds.length > 0) {
    const crossRefsFile = path.join(workspace, `serve_naver_cross_refs_${runId}.json`);
    fs.writeFileSync(crossRefsFile, JSON.stringify(serveNaverIds));
    collectCtx.serveNaverCrossRefsFile = crossRefsFile;
    console.log(`[SERVE_DEDUP] serve에서 ${serveNaverIds.length}개 naverAtclNo 추출 → 네이버 어댑터에서 중복 스킵`);
  }
}

const phase2Results = await runJobs(phase2Jobs, maxParallel, { onComplete: streamPersist });
const results = [...phase1Results, ...phase2Results];

function assessDataQuality(result) {
  if (!result || !result.ok) return { grade: "FAIL", reason: "job_failed" };
  if (result.skipped) return { grade: "SKIP", reason: result.reason || "skipped" };

  // Try to read meta file for naver/zigbang
  const metaFile = result.metaFile;
  if (metaFile && fs.existsSync(metaFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
      const totalListings = meta.apiCollect?.totalListings || meta.totalListings || 0;
      const clickedListings = meta.clickedListings || 0;
      const dataQuality = meta.dataQuality;
      if (dataQuality) return dataQuality;
      if (totalListings >= 10) return { grade: "GOOD", listings: totalListings };
      if (totalListings > 0 || clickedListings > 0)
        return { grade: "PARTIAL", listings: totalListings, clicked: clickedListings };
      return { grade: "EMPTY", listings: 0 };
    } catch {}
  }

  // For generic platforms, check the output file
  const outputFile = result.output;
  if (outputFile && fs.existsSync(outputFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(outputFile, "utf8"));
      const samples = data.platforms?.[0]?.samples || data.samples || [];
      const failed = samples.filter((s) => s.sample_status === "FAILED").length;
      const total = samples.length;
      if (total === 0) return { grade: "EMPTY", samples: 0 };
      if (failed === total) return { grade: "FAIL", failedSamples: failed, totalSamples: total };
      if (failed > total * 0.5) return { grade: "PARTIAL", failedSamples: failed, totalSamples: total };
      return { grade: "GOOD", failedSamples: failed, totalSamples: total };
    } catch {}
  }

  return { grade: "UNKNOWN" };
}

for (const r of results) {
  r.dataQuality = assessDataQuality(r);
}

const endAt = new Date().toISOString();
const summary = {
  runId,
  startedAt: startAt,
  finishedAt: endAt,
  workspace,
  runOptions: {
    sampleCap: Number.isFinite(sampleCap) ? sampleCap : 0,
    delayMs,
    maxParallel,
    selectedPlatforms: Array.from(selectedCodesSet),
    verbose,
    normalizeNaver: runNormalize,
    skipProbe,
  },
  conditionsFile: probeConditionsPath,
  targetsFile: skipProbe ? targetsIn : targetsOut,
  totals: {
    jobs: results.length,
    succeeded: results.filter((r) => r?.ok).length,
    skipped: results.filter((r) => r?.ok && r.skipped).length,
    failed: results.filter((r) => !r?.ok).length,
    qualityGood: results.filter((r) => r?.dataQuality?.grade === "GOOD").length,
    qualityPartial: results.filter((r) => r?.dataQuality?.grade === "PARTIAL").length,
    qualityFail: results.filter((r) => ["FAIL", "EMPTY"].includes(r?.dataQuality?.grade)).length,
  },
  results,
};

const summaryPath = path.join(workspace, `parallel_collect_summary_${runId}.json`);
writeJson(summaryPath, summary);

let dbPersist = null;
if (persistToDb) {
  const MAX_FINAL_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_FINAL_RETRIES; attempt++) {
    try {
      dbPersist = await persistSummaryToDb(summaryPath, { runId });
      if (dbPersist?.priceChangedCount > 0) {
        console.log(`[PRICE_TRACK] ${dbPersist.priceChangedCount} price change(s) recorded`);
      }
      break;
    } catch (error) {
      if (attempt >= MAX_FINAL_RETRIES) {
        console.error(`DB persistence required but failed: ${error?.message || error}`);
        throw error;
      }
      const delay = 30000 * attempt;
      console.warn(`[DB_PERSIST] 최종 저장 실패 (${attempt}/${MAX_FINAL_RETRIES}), ${delay / 1000}s 후 재시도: ${error?.message}`);
      await new Promise((r) => setTimeout(r, delay));
      await warmUpDb().catch(() => {});
    }
  }
}

let qaResult = null;
if (runFidelityQA) {
  const qaArgs = ["--summary", summaryPath, "--report", qaReportPath, "--strict", String(qaStrict)];
  if (qaMaxItems > 0) {
    qaArgs.push("--max-items", String(qaMaxItems));
  }
  if (selectedPlatformList.length) {
    qaArgs.push("--platform", selectedPlatformList.join(","));
  }

  qaResult = await runNode("platform-fidelity-qa", scriptPaths.platformFidelityQa, qaArgs, {
    stream: false,
  });
}

console.log(
  JSON.stringify(
    {
      runId,
      workspace,
      startedAt: startAt,
      finishedAt: endAt,
      jobs: results.length,
      succeeded: summary.totals.succeeded,
      skipped: summary.totals.skipped,
      failed: summary.totals.failed,
      summaryPath,
      qaReportPath,
      qaResult: qaResult ? qaResult.exitCode : null,
      dbPersist,
    },
    null,
    2,
  ),
);
