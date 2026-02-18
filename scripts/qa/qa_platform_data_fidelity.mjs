#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const argsByName = new Map();
for (let i = 0; i < argv.length; i += 1) {
  const raw = argv[i];
  if (raw.startsWith("--")) {
    if (raw.includes("=")) {
      const [name, ...rest] = raw.split("=");
      argsByName.set(name, rest.join("="));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      argsByName.set(raw, next);
      i += 1;
      continue;
    }
    argsByName.set(raw, "true");
  }
}

const getArg = (name, fallback = null) =>
  argsByName.has(name) ? argsByName.get(name) : fallback;

const getList = (name, fallback = []) => {
  const v = getArg(name);
  if (v === null || v === undefined) return fallback;
  if (Array.isArray(v)) return v;
  return String(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
};

const getBool = (name, fallback = false) => {
  const v = getArg(name, fallback ? "true" : "false");
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "on", "y", "enabled"].includes(s);
};

const toAbs = (value) =>
  value ? path.resolve(process.cwd(), String(value)) : null;

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

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
  const providedSummary = getArg("--summary");
  if (providedSummary) {
    const resolved = toAbs(providedSummary);
    if (fileExists(resolved)) return resolved;
    throw new Error(`summary not found: ${resolved}`);
  }

  const runId = getArg("--run-id");
  const workspaceArg = getArg("--workspace") || getArg("--run");
  const baseDir = path.resolve(process.cwd(), "scripts/parallel_collect_runs");

  const candidates = [];
  const directories = workspaceArg
    ? [path.resolve(process.cwd(), workspaceArg)]
    : listDir(baseDir)
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.resolve(baseDir, entry.name));

  for (const dir of directories) {
    const base = path.basename(dir);
    if (runId && base !== runId) continue;

    const entries = listDir(dir);
    for (const file of entries) {
      if (!file.isFile() || !file.name.startsWith("parallel_collect_summary_") || !file.name.endsWith(".json")) continue;
      const fullPath = path.resolve(dir, file.name);
      try {
        const stat = fs.statSync(fullPath);
        candidates.push({
          summaryPath: fullPath,
          workspace: dir,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        continue;
      }
    }
  }

  if (!candidates.length) {
    throw new Error("parallel collect summary 파일을 찾지 못했습니다.");
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0].summaryPath;
}

const PLATFORM_CONFIG = {
  naver: {
    platform: "naver",
    hostSuffixes: ["new.land.naver.com", "land.naver.com", "fin.land.naver.com"],
    sourceRefKeys: ["articleNo", "atclNo", "atcl_no", "article_id", "articleId", "id", "itemNo", "item_no"],
    rentKeys: [
      "prc",
      "prc0",
      "monthlyRent",
      "monthly_rent",
      "rent",
      "rentPrc",
      "rentPrcText",
      "tradePrc",
      "tradePrice",
    ],
    depositKeys: [
      "deposit",
      "depositPrc",
      "depositPrcText",
      "보증금",
      "보증금금액",
    ],
    areaKeys: ["spc1", "spc2", "area", "area1", "area2", "exclusiveArea", "grossArea", "areaExclusive", "areaGross", "area_exclusive_m2", "area_gross_m2"],
    areaTextKeys: ["areaText", "areaTxt", "area_text", "spaceInfo", "exclusiveAreaText"],
    addressKeys: ["address", "address_text", "addressText", "fullAddress", "addr", "addrText", "addr_text", "tradeAreaName", "jibunAddress", "roadAddress", "sido", "sigungu", "dong", "지역"],
    sourceUrlKeys: ["source_url", "sourceUrl", "request_url", "requestUrl", "url", "detail_url", "detailUrl", "atclUrl", "articleUrl", "cpMobileArticleUrl", "cpPcArticleUrl"],
  },
  dabang: {
    platform: "dabang",
    hostSuffixes: ["dabangapp.com"],
    sourceRefKeys: ["id", "articleId", "article_id", "articleNo", "seq", "source_ref", "_id", "gdid", "gid"],
    rentKeys: ["rent", "월세", "rentFee", "rent_fee", "rent_text", "monthlyRent", "monthly_rent"],
    depositKeys: ["deposit", "보증금", "depositFee", "deposit_fee", "보증금금액"],
    areaKeys: ["area_exclusive_m2", "area_gross_m2", "area", "spc1", "spc2", "room_area", "area_text", "areaText"],
    areaTextKeys: ["roomDesc", "text", "desc", "description"],
    addressKeys: ["address", "address_text", "addressText", "address_text", "streetAddress", "fullAddress", "dongName", "sigungu", "complexName"],
    sourceUrlKeys: ["source_url", "sourceUrl", "url", "detail_url", "detailUrl", "article_url", "request_url", "requestUrl"],
    priceTitleKeys: ["priceTitle", "price_title", "priceText", "price_text"],
  },
  zigbang: {
    platform: "zigbang",
    hostSuffixes: ["zigbang.com"],
    sourceRefKeys: ["item_id", "itemId", "item_no", "itemNo", "id", "_id", "article_id", "articleId", "house_id", "houseId"],
    rentKeys: ["rent", "월세", "rentMonth", "rent_month", "monthlyRent", "monthly_rent", "roomRent"],
    depositKeys: ["deposit", "보증금", "depositMoney", "deposit_money", "보증금금액", "jeonse"],
    areaKeys: ["size_m2", "sizeM2", "area", "spc1", "spc2", "area_exclusive_m2", "area_gross_m2", "전용면적", "공급면적"],
    areaTextKeys: ["areaText", "sizeText", "text", "desc", "description"],
    addressKeys: ["address", "address_text", "addressText", "address_text", "local1", "local2", "local3", "district", "dong", "gu", "sido"],
    sourceUrlKeys: ["source_url", "sourceUrl", "url", "detail_url", "detailUrl", "room_url", "roomUrl", "link"],
  },
  daangn: {
    platform: "daangn",
    hostSuffixes: ["daangn.com", "danggeunmarket.com", "kcarrot.market", "karrot.market"],
    sourceRefKeys: ["hidx", "id", "_id", "article_id", "articleId", "listing_id", "listingId"],
    rentKeys: ["deposit", "rent", "월세", "monthlyRent", "monthly_rent", "rentAmount", "monthly_price", "price"],
    depositKeys: ["deposit", "보증금", "depositAmount", "보증금금액", "deposit_price", "monthlyPrice"],
    areaKeys: ["area", "area_exclusive_m2", "area_gross_m2", "spc1", "spc2", "area_size", "size", "size_m2", "공급면적", "전용면적"],
    areaTextKeys: ["areaText", "text", "desc", "description", "detail", "detailText"],
    addressKeys: ["address", "address_text", "addressText", "addressText", "text", "fullAddress", "roadAddress", "jibunAddress", "sido", "sigungu", "dong", "읍면동"],
    sourceUrlKeys: ["source_url", "sourceUrl", "url", "detail_url", "detailUrl", "articleUrl", "article_url"],
  },
  peterpanz: {
    platform: "peterpanz",
    hostSuffixes: ["peterpanz.com"],
    sourceRefKeys: ["hidx", "id", "_id", "article_id", "articleId", "pid"],
    rentKeys: ["monthly_fee", "monthly", "rent", "월세"],
    depositKeys: ["deposit", "보증금", "deposit_fee", "보증금금액", "보증금"],
    areaKeys: ["real_size", "area_exclusive_m2", "area_gross_m2", "spc1", "spc2", "size", "area"],
    areaTextKeys: ["areaText", "text", "desc", "description", "houseName"],
    addressKeys: ["location", "address", "fullAddress", "address_text", "addressText", "sido", "sigungu", "dong", "street"],
    sourceUrlKeys: ["source_url", "sourceUrl", "url", "detail_url", "detailUrl", "houseUrl", "house_url"],
    nestedAddressKeys: ["location.address", "location.text", "location.dong", "location.sigungu", "location.sido"],
  },
  r114: {
    platform: "r114",
    hostSuffixes: ["r114.com", "11400.org", "114", "r114", "realestate"],
    sourceRefKeys: ["articleId", "article_id", "id", "_id", "propertyId", "property_id", "listingId", "listing_id"],
    rentKeys: ["rent", "monthlyRent", "rent_price", "rentPrice", "월세", "월세금액", "rentMoney"],
    depositKeys: ["deposit", "depositPrice", "deposit_price", "보증금", "보증금금액", "보증금Price"],
    areaKeys: ["area", "area_exclusive_m2", "area_gross_m2", "spc1", "spc2", "exclusiveArea", "grossArea", "size", "size_m2", "면적"],
    areaTextKeys: ["areaText", "text", "desc", "description", "sizeText"],
    addressKeys: ["address", "address_text", "addressText", "fullAddress", "addr", "jibunAddress", "roadAddress", "sido", "gu", "sigungu", "dong", "읍면동"],
    sourceUrlKeys: ["source_url", "sourceUrl", "url", "detail_url", "detailUrl", "articleUrl"],
  },
};

const OPTIONS = {
  summaryPath: resolveSummaryPath(),
  strict: getBool("--strict", true),
  maxItems: (() => {
    const parsed = Number(getArg("--max-items", "NaN"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  })(),
  includePlatforms: new Set(
    getList("--platform", []).map((p) => String(p).trim().toLowerCase()),
  ),
  maxFailPrint: Number(getArg("--max-fail-print", "40")),
  reportPath: toAbs(getArg("--report", "scripts/qa/qa_platform_data_fidelity_report.json")),
};

if (!Number.isFinite(OPTIONS.maxFailPrint) || OPTIONS.maxFailPrint < 1) {
  OPTIONS.maxFailPrint = 40;
}

function normText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normTextLoose(value) {
  return normText(value).toLowerCase().replace(/\s+/g, " ");
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const raw = normText(value).replace(/,/g, "");
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMoneyLike(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return toNumber(value);

  let s = normText(value).toLowerCase();
  if (!s) return null;
  if (/협의|문의|contact|상담|추가요청/.test(s)) return null;

  const unitless = s.replace(/원/gi, "").replace(/\s+/g, " ").trim();
  const parsePart = (v) => {
    const n = Number.parseFloat(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const billion = /^([0-9]+(?:\.[0-9]+)?)억(?:\s*([0-9]+(?:\.[0-9]+)?))?/;
  const thousand = /^([0-9]+(?:\.[0-9]+)?)천만(?:\s*원)?$/;
  const man = /^([0-9]+(?:\.[0-9]+)?)만(?:\s*원)?$/;
  const numeric = /([0-9]+(?:\.[0-9]+)?)/;

  const mB = billion.exec(unitless);
  if (mB) {
    const base = parsePart(mB[1]);
    const add = mB[2] ? parsePart(mB[2]) : 0;
    if (base !== null && Number.isFinite(base + (add || 0))) return base * 10000 + add;
  }

  const mT = thousand.exec(unitless);
  if (mT) return parsePart(mT[1]);

  const mM = man.exec(unitless);
  if (mM) return parsePart(mM[1]);

  const matchAny = numeric.exec(unitless);
  if (matchAny) return parsePart(matchAny[1]);

  return null;
}

function parseAreaLike(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return toNumber(value);

  const raw = normText(value).toLowerCase();
  if (!raw) return null;

  const sqmMatch = /([0-9]+(?:\.[0-9]+)?)\s*(m²|㎡|sqm|sq\s*m|제곱미터|m2)/i.exec(raw);
  if (sqmMatch) return toNumber(sqmMatch[1]);

  const pyMatch = /([0-9]+(?:\.[0-9]+)?)\s*(평|py|pyung|坪)/i.exec(raw);
  if (pyMatch) return toNumber(pyMatch[1]) * 3.305785;

  const numericMatch = /([0-9]+(?:\.[0-9]+)?)/.exec(raw);
  if (!numericMatch) return null;

  const candidate = toNumber(numericMatch[1]);
  if (candidate === null) return null;

  if (!Number.isFinite(candidate) || candidate < 1 || candidate > 1000) {
    return null;
  }

  return candidate;
}

function getByPath(obj, pathString) {
  if (!obj || typeof obj !== "object") return null;
  const parts = pathString.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return null;
    if (typeof current !== "object") return null;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return null;
    current = current[part];
  }
  return current;
}

function pickByKeys(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    const value = getByPath(obj, String(key));
    if (value === null || value === undefined) continue;
    const text = normText(value);
    if (text.length === 0) continue;
    return value;
  }
  return null;
}

function pickNestedFallback(obj, keys, fallback) {
  const value = pickByKeys(obj, keys);
  if (value !== null && value !== undefined) return value;
  if (fallback === null || fallback === undefined) return null;
  return fallback;
}

function parseDabangPriceTitle(rawText) {
  const source = normText(rawText);
  if (!source) return null;
  const s = source.replace(/\s+/g, "").toLowerCase();
  const parts = s.split("/");
  if (parts.length !== 2) return null;

  const first = parseMoneyLike(parts[0]);
  const second = parseMoneyLike(parts[1]);
  if (first === null || second === null) return null;
  return { first, second };
}

function numericEquals(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na === null || nb === null) return false;
  return Math.abs(na - nb) < 0.0001;
}

function hostSuffixMatch(url, suffixes) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`) || host.includes(suffix));
  } catch {
    return false;
  }
}

function isEmpty(val) {
  if (val === null || val === undefined) return true;
  if (Array.isArray(val)) return val.length === 0;
  if (typeof val === "string") return !val.trim();
  return false;
}

function collectByPathTokens(obj, keyPatterns, out) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectByPathTokens(item, keyPatterns, out);
    return;
  }

  for (const [key, value] of Object.entries(obj)) {
    const keyText = key.toLowerCase();
    if (keyPatterns.some((re) => re.test(keyText))) {
      out.push({ key, value });
    }
    if (value && typeof value === "object") {
      collectByPathTokens(value, keyPatterns, out);
    }
  }
}

function extractSourceRefFromObject(obj, platform) {
  const cfg = PLATFORM_CONFIG[platform] || null;
  if (!cfg) return null;
  const candidates = [];
  for (const key of cfg.sourceRefKeys) {
    const value = getByPath(obj, key);
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number") {
      const normalized = normText(value);
      if (normalized) candidates.push(normalized);
    }
  }
  return candidates[0] || null;
}

function isLikelyListingNode(node, platform) {
  if (!node || typeof node !== "object") return false;
  const ref = extractSourceRefFromObject(node, platform);
  if (!ref) return false;

  const cfg = PLATFORM_CONFIG[platform] || null;
  const keys = new Set([
    ...(cfg?.rentKeys || []),
    ...(cfg?.depositKeys || []),
    ...(cfg?.areaKeys || []),
    ...(cfg?.addressKeys || []),
    ...(cfg?.sourceUrlKeys || []),
    ...(cfg?.priceTitleKeys || []),
  ]);
  const nodeKeys = Object.keys(node).map((k) => k.toLowerCase());
  const hasKnown = nodeKeys.some((k) => keys.has(k));
  const hasNested = nodeKeys.some((k) => k.includes("price") || k.includes("rent") || k.includes("deposit") || k.includes("area"));
  const hasAnyNumeric = nodeKeys.some((k) => ["rent", "deposit", "spc1", "spc2", "area", "price", "id", "item_id"].includes(k));
  return hasKnown || hasNested || hasAnyNumeric;
}

function collectCandidateRowsFromRawRecord(rawRecord, platform) {
  const visited = new Set();
  const out = [];

  const visit = (node) => {
    if (!node || typeof node !== "object" || visited.has(node)) return;
    visited.add(node);

    const ref = extractSourceRefFromObject(node, platform);
    if (ref && isLikelyListingNode(node, platform)) {
      out.push({
        ref,
        row: node,
      });
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === "object") visit(value);
    }
  };

  visit(rawRecord);
  return out;
}

function buildRawIndex(rawPath, platform) {
  const lines = fs.readFileSync(rawPath, "utf8").split("\n");
  const index = new Map();
  let parseFail = 0;
  let candidateCount = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let record = null;
    try {
      record = JSON.parse(line);
    } catch {
      parseFail += 1;
      continue;
    }

    const candidates = collectCandidateRowsFromRawRecord(record, platform);
    for (const candidate of candidates) {
      candidateCount += 1;
      const key = String(candidate.ref);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({
        row: candidate.row,
        rawRecord: record,
        rawLine: i + 1,
        source: key,
      });
    }

    // fallback for raw records that are already single listing row
    const fallbackRef = extractSourceRefFromObject(record, platform);
    if (fallbackRef && !candidates.some((c) => c.ref === fallbackRef)) {
      if (!index.has(fallbackRef)) index.set(fallbackRef, []);
      index.get(fallbackRef).push({
        row: record,
        rawRecord: record,
        rawLine: i + 1,
        source: fallbackRef,
      });
    }
  }

  return { index, parseFail, candidateCount };
}

function extractNumericFromKeys(obj, platform, keys, parser) {
  if (!obj || typeof obj !== "object") return null;
  const candidates = [];
  for (const key of keys) {
    const value = getByPath(obj, key);
    if (value === null || value === undefined) continue;
    const parsed = parser(value);
    if (parsed !== null && Number.isFinite(parsed)) candidates.push(parsed);
  }

  const scanned = [];
  collectByPathTokens(obj, keys.map((k) => new RegExp(String(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")), scanned);
  for (const entry of scanned) {
    const parsed = parser(entry.value);
    if (parsed !== null && Number.isFinite(parsed)) candidates.push(parsed);
  }

  return candidates.length ? candidates[0] : null;
}

function extractAddressFromObject(obj, platform) {
  const cfg = PLATFORM_CONFIG[platform] || {};
  const direct = pickByKeys(obj, [
    ...(cfg.addressKeys || []),
    ...(cfg.nestedAddressKeys || []),
    "address",
  ]);
  if (!isEmpty(direct)) return normText(direct);

  const city = pickByKeys(obj, [
    "sido",
    "city",
    "province",
    "address_city",
    "addressCity",
    "sidoNm",
  ]);
  const gu = pickByKeys(obj, [
    "sigungu",
    "gu",
    "district",
    "지역구",
    "region_name",
  ]);
  const dong = pickByKeys(obj, [
    "dong",
    "town",
    "neighborhood",
    "읍면동",
    "dongNm",
  ]);

  const parts = [city, gu, dong, direct].filter((v) => !isEmpty(v)).map((v) => normText(v));
  return Array.from(new Set(parts)).join(" ").trim();
}

function extractSourceUrlFromObject(rawRecord, rowObj, platform) {
  const cfg = PLATFORM_CONFIG[platform] || {};
  const direct = pickNestedFallback(rowObj, cfg.sourceUrlKeys || [], null);
  if (!isEmpty(direct)) return normText(direct);
  const fallback = pickNestedFallback(rawRecord, [
    "source_url",
    "request_url",
    "sourceUrl",
    "requestUrl",
  ], null);
  return isEmpty(fallback) ? null : normText(fallback);
}

function extractExpectedFields(platform, candidate, normalizedItem) {
  const cfg = PLATFORM_CONFIG[platform];
  const row = candidate?.row || {};
  const rawRecord = candidate?.rawRecord || {};

  let rent = extractNumericFromKeys(row, platform, cfg.rentKeys || [], parseMoneyLike);
  let deposit = extractNumericFromKeys(row, platform, cfg.depositKeys || [], parseMoneyLike);
  const areaFromRow = extractNumericFromKeys(row, platform, cfg.areaKeys || [], parseAreaLike);
  const areaFromText = extractNumericFromKeys(row, platform, cfg.areaTextKeys || [], parseAreaLike);
  const area = areaFromRow !== null ? areaFromRow : areaFromText;
  const address = extractAddressFromObject({ ...row, ...(rawRecord || {}) }, platform);
  const sourceUrl = extractSourceUrlFromObject(rawRecord, row, platform);

  // 다방은 priceTitle(예: 1000/80)을 보증금/월세로 고정 해석한다.
  let priceCandidates = null;
  if (!rent && !deposit) {
    const rawPriceTitle = pickByKeys(row, cfg.priceTitleKeys || []);
    if (!isEmpty(rawPriceTitle)) {
      const parsedPair = parseDabangPriceTitle(rawPriceTitle);
      if (parsedPair) {
        if (platform === "dabang") {
          rent = parsedPair.second;
          deposit = parsedPair.first;
        } else {
          priceCandidates = {
            order1: { rent: parsedPair.second, deposit: parsedPair.first },
            order2: { rent: parsedPair.first, deposit: parsedPair.second },
          };
        }
      }
    }
  }

  return {
    rent,
    deposit,
    area,
    address,
    sourceUrl,
    priceCandidates,
    sourceRef: extractSourceRefFromObject(row, platform),
  };
}

function classifyPriceMatch(rentExpected, depositExpected, expectedAltPair, normalizedItem, options = {}) {
  const nRent = toNumber(normalizedItem.rent_amount);
  const nDeposit = toNumber(normalizedItem.deposit_amount);
  const allowSwapped = options.allowSwapped !== false;

  if (rentExpected !== null || depositExpected !== null) {
    const directMatch =
      (rentExpected === null || numericEquals(nRent, rentExpected)) &&
      (depositExpected === null || numericEquals(nDeposit, depositExpected));

    if (directMatch) {
      return { ok: true, mode: "direct" };
    }
    if (expectedAltPair && allowSwapped) {
      const altMatch =
        (expectedAltPair.rent === null || numericEquals(nRent, expectedAltPair.rent)) &&
        (expectedAltPair.deposit === null || numericEquals(nDeposit, expectedAltPair.deposit));
      if (altMatch) {
        return { ok: true, mode: "swapped" };
      }
    }
    return { ok: false, mode: "mismatch", normalizedRent: nRent, normalizedDeposit: nDeposit };
  }

  if (expectedAltPair && allowSwapped) {
    if (
      numericEquals(nRent, expectedAltPair.rent) &&
      numericEquals(nDeposit, expectedAltPair.deposit)
    ) return { ok: true, mode: "direct" };
    if (
      numericEquals(nRent, expectedAltPair.deposit) &&
      numericEquals(nDeposit, expectedAltPair.rent)
    ) return { ok: true, mode: "swapped" };
  }

  return { ok: true, mode: "skipped" };
}

function compareAddress(expectedAddress, actualAddress) {
  if (!expectedAddress || !actualAddress) return true;
  const expectedTokens = expectedAddress
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const actualTokens = actualAddress
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const actualSet = new Set(actualTokens);
  const matchCount = expectedTokens.filter((token) => actualSet.has(token)).length;
  const minRequired = expectedTokens.length <= 2 ? expectedTokens.length : Math.max(2, Math.floor(expectedTokens.length / 2));
  return matchCount >= minRequired;
}

function scoreCandidateForFidelity(platform, candidate) {
  const expected = extractExpectedFields(platform, candidate, {});
  let score = 0;
  if (candidate?.row && typeof candidate.row === "object") score += 2;
  if (expected.rent !== null) score += 5;
  if (expected.deposit !== null) score += 5;
  if (expected.area !== null) score += 3;
  if (expected.address) score += 3;
  if (expected.sourceUrl) score += 1;
  if (expected.priceCandidates) score += 1;
  return score;
}

function pickBestCandidate(candidates, platform) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  let best = candidates[0];
  let bestScore = scoreCandidateForFidelity(platform, best);
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const score = scoreCandidateForFidelity(platform, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function compareNormalizedItem(platform, item, candidate, context) {
  const violations = [];
  if (String(item.platform_code || "").toLowerCase() !== platform) {
    violations.push({
      field: "platform_code",
      expected: platform,
      actual: item.platform_code,
      message: "normalized platform_code mismatch",
    });
  }

  const sourceRef = normText(item.source_ref || item.external_id || item.id || "");
  if (!sourceRef) {
    violations.push({
      field: "source_ref",
      expected: "non-empty",
      actual: sourceRef,
      message: "source_ref missing",
    });
  } else if (candidate.source_ref && String(candidate.source_ref) !== sourceRef) {
    violations.push({
      field: "source_ref",
      expected: candidate.source_ref,
      actual: sourceRef,
      message: "source_ref row mapping mismatch",
    });
  }

  const expectedFields = extractExpectedFields(platform, candidate, item);
  const nRent = toNumber(item.rent_amount);
  const nDeposit = toNumber(item.deposit_amount);
  const nArea = toNumber(item.area_exclusive_m2 ?? item.area_gross_m2 ?? item.area);
  if (expectedFields.area !== null && !numericEquals(nArea, expectedFields.area)) {
    violations.push({
      field: "area",
      expected: expectedFields.area,
      actual: nArea,
      message: "area mismatch from raw",
    });
  }

  const expectedAddress = expectedFields.address;
  if (!compareAddress(expectedAddress, item.address_text || item.address || "")) {
    violations.push({
      field: "address",
      expected: expectedAddress,
      actual: item.address_text || item.address || "",
      message: "address mismatch or too different from raw",
    });
  }

  const expectedUrl = expectedFields.sourceUrl;
  if (item.source_url) {
    const cfg = PLATFORM_CONFIG[platform];
    if (cfg && !hostSuffixMatch(item.source_url, cfg.hostSuffixes)) {
      violations.push({
        field: "source_url",
        expected: `hostname suffix in ${cfg.hostSuffixes.join(",")}`,
        actual: item.source_url,
        message: "source_url host mismatch",
      });
    }
  } else if (expectedUrl) {
    violations.push({
      field: "source_url",
      expected: expectedUrl,
      actual: "",
      message: "source_url missing in normalized item",
    });
  }

  const priceCheck = (() => {
    const primary = expectedFields;
    const expectedRent = primary.rent;
    const expectedDeposit = primary.deposit;
    const alt = primary.priceCandidates
      ? primary.priceCandidates.order1
      : null;

    return classifyPriceMatch(expectedRent, expectedDeposit, alt, item, {
      allowSwapped: platform !== "dabang",
    });
  })();

  if (!priceCheck.ok && expectedFields.rent !== null && expectedFields.deposit !== null) {
    violations.push({
      field: "price",
      expected: {
        rent: expectedFields.rent,
        deposit: expectedFields.deposit,
        note: expectedFields.priceCandidates ? "both orders tested" : "single order",
      },
      actual: {
        rent: nRent,
        deposit: nDeposit,
      },
      message: "price mismatch from raw",
    });
  } else if (priceCheck.mode === "swapped") {
    violations.push({
      field: "price_order_mismatch",
      expected: "deposit/rent parsed in explicit order",
      actual: { rent: nRent, deposit: nDeposit },
      message: "가격 항목 순서 반전(가격 반전): 네트워크 값은 보증금/월세로 추정되는데 정규화 결과가 월세/보증금으로 기록됨",
    });
  }

  const nRef = normText(item.source_ref || item.external_id || item.id || "");
  return { violations, rawSourceRef: candidate.source_ref || null, context, item, priceMode: priceCheck.mode, normalizedPrice: { rent: nRent, deposit: nDeposit }, rawPrice: { rent: expectedFields.rent, deposit: expectedFields.deposit, area: expectedFields.area, sourceUrl: expectedFields.sourceUrl, address: expectedAddress } };
}

function listSummaryPath(dirPath) {
  try {
    return fs.readdirSync(dirPath).filter((f) => f.startsWith("parallel_collect_summary_") && f.endsWith(".json"));
  } catch {
    return [];
  }
}

function pickNormalizedPathFromResult(result) {
  const keys = [
    "normalizedPath",
    "normalized_file",
    "normalizedFile",
    "normalized",
    "normalized_file_path",
    "outputNormalized",
  ];
  for (const key of keys) {
    const value = result?.[key];
    if (value) return toAbs(value);
  }
  const normalizeArgs = result?.normalizeResult?.args;
  if (Array.isArray(normalizeArgs)) {
    for (let i = 0; i < normalizeArgs.length; i += 1) {
      if (normalizeArgs[i] === "--out" && normalizeArgs[i + 1]) return toAbs(normalizeArgs[i + 1]);
      if (normalizeArgs[i] === "--output" && normalizeArgs[i + 1]) return toAbs(normalizeArgs[i + 1]);
    }
  }
  return null;
}

function pickRawPathFromResult(result, platform) {
  const keys = [
    "rawFile",
    "raw_file",
    "raw_file_path",
    "rawPath",
    "raw_record_file",
    "raw_record_path",
  ];
  for (const key of keys) {
    const value = result?.[key];
    if (value) return toAbs(value);
  }
  const collectArgs = result?.collectResult?.args;
  if (Array.isArray(collectArgs)) {
    for (let i = 0; i < collectArgs.length; i += 1) {
      if (collectArgs[i] === "--output-raw" && collectArgs[i + 1]) return toAbs(collectArgs[i + 1]);
      if (collectArgs[i] === "--output_raw" && collectArgs[i + 1]) return toAbs(collectArgs[i + 1]);
    }
  }
  const output = result?.output;
  if (typeof output === "string" && output.includes(`${platform}_raw_`)) return toAbs(output);
  return null;
}

function pickRawNormalizedPairFromResult(result) {
  const platform = String((result?.platform || "").toLowerCase());
  return {
    platform,
    rawPath: pickRawPathFromResult(result, platform),
    normalizedPath: pickNormalizedPathFromResult(result),
  };
}

function loadNormalizedItems(filePath) {
  const obj = readJson(filePath);
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj?.items)) return obj.items;
  if (Array.isArray(obj?.merged_items)) return obj.merged_items;
  if (Array.isArray(obj?.samples)) return obj.samples;
  return [];
}

function parseArgPlatformFilter(platformList) {
  if (!platformList.length) return null;
  return new Set(platformList.map((v) => String(v).toLowerCase()));
}

function extractSourceUrlForCrossCheck(item, platform, expectedRef) {
  const rawUrl = normText(item.source_url || "");
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    const queryKeys = ["articleNo", "atclNo", "id", "hidx", "item_id", "itemId", "seq", "houseId", "house_id", "pid"];
    let queryId = null;
    for (const key of queryKeys) {
      const value = parsed.searchParams.get(key);
      if (value) {
        queryId = value;
        break;
      }
    }
    const path = parsed.pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    const id = queryId || expectedRef || "no-id";
    return `${parsed.host}${path}#${id}`;
  } catch {
    const fallback = normText(item.source_url || "");
    return fallback ? `raw#${fallback}` : null;
  }
}

function findCandidateBySourceUrl(candidatesByRef, itemSourceUrl, platform) {
  const target = normText(itemSourceUrl).toLowerCase();
  if (!target) return null;
  for (const list of candidatesByRef.values()) {
    for (const candidate of list) {
      const candidateUrl = normText(
        extractSourceUrlFromObject(candidate.rawRecord, candidate.row, platform),
      ).toLowerCase();
      if (!candidateUrl) continue;
      if (candidateUrl === target) return candidate;
    }
  }
  return null;
}

function main() {
  const summaryPath = OPTIONS.summaryPath;
  const summary = readJson(summaryPath);
  const results = Array.isArray(summary.results) ? summary.results : [];

  if (results.length === 0) {
    console.log("QA_PLATFORM_FIDELITY_FAIL no runnable results in summary");
    process.exit(OPTIONS.strict ? 2 : 0);
  }

  const includePlatforms = parseArgPlatformFilter(
    OPTIONS.includePlatforms ? Array.from(OPTIONS.includePlatforms) : [],
  );
  const report = {
    startedAt: new Date().toISOString(),
    summaryPath,
    strict: OPTIONS.strict,
    options: {
      includePlatforms: includePlatforms ? Array.from(includePlatforms) : [],
      maxItems: OPTIONS.maxItems,
      maxFailPrint: OPTIONS.maxFailPrint,
      reportPath: OPTIONS.reportPath,
    },
    pairs: [],
    stats: {
      totalSummaryResults: results.length,
      usedResults: 0,
      processedItems: 0,
      checkedMatches: 0,
      failedItems: 0,
      skippedItems: 0,
      swappedPriceHint: 0,
    },
    failures: [],
    warnings: [],
  };

  const crossRefMap = new Map();
  const crossUrlMap = new Map();
  const seenPairs = new Set();

  for (const result of results) {
    if (!result || !result.ok) continue;

    const platform = String(result.platform || "").toLowerCase();
    if (!platform) continue;
    if (includePlatforms && !includePlatforms.has(platform)) continue;
    const cfg = PLATFORM_CONFIG[platform];
    if (!cfg) {
      report.warnings.push({
        type: "skipped_pair",
        platform,
        reason: "platform config not defined for fidelity checks",
        name: result.name || "",
      });
      report.stats.skippedItems += 1;
      continue;
    }

    const { rawPath, normalizedPath } = pickRawNormalizedPairFromResult(result);
    if (!rawPath || !normalizedPath) {
      report.warnings.push({
        type: "skipped_pair",
        platform,
        reason: "raw/normalized file not available in summary",
        summaryKey: `platform=${platform}, name=${result.name || ""}`,
      });
      continue;
    }

    if (!fileExists(rawPath) || !fileExists(normalizedPath)) {
      report.warnings.push({
        type: "skipped_pair",
        platform,
        reason: "raw/normalized file missing",
        rawPath,
        normalizedPath,
      });
      continue;
    }

    const pairKey = `${platform}|${rawPath}|${normalizedPath}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const normalizedItems = loadNormalizedItems(normalizedPath);
    const selectedItems =
      OPTIONS.maxItems && Number.isFinite(OPTIONS.maxItems)
        ? normalizedItems.slice(0, OPTIONS.maxItems)
        : normalizedItems;
    const rawIndexResult = buildRawIndex(rawPath, platform);
    const normalizedCount = selectedItems.length;
    report.stats.usedResults += 1;
    report.stats.processedItems += normalizedCount;

    report.pairs.push({
      platform,
      name: result.name || "",
      rawPath,
      normalizedPath,
      rawParseFail: rawIndexResult.parseFail,
      candidateCount: rawIndexResult.candidateCount,
      normalizedCount,
    });

    for (const item of selectedItems) {
      const sourceRef = normText(item?.source_ref || item?.external_id || item?.id || "");
      if (!sourceRef) {
        report.stats.failedItems += 1;
        report.failures.push({
          platform,
          type: "missing_source_ref",
          normalizedSourceRef: "",
          summaryItem: {
            source_url: item?.source_url || "",
            source_ref: item?.source_ref || "",
            external_id: item?.external_id || "",
          },
          detail: "normalized item has no source_ref",
        });
        continue;
      }

      const candidates = rawIndexResult.index.get(sourceRef) || [];
      const finalCandidates = candidates.length
        ? candidates
        : [findCandidateBySourceUrl(rawIndexResult.index, item?.source_url || "", platform)].filter(Boolean);

      if (!finalCandidates.length) {
        report.stats.failedItems += 1;
        report.failures.push({
          platform,
          type: "no_raw_match",
          normalizedSourceRef: sourceRef,
          detail: "source_ref matching raw candidate not found",
          normalizedItem: {
            source_url: item?.source_url || "",
            rent_amount: item?.rent_amount ?? null,
            deposit_amount: item?.deposit_amount ?? null,
            area_exclusive_m2: item?.area_exclusive_m2 ?? null,
            area_gross_m2: item?.area_gross_m2 ?? null,
            address_text: item?.address_text || item?.address || "",
          },
        });
        continue;
      }

      const candidate = pickBestCandidate(finalCandidates, platform);
      const cmp = compareNormalizedItem(platform, item, candidate, {
        rawPath,
        normalizedPath,
        rawLine: candidate.rawLine,
      });

      const sourceUrlHost = (() => {
        try {
          return item.source_url ? new URL(item.source_url).host.toLowerCase() : "";
        } catch {
          return "";
        }
      })();

      report.stats.checkedMatches += 1;
      if (cmp.violations.length > 0) {
        for (const v of cmp.violations) {
        report.stats.failedItems += 1;
        report.failures.push({
          platform,
          type: "mismatch",
          normalizedSourceRef: sourceRef,
            normalizedItemSourceRef: item.source_ref || "",
            field: v.field,
            expected: v.expected,
            actual: v.actual,
            message: v.message,
            priceMode: cmp.priceMode || "unknown",
            rawLine: cmp.context.rawLine,
            rawSourceRef: cmp.rawSourceRef,
          });
          if (v.field === "price_order_mismatch") report.stats.swappedPriceHint += 1;
        }
      } else {
        // pass
      }

      const refKey = `${sourceUrlHost || platform}|${String(sourceRef)}`;
      if (!crossRefMap.has(refKey)) crossRefMap.set(refKey, new Set());
      crossRefMap.get(refKey).add(platform);

      const urlKey = extractSourceUrlForCrossCheck(item, platform, sourceRef);
      if (urlKey) {
        if (!crossUrlMap.has(urlKey)) crossUrlMap.set(urlKey, new Set());
        crossUrlMap.get(urlKey).add(platform);
      }
    }
  }

  const crossRefCollisions = [];
  for (const [sourceRef, platformSet] of crossRefMap.entries()) {
    if (platformSet.size > 1) {
      crossRefCollisions.push({
        sourceRef,
        platforms: Array.from(platformSet).sort(),
      });
    }
  }
  const crossUrlCollisions = [];
  for (const [urlKey, platformSet] of crossUrlMap.entries()) {
    if (platformSet.size > 1) {
      crossUrlCollisions.push({
        urlKey,
        platforms: Array.from(platformSet).sort(),
      });
    }
  }

  if (crossRefCollisions.length) {
    for (const c of crossRefCollisions) {
      report.failures.push({
        type: "cross_platform_source_ref",
        sourceRef: c.sourceRef,
        platforms: c.platforms,
        message: "same source_ref appears in multiple platforms",
      });
    }
  }

  if (crossUrlCollisions.length) {
    for (const c of crossUrlCollisions) {
      report.failures.push({
        type: "cross_platform_source_url",
        sourceUrlKey: c.urlKey,
        platforms: c.platforms,
        message: "same source_url appears in multiple platforms",
      });
    }
  }

  report.crossPlatform = {
    sourceRefCollisions: crossRefCollisions,
    sourceUrlCollisions: crossUrlCollisions,
  };

  report.stats.failedItems = Math.max(
    report.stats.failedItems,
    report.failures.filter((f) => f.type && !f.type.startsWith("skipped")).length,
  );

  const failCount = report.failures.length;
  report.summary = {
    totalPairs: report.pairs.length,
    totalChecks: report.stats.checkedMatches,
    totalFailures: failCount,
    swappedPriceHints: report.stats.swappedPriceHint,
    crossRefCollisionCount: crossRefCollisions.length,
    crossUrlCollisionCount: crossUrlCollisions.length,
    pass: failCount === 0,
  };

  fs.writeFileSync(OPTIONS.reportPath, JSON.stringify(report, null, 2), "utf8");

  const maxToPrint = Math.min(OPTIONS.maxFailPrint, report.failures.length);
  console.log(
    `QA_PLATFORM_DATA_FIDELITY_SUMMARY total=${report.stats.checkedMatches} fail=${report.summary.totalFailures} pairs=${report.pairs.length} pass=${report.summary.pass}`,
  );
  for (let i = 0; i < maxToPrint; i += 1) {
    const f = report.failures[i];
    console.log(
      [
        `- [${f.platform || "unknown"}]`,
        `type=${f.type}`,
        `field=${f.field || "-"}`,
        `source_ref=${f.normalizedSourceRef || "-"}`,
        `message=${f.message || "-"}`,
      ].join(" "),
    );
  }

  if (report.summary.totalFailures > maxToPrint) {
    console.log(`... and ${report.summary.totalFailures - maxToPrint} more failures (see report: ${OPTIONS.reportPath})`);
  }

  process.exit(report.summary.pass || !OPTIONS.strict ? 0 : 2);
}

main();
