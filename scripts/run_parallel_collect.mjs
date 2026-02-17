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
import { getArg, getBool, getInt, getList, normalizeCap } from "./lib/cli_utils.mjs";

const args = process.argv.slice(2);

function asSampleCapArg(value) {
  if (Number.isFinite(value) && value > 0) return String(Math.floor(value));
  return "0";
}

function asAdapterMaxArg(value) {
  if (Number.isFinite(value) && value > 0) return String(Math.floor(value));
  return "Infinity";
}

function splitCap(value, buckets) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(buckets) || buckets <= 0) return 0;
  return Math.ceil(value / buckets);
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
  return String(v || "")
    .replace(/[^\p{L}\p{N}\-_]/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

const scriptPaths = {
  probe: path.resolve(process.cwd(), "scripts/platform_query_probe.mjs"),
  collect: path.resolve(process.cwd(), "scripts/platform_sampling_collect.mjs"),
  naverCollect: path.resolve(process.cwd(), "scripts/naver_auto_collector.mjs"),
  naverNormalize: path.resolve(process.cwd(), "scripts/naver_normalize.mjs"),
  zigbangCollect: path.resolve(process.cwd(), "scripts/zigbang_auto_collector.mjs"),
  dabangCollect: path.resolve(process.cwd(), "scripts/dabang_auto_collector.mjs"),
  r114Collect: path.resolve(process.cwd(), "scripts/r114_auto_collector.mjs"),
  listingAdapters: path.resolve(process.cwd(), "scripts/run_listing_adapters.mjs"),
  peterpanzCollect: path.resolve(process.cwd(), "scripts/peterpanz_auto_collector.mjs"),
  daangnCollect: path.resolve(process.cwd(), "scripts/daangn_auto_collector.mjs"),
};

const runId = getArg(
  args,
  "--run-id",
  new Date().toISOString().replace(/[T:.]/g, "-"),
);

const workspace = resolveAbs(
  getArg(args, "--out-dir", path.join("scripts", "parallel_collect_runs", runId)),
);
const probeOut = resolveAbs(
  getArg(args, "--probe-out", path.join(workspace, "platform_query_probe_results.json")),
);
const targetsIn = resolveAbs(
  getArg(args, "--targets", path.join(workspace, "platform_sampling_targets.json")),
);
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
const selectedPlatforms = getList(args, "--platforms", [
  "zigbang",
  "dabang",
  "naver",
  "peterpanz",
  "daangn",
]);
const disabledPlatforms = new Set(["r114"]);
const normalizedRequestedPlatforms = selectedPlatforms
  .map((p) => normalizePlatform(p))
  .filter(Boolean)
  .filter((p) => !disabledPlatforms.has(p));

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

const platformAlias = {
  zigbang: "zigbang",
  "직방": "zigbang",
  dabang: "dabang",
  다방: "dabang",
  naver: "naver",
  "네이버 부동산": "naver",
  "네이버부동산": "naver",
  r114: "r114",
  부동산114: "r114",
  피터팬: "peterpanz",
  peterpanz: "peterpanz",
  네모: "nemo",
  nemo: "nemo",
  호갱노노: "hogangnono",
  hogangnono: "hogangnono",
  당근: "daangn",
  당근마켓: "daangn",
  daangn: "daangn",
};

function normalizePlatform(raw) {
  return platformAlias[raw] || String(raw || "").trim().toLowerCase();
}

function runNode(label, script, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const command = [
      script,
      ...args,
    ];
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
      ...(overridePropertyTypes.length
        ? { propertyTypes: overridePropertyTypes }
        : {}),
      ...(selectedSigunguList.length
        ? { sigunguList: unique(selectedSigunguList) }
        : {}),
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
    "연립": "YR",
    "단독/다가구": "DDDGG",
    "단독": "DDDGG",
    "다가구": "DDDGG",
    "오피스텔": "OP",
    "상가주택": "SGJT",
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
  const propertyTypes = (target.propertyTypes && Array.isArray(target.propertyTypes))
    ? target.propertyTypes
    : (Array.isArray(fallback?.propertyTypes) ? fallback.propertyTypes : []);
  return {
    sigungu: target.sigungu || fallback?.sigungu || null,
    rentMax: Number.isFinite(Number(target.rentMax))
      ? Number(target.rentMax)
      : null,
    depositMax: Number.isFinite(Number(target.depositMax))
      ? Number(target.depositMax)
      : null,
    minAreaM2: Number.isFinite(Number(target.minAreaM2))
      ? Number(target.minAreaM2)
      : Number.isFinite(Number(target.minArea))
      ? Number(target.minArea)
      : null,
    tradeType: resolveNaverTradeType(
      overrideTradeType ||
        target.tradeType ||
        target.leaseType ||
        target.lease_type,
    ),
    realEstateTypes: mapNaverPropertyTypes(
      overridePropertyTypes.length ? overridePropertyTypes : propertyTypes,
    ),
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
      const fallbackSigungu =
        conditionData?.target?.sigungu || conditionData?.target?.siGunGu;
      const naverFilters = conditionData?.filters || {};
      const sigunguCandidates = unique(
        [
          ...naverSigunguFromTarget,
          ...selectedSigunguList,
          ...(overrideSigungu ? [overrideSigungu] : []),
          ...(fallbackSigungu ? [fallbackSigungu] : ["노원구"]),
        ].filter(Boolean),
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
            const collectResult = await runNode(
              `naver_auto:${sigungu}`,
              scriptPaths.naverCollect,
              naverArgs,
              { stream: true },
            );

            let normalizedPath = null;
            if (runNormalize) {
              normalizedPath = path.join(
                workspace,
                `naver_normalized_${runId}_${safe}.json`,
              );
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
                ],
                { stream: false },
              );
              normalizedPath = path.join(
                workspace,
                `naver_normalized_${runId}_${safe}.json`,
              );
              return {
                platform: "naver",
                sigungu,
                rawFile,
                metaFile,
                normalizedPath,
                collectResult,
                normalizeResult,
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
      const fallbackSigungu = conditionData?.target?.sigungu;
      const sigunguCandidates = unique(
        [
          ...zigbangSigunguFromTarget,
          ...selectedSigunguList,
          ...(overrideSigungu ? [overrideSigungu] : []),
          ...(fallbackSigungu ? [fallbackSigungu] : ["노원구"]),
        ].filter(Boolean),
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
              "--sigungu", sigungu,
              "--sample-cap", asSampleCapArg(perSigunguCap),
              "--output-raw", rawFile,
              "--output-meta", metaFile,
            ];

            const zbFilters = conditionData?.filters || {};
            if (Number.isFinite(Number(zbFilters.rentMax))) {
              zigbangArgs.push("--rent-max", String(zbFilters.rentMax));
            }
            if (Number.isFinite(Number(zbFilters.depositMax))) {
              zigbangArgs.push("--deposit-max", String(zbFilters.depositMax));
            }
            if (Number.isFinite(Number(zbFilters.minAreaM2))) {
              zigbangArgs.push("--min-area", String(Math.floor(zbFilters.minAreaM2)));
            }

            const collectResult = await runNode(
              `zigbang_auto:${sigungu}`,
              scriptPaths.zigbangCollect,
              zigbangArgs,
              { stream: true },
            );

            let normalizedPath = null;
            let normalizeResult = null;
            if (runNormalize) {
              normalizedPath = path.join(
                workspace,
                `zigbang_normalized_${runId}_${safe}.json`,
              );
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
                  asAdapterMaxArg(perSigunguCap * 2),
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
      const fallbackSigungu = conditionData?.target?.sigungu;
      const sigunguCandidates = unique(
        [
          ...ppSigunguFromTarget,
          ...selectedSigunguList,
          ...(overrideSigungu ? [overrideSigungu] : []),
          ...(fallbackSigungu ? [fallbackSigungu] : ["노원구"]),
        ].filter(Boolean),
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
              "--sigungu", sigungu,
              "--sample-cap", asSampleCapArg(perSigunguCap),
              "--output-raw", rawFile,
              "--output-meta", metaFile,
            ];

            const ppFilters = conditionData?.filters || {};
            if (Number.isFinite(Number(overrideRentMax || ppFilters.rentMax))) {
              ppArgs.push("--rent-max", String(overrideRentMax || ppFilters.rentMax));
            }
            if (Number.isFinite(Number(overrideDepositMax || ppFilters.depositMax))) {
              ppArgs.push("--deposit-max", String(overrideDepositMax || ppFilters.depositMax));
            }
            if (Number.isFinite(Number(overrideMinArea || ppFilters.minAreaM2))) {
              ppArgs.push("--min-area", String(Math.floor(Number(overrideMinArea || ppFilters.minAreaM2))));
            }

            const collectResult = await runNode(
              `peterpanz_auto:${sigungu}`,
              scriptPaths.peterpanzCollect,
              ppArgs,
              { stream: true },
            );

            let normalizedPath = null;
            let normalizeResult = null;
            if (runNormalize) {
              normalizedPath = path.join(
                workspace,
                `peterpanz_normalized_${runId}_${safe}.json`,
              );
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
                  asAdapterMaxArg(perSigunguCap * 2),
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
        [
          ...daangnSigunguFromTarget,
          ...selectedSigunguList,
          ...(overrideSigungu ? [overrideSigungu] : []),
          ...(daangnSigunguFromTarget.length === 0 && !selectedSigunguList.length ? daangnKnownDistricts : []),
          ...(fallbackSigungu ? [fallbackSigungu] : []),
        ].filter(Boolean),
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
              "--sigungu", sigungu,
              "--sample-cap", asSampleCapArg(perSigunguCap),
              "--output-raw", rawFile,
              "--output-meta", metaFile,
            ];

            const daangnFilters = conditionData?.filters || {};
            if (Number.isFinite(Number(overrideRentMax || daangnFilters.rentMax))) {
              daangnArgs.push("--rent-max", String(overrideRentMax || daangnFilters.rentMax));
            }
            if (Number.isFinite(Number(overrideDepositMax || daangnFilters.depositMax))) {
              daangnArgs.push("--deposit-max", String(overrideDepositMax || daangnFilters.depositMax));
            }
            if (Number.isFinite(Number(overrideMinArea || daangnFilters.minAreaM2))) {
              daangnArgs.push("--min-area", String(Math.floor(Number(overrideMinArea || daangnFilters.minAreaM2))));
            }

            const collectResult = await runNode(
              `daangn_auto:${sigungu}`,
              scriptPaths.daangnCollect,
              daangnArgs,
              { stream: true },
            );

            let normalizedPath = null;
            let normalizeResult = null;
            if (runNormalize) {
              normalizedPath = path.join(
                workspace,
                `daangn_normalized_${runId}_${safe}.json`,
              );
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
                  asAdapterMaxArg(perSigunguCap * 2),
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
            if (Number.isFinite(Number(dabangFilters.rentMax))) {
              dabangArgs.push("--rent-max", String(dabangFilters.rentMax));
            }
            if (Number.isFinite(Number(dabangFilters.depositMax))) {
              dabangArgs.push("--deposit-max", String(dabangFilters.depositMax));
            }
            if (Number.isFinite(Number(dabangFilters.minAreaM2))) {
              dabangArgs.push("--min-area", String(Math.floor(dabangFilters.minAreaM2)));
            }

            const collectResult = await runNode(
              `dabang_auto:${sigungu}`,
              scriptPaths.dabangCollect,
              dabangArgs,
              { stream: true },
            );

            let normalizedPath = null;
            let normalizeResult = null;
            if (runNormalize) {
              normalizedPath = path.join(
                workspace,
                `dabang_normalized_${runId}_${safe}.json`,
              );
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
                  asAdapterMaxArg(perSigunguCap * 2),
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

    if (normalizedCode === "r114") {
      const r114SigunguFromTarget = extractSigunguCandidates(targets);
      const fallbackSigungu = conditionData?.target?.sigungu;
      const sigunguCandidates = unique(
        [
          ...r114SigunguFromTarget,
          ...selectedSigunguList,
          ...(overrideSigungu ? [overrideSigungu] : []),
          ...(fallbackSigungu ? [fallbackSigungu] : ["노원구"]),
        ].filter(Boolean),
      ).slice(0, Math.max(1, naverMaxRegions));

      if (sigunguCandidates.length === 0) {
        jobs.push({
          name: "r114",
          run: async () => ({
            platform: "r114",
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
          name: `r114:${sigungu}`,
          run: async () => {
            const safe = sanitizeFileToken(sigungu);
            const rawFile = path.join(workspace, `r114_raw_${runId}_${safe}.jsonl`);
            const metaFile = path.join(workspace, `r114_meta_${runId}_${safe}.json`);
            const r114Args = [
              "--sigungu",
              sigungu,
              "--sample-cap",
              asSampleCapArg(perSigunguCap),
              "--output-raw",
              rawFile,
              "--output-meta",
              metaFile,
            ];

            const r114Filters = conditionData?.filters || {};
            if (Number.isFinite(Number(r114Filters.rentMax))) {
              r114Args.push("--rent-max", String(r114Filters.rentMax));
            }
            if (Number.isFinite(Number(r114Filters.depositMax))) {
              r114Args.push("--deposit-max", String(r114Filters.depositMax));
            }
            if (Number.isFinite(Number(r114Filters.minAreaM2))) {
              r114Args.push("--min-area", String(Math.floor(r114Filters.minAreaM2)));
            }

            const collectResult = await runNode(
              `r114_auto:${sigungu}`,
              scriptPaths.r114Collect,
              r114Args,
              { stream: true },
            );

            let normalizedPath = null;
            let normalizeResult = null;
            if (runNormalize) {
              normalizedPath = path.join(
                workspace,
                `r114_normalized_${runId}_${safe}.json`,
              );
              normalizeResult = await runNode(
                `r114_adapter:${sigungu}`,
                scriptPaths.listingAdapters,
                [
                  "--platform",
                  "r114",
                  "--input",
                  rawFile,
                  "--out",
                  normalizedPath,
                  "--max-items",
                  asAdapterMaxArg(perSigunguCap * 2),
                ],
                { stream: false },
              );
            }

            return {
              platform: "r114",
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

async function runJobs(jobs, concurrency) {
  const results = [];
  let pointer = 0;

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

  const loops = Array.from(
    { length: Math.min(concurrency, Math.max(1, jobs.length)) },
    () => worker(),
  );
  await Promise.all(loops);
  return results.filter(Boolean);
}

function isAlias(value) {
  return normalizePlatform(value) !== null;
}

const selectedCodesSet = new Set(
  selectedPlatformList
    .map((p) => normalizePlatform(p))
    .filter(Boolean),
);

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
const jobs = buildJobs(targetMap, targetFile, {
  target: naverCondition,
  filters: naverCondition,
});
const results = await runJobs(jobs, maxParallel);

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
      if (totalListings > 0 || clickedListings > 0) return { grade: "PARTIAL", listings: totalListings, clicked: clickedListings };
      return { grade: "EMPTY", listings: 0 };
    } catch {}
  }

  // For generic platforms, check the output file
  const outputFile = result.output;
  if (outputFile && fs.existsSync(outputFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(outputFile, "utf8"));
      const samples = data.platforms?.[0]?.samples || data.samples || [];
      const failed = samples.filter(s => s.sample_status === "FAILED").length;
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
  try {
    dbPersist = await persistSummaryToDb(summaryPath, { runId });
  } catch (error) {
    console.error(`DB persistence required but failed: ${error?.message || error}`);
    throw error;
  }
}

console.log(JSON.stringify({
  runId,
  workspace,
  startedAt: startAt,
  finishedAt: endAt,
  jobs: results.length,
  succeeded: summary.totals.succeeded,
  skipped: summary.totals.skipped,
  failed: summary.totals.failed,
  summaryPath,
  dbPersist,
}, null, 2));
