#!/usr/bin/env node

import {
  ADAPTER_VALIDATION_CODES,
  ADAPTER_WARNING_LEVEL,
  BaseListingAdapter,
} from "./base_listing_adapter.mjs";

const BUILDING_TYPE_NAMES = new Set(["단독", "빌라", "연립", "다가구", "오피스텔", "아파트", "상가주택", "다세대", "주택", "원룸", "투룸"]);

const CORTAR_TO_ADDRESS = {
  "1135000000": "서울특별시 노원구",
  "1126000000": "서울특별시 중랑구",
  "1123000000": "서울특별시 동대문구",
  "1121500000": "서울특별시 광진구",
  "1129000000": "서울특별시 성북구",
  "1120000000": "서울특별시 성동구",
  "1114000000": "서울특별시 중구",
  "1111000000": "서울특별시 종로구",
};

function extractCortarAddress(rawRecord) {
  const url = rawRecord?.request_url || rawRecord?.source_url || "";
  try {
    const parsed = new URL(url);
    const cortarNo = parsed.searchParams.get("cortarNo");
    if (!cortarNo) return null;
    // Exact match first
    if (CORTAR_TO_ADDRESS[cortarNo]) return CORTAR_TO_ADDRESS[cortarNo];
    // Prefix match: 동-level cortarNo (e.g. "1135010500") → district (e.g. "1135000000")
    const prefix = cortarNo.substring(0, 5);
    for (const [code, addr] of Object.entries(CORTAR_TO_ADDRESS)) {
      if (code.startsWith(prefix)) return addr;
    }
  } catch {}
  return null;
}

function extractCortarCode(rawRecord) {
  const url = rawRecord?.request_url || rawRecord?.source_url || "";
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("cortarNo") || null;
  } catch {}
  return null;
}

function normalizeText(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .trim();
}

function pick(v, keys) {
  for (const k of keys) {
    if (v && Object.prototype.hasOwnProperty.call(v, k)) {
      const value = v[k];
      if (value === null || value === undefined) continue;
      if (typeof value === "string" && !value.trim()) continue;
      return value;
    }
  }
  return null;
}

function normalizeHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const text = raw.startsWith("//") ? `https:${raw}` : raw.startsWith("http") ? raw : `https://${raw}`;
  try {
    const parsed = new URL(text);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function resolveNaverSourceUrl(item, rawRecord, sourceRef) {
  const rawCandidates = [
    pick(item, ["cpMobileArticleUrl", "cpMobileArticleLink", "cpMobileArticleLinkUrl"], null),
    pick(item, ["cpPcArticleUrl", "cpPcArticleLink", "cpPcArticleLinkUrl"], null),
    pick(item, ["cpPcArticleBridgeUrl", "cpMobileArticleBridgeUrl"], null),
    pick(item, ["articleUrl", "url", "detailUrl", "detail_url"], null),
    rawRecord?.source_url,
    rawRecord?.request_url,
  ];

  for (const candidate of rawCandidates) {
    const normalized = normalizeHttpUrl(candidate);
    if (normalized) return normalized;
  }

  const fallbackRef = normalizeText(sourceRef || "");
  if (!fallbackRef) return "";

  const fallbackPatterns = [
    `https://fin.land.naver.com/articles/${encodeURIComponent(fallbackRef)}`,
    `https://new.land.naver.com/article/${encodeURIComponent(fallbackRef)}`,
    `https://new.land.naver.com/rooms/${encodeURIComponent(fallbackRef)}`,
    `https://new.land.naver.com/houses?articleNo=${encodeURIComponent(fallbackRef)}&ms=0,0,15&e=RETAIL`,
  ];
  for (const candidate of fallbackPatterns) {
    const normalized = normalizeHttpUrl(candidate);
    if (normalized) return normalized;
  }

  return "";
}

function parseMoney(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  let s = normalizeText(value).replace(/,/g, "");
  if (!s || /협의|문의|전화|입력|상담|추가요청|contact/i.test(s)) return null;

  const mixedBillionWithoutUnit = /^([0-9]+(?:\.[0-9]+)?)\s*억\s+([0-9]+(?:\.[0-9]+)?)$/i.exec(s);
  if (mixedBillionWithoutUnit) {
    const billion = Number(mixedBillionWithoutUnit[1]);
    const rest = Number(mixedBillionWithoutUnit[2]);
    if (Number.isFinite(billion) && Number.isFinite(rest)) {
      return billion * 10000 + rest;
    }
  }

  const slashSplit = /^(.*?)\s*[\/:|]\s*(.*)$/.exec(s);
  if (slashSplit) {
    s = slashSplit[1].trim() || slashSplit[2].trim();
  }

  let total = 0;
  let matched = false;

  const unitRules = [
    { pattern: /([0-9]+(?:\.[0-9]+)?)\s*억/gi, mul: 10000 },
    { pattern: /([0-9]+(?:\.[0-9]+)?)\s*천\s*만(?:원)?/gi, mul: 1000 },
    { pattern: /([0-9]+(?:\.[0-9]+)?)\s*천만(?:원)?/gi, mul: 1000 },
    { pattern: /([0-9]+(?:\.[0-9]+)?)\s*만(?:원)?/gi, mul: 1 },
    { pattern: /([0-9]+(?:\.[0-9]+)?)\s*원/gi, mul: 0.0001 },
  ];

  const toNumberSafe = (raw) => {
    const num = Number(String(raw).replace(/[^0-9.]/g, ""));
    return Number.isFinite(num) ? num : null;
  };

  for (const rule of unitRules) {
    let matchedValue;
    let unitFound = false;
    const regex = new RegExp(rule.pattern);
    while ((matchedValue = regex.exec(s)) !== null) {
      const n = toNumberSafe(matchedValue[1]);
      if (n !== null) {
        matched = true;
        unitFound = true;
        total += n * rule.mul;
      }
    }
    if (unitFound) {
      s = s.replace(rule.pattern, " ");
    }
  }

  if (matched && Number.isFinite(total) && total > 0) {
    return total;
  }

  const remaining = s
    .replace(/(억|천\s*만|천만|만|원)/gi, " ")
    .replace(/[^0-9.]+/g, " ")
    .trim();
  const remainingValue = /^([0-9]+(?:\.[0-9]+)?)$/.exec(remaining);
  if (remainingValue) {
    const fallback = Number(remainingValue[1]);
    return Number.isFinite(fallback) ? total + fallback : null;
  }

  const unitless = /([0-9]+(?:\.[0-9]+)?)/.exec(s);
  if (!unitless) return null;
  const fallback = Number(unitless[1]);
  return Number.isFinite(fallback) ? fallback : null;
}

function normalizeLeaseType(v, code) {
  const s = normalizeText(v).toLowerCase();
  const c = normalizeText(code).toLowerCase();
  if (/(b2|월세|wolse|rent)/i.test(`${s} ${c}`)) return "월세";
  if (/(b1|전세|jeonse)/i.test(`${s} ${c}`)) return "전세";
  if (/(a1|매매|sale|매입|매입완료|매매완료|단기)/i.test(`${s} ${c}`)) return "매매";
  return "기타";
}

function normalizeLeaseTypeFilter(rawFilter) {
  if (!rawFilter) return null;

  const values = Array.isArray(rawFilter)
    ? rawFilter
    : String(rawFilter)
        .split(/[;,|]/)
        .map((v) => v.trim())
        .filter(Boolean);

  const filter = new Set();
  for (const value of values) {
    const s = normalizeText(value).toLowerCase();
    if (!s) continue;
    if (/(b2|월세|wolse|rent)/i.test(s)) filter.add("월세");
    if (/(b1|전세|jeonse)/i.test(s)) filter.add("전세");
    if (/(a1|매매|sale|매입|매입완료|매매완료|단기)/i.test(s)) filter.add("매매");
    if (/\b기타\b|other/.test(s)) filter.add("기타");
  }

  return filter.size > 0 ? filter : null;
}

function parseDealOrWarrantPrc(value) {
  const s = normalizeText(value);
  if (!s) return { deposit: null, rent: null, raw: null };

  const parts = /^(.*?)\s*[\/:|]\s*(.*?)$/.exec(s);
  if (parts) {
    const deposit = parseMoney(parts[1]);
    const rent = parseMoney(parts[2]);
    return {
      deposit,
      rent,
      raw: s,
    };
  }

  const parsed = parseMoney(s);
  return {
    deposit: parsed,
    rent: null,
    raw: s,
  };
}

function asNumber(v) {
  return parseMoney(v);
}

function toM2(value, unit) {
  if (!Number.isFinite(value)) return null;
  return unit === "py" ? Number((value * 3.305785).toFixed(3)) : value;
}

function parseArea(value, defaultUnit = "sqm") {
  if (value === null || value === undefined) {
    return {
      value: null,
      min: null,
      max: null,
      unit: defaultUnit,
      areaType: "estimated",
    };
  }

  if (typeof value === "number") {
    return {
      value: Number.isFinite(value) ? value : null,
      min: Number.isFinite(value) ? value : null,
      max: Number.isFinite(value) ? value : null,
      unit: "sqm",
      areaType: "estimated",
    };
  }

  const s = normalizeText(value)
    .replace(/\s+/g, " ")
    .replace(/,/g, "")
    .replace(/㎡|제곱미터|m\s*\^\s*2|m2|m²/gi, "sqm")
    .replace(/평/g, "py");

  if (!s) {
    return {
      value: null,
      min: null,
      max: null,
      unit: defaultUnit,
      areaType: "estimated",
    };
  }

  const parseValue = (raw, unit) => {
    const n = Number.parseFloat(String(raw).replace(/[^0-9.]/g, ""));
    const sqm = toM2(n, unit);
    return Number.isFinite(sqm) ? sqm : null;
  };

  const rangeWithUnit = /(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)\s*(sqm|py)/i.exec(s);
  if (rangeWithUnit) {
    const minRaw = Number.parseFloat(rangeWithUnit[1]);
    const maxRaw = Number.parseFloat(rangeWithUnit[2]);
    const unit = rangeWithUnit[3]?.toLowerCase() || defaultUnit;
    const min = parseValue(minRaw, unit);
    const max = parseValue(maxRaw, unit);
    if (min !== null && max !== null) {
      return {
        value: min,
        min,
        max,
        unit,
        areaType: "range",
      };
    }
  }

  const bothUnits = /(\d+(?:\.\d+)?)\s*(?:sqm|py)\s*[\(\[]?\s*(\d+(?:\.\d+)?)\s*(sqm|py)/i.exec(s);
  if (bothUnits) {
    const candidate = parseValue(bothUnits[2], bothUnits[3]?.toLowerCase() || defaultUnit);
    if (candidate !== null) {
      return {
        value: candidate,
        min: candidate,
        max: candidate,
        unit: bothUnits[3]?.toLowerCase() || defaultUnit,
        areaType: "estimated",
      };
    }
  }

  const single = /(\d+(?:\.\d+)?)\s*(sqm|py)/i.exec(s);
  if (single) {
    const unit = single[2]?.toLowerCase() || defaultUnit;
    const n = parseValue(single[1], unit);
    return {
      value: n,
      min: n,
      max: n,
      unit,
      areaType: "estimated",
    };
  }

  const fallback = /^(\d+(?:\.\d+)?)/.exec(s);
  const n = fallback ? Number.parseFloat(fallback[1]) : null;
  const v = Number.isFinite(n) ? n : null;
  return {
    value: v,
    min: v,
    max: v,
    unit: defaultUnit,
    areaType: "estimated",
  };
}

function parseFloorRaw(raw) {
  if (raw === null || raw === undefined) return { floor: null, total_floor: null };
  if (typeof raw === "number") {
    return { floor: raw, total_floor: null };
  }

  const s = normalizeText(raw);
  if (!s) return { floor: null, total_floor: null };

  const pair = /(\d+)\s*\/\s*(\d+)/.exec(s);
  if (pair) {
    return { floor: Number(pair[1]), total_floor: Number(pair[2]) };
  }

  const pair2 = /(\d+)\s*층\s*\/\s*(\d+)\s*층/.exec(s);
  if (pair2) {
    return { floor: Number(pair2[1]), total_floor: Number(pair2[2]) };
  }

  const basement = /지하\s*(\d+)?\s*층?/i.exec(s);
  if (basement) {
    const level = Number(basement[1] || 1);
    return { floor: -Math.max(1, level), total_floor: null };
  }

  const onlyFloor = /(\d+)\s*층/.exec(s);
  if (onlyFloor) {
    return { floor: Number(onlyFloor[1]), total_floor: null };
  }

  if (/(반지하|옥탑|반납|옥상)/i.test(s)) {
    return { floor: null, total_floor: null };
  }

  return { floor: null, total_floor: null };
}

function normalizeDirectionValue(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function parseRoom(value) {
  const s = normalizeText(value).toLowerCase();
  const matched = /(?:\b|^)([1-6])(?:\s*룸|\s*room|\s*r|\b)/i.exec(s);
  if (matched) return Number(matched[1]);

  const named = /(원룸|투룸|쓰리룸|오픈형|오피스텔)/.exec(s);
  if (named) {
    if (named[1] === "원룸") return 1;
    if (named[1] === "투룸") return 2;
    if (named[1] === "쓰리룸") return 3;
    if (named[1] === "오픈형" || named[1] === "오피스텔") return 2;
  }

  const fallback = Number(s.split(/[\s,/|]/)[0]);
  return Number.isFinite(fallback) ? fallback : null;
}

function isListingLike(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = [
    "atclNo",
    "articleNo",
    "articleId",
    "articleName",
    "atclNm",
    "tradePrc",
    "rentPrc",
    "rentPrice",
    "tradeTypeCode",
    "area1",
    "area2",
    "deposit",
    "spc1",
    "spc2",
    "area",
    "address",
    "addr",
    "atclAddr",
    "articleAddress",
    "lat",
    "lng",
    "images",
    "imgUrl",
    "itemNo",
    "complexNo",
  ];
  return keys.some((k) => Object.prototype.hasOwnProperty.call(value, k));
}

function collectCandidates(payload, depth = 0, visited = new WeakSet(), options = {}) {
  const maxDepth = options.maxDepth || 7;
  const maxNodes = options.maxNodes || 8000;
  const state = options._state || { used: 0 };
  options._state = state;

  if (depth > maxDepth || payload === null || payload === undefined) return [];
  if (typeof payload !== "object") return [];
  if (state.used >= maxNodes) return [];
  state.used += 1;

  const nodes = [];

  if (Array.isArray(payload)) {
    if (payload.length === 0) return [];
    if (isListingLike(payload[0])) return payload;

    const sample = payload.filter((item) => isListingLike(item));
    if (sample.length >= Math.max(1, payload.length * 0.35)) {
      return sample;
    }

    for (const item of payload) {
      nodes.push(...collectCandidates(item, depth + 1, visited, options));
    }
    return nodes;
  }

  if (visited.has(payload)) return [];
  visited.add(payload);

  const prioritized = [
    payload.articleList,
    payload.articles,
    payload.result?.articleList,
    payload.result?.items,
    payload.complexList,
    payload.complexes,
    payload.items,
    payload.data,
    payload.body,
    payload.body?.articleList,
    payload.body?.complexList,
    payload.body?.items,
    payload.list,
    payload.response,
  ];

  for (const cand of prioritized) {
    const arr = collectCandidates(cand, depth + 1, visited, options);
    if (arr.length > 0) {
      nodes.push(...arr);
    }
  }

  for (const [k, v] of Object.entries(payload)) {
    if (k.toLowerCase().includes("image")) continue;
    if (k.toLowerCase() === "payload") continue;
    nodes.push(...collectCandidates(v, depth + 1, visited, options));
  }

  return nodes;
}

function scoreListingCandidate(item) {
  let score = 0;

  const leaseType = normalizeLeaseType(
    pick(item, ["tradeTypeName", "tradeType", "tradeTypeCode"], null),
    pick(item, ["tradeTypeCode", "tradeType", "tradeTypeName"], null),
  );
  if (leaseType === "월세") score += 30;

  const address = normalizeAddress(item);
  if (address) score += 15;

  const hasStrongImageField = [
    "representativeImgUrl",
    "representativeImageUrl",
    "img",
    "imgUrl",
    "imageUrl",
    "photoUrl",
    "image",
  ].some((k) => {
    const value = pick(item, [k], null);
    return typeof value === "string" && normalizeText(value);
  });
  if (hasStrongImageField) score += 100;

  const parsedRent = asNumber(pick(item, ["rentPrc", "rentPrice"], null));
  const parsedDeposit = asNumber(pick(item, ["deposit", "depositAmount", "priceMin"], null));
  const parsedArea = asNumber(pick(item, ["area1", "spc1", "exclusiveArea"], null));
  const siteImageCount = asNumber(pick(item, ["siteImageCount"], null));

  if (parsedRent !== null || parsedDeposit !== null) score += 20;
  if (parsedArea !== null && parsedArea > 0) score += 15;
  if (siteImageCount !== null && siteImageCount > 0) score += 25;

  return score;
}

function collectImageUrls(item, options = {}) {
  const imageLimit = Number.isFinite(Number(options.imageLimit))
    ? Math.max(1, Math.min(32, Number(options.imageLimit)))
    : 10;

  const seenUrls = new Set();
  const seenNodes = new WeakSet();
  const out = [];

  const candidateKeys = [
    "images",
    "imageList",
    "imgs",
    "articleImages",
    "imgList",
    "thumbList",
    "thumbs",
    "img",
    "imgUrl",
    "imageUrl",
    "image_path",
    "photo",
    "photoUrl",
    "대표이미지",
    "image",
    "image_url",
    "imgUrlList",
    "imgPath",
    "picture",
    "representativeImgUrl",
    "representative",
    "representativeImageUrl",
    "representativeImgThumb",
    "imageListJson",
    "photoList",
    "photoUrl",
    "photoPath",
    "thumbUrl",
    "thumbList",
  ];

  const normalizeImageUrl = (raw) => {
    if (typeof raw !== "string") return null;
    const s = normalizeText(raw);
    if (!s) return null;
    if (s.startsWith("//")) return `https:${s}`;
    if (s.startsWith("/")) return `https://landthumb-phinf.pstatic.net${s}`;
    return /^https?:\/\//i.test(s) ? s : null;
  };

  const isLikelyImageUrl = (url) => {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.toLowerCase();
      return /(\.jpg|\.jpeg|\.png|\.webp|\.avif|\.gif)(\?|$)/i.test(path);
    } catch {
      return false;
    }
  };

  const addUrl = (urlCandidate) => {
    const url = normalizeImageUrl(urlCandidate);
    if (!url || !isLikelyImageUrl(url) || out.length >= imageLimit) return;
    try {
      new URL(url);
    } catch {
      return;
    }
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      out.push(url);
    }
  };

  const walk = (node) => {
    if (!node || out.length >= imageLimit) return;
    if (typeof node === "string") {
      addUrl(node);
      return;
    }

    if (typeof node !== "object") return;
    if (seenNodes.has(node)) return;
    seenNodes.add(node);

    for (const key of candidateKeys) {
      if (node[key] !== undefined && out.length < imageLimit) {
        walk(node[key]);
      }
    }

    for (const value of Object.values(node)) {
      if (out.length >= imageLimit) return;
      walk(value);
    }
  };

  walk(item);

  const text = normalizeText(pick(item, ["articleText", "description", "descriptionText", "content", "detailText", "comment"], ""));
  if (text) {
    const matchedUrls =
      text.match(/https?:\/\/[^\s'"<>]+\.(?:jpg|jpeg|png|webp|avif|gif)(?:\?[^\s'"<>]*)?/gi) || [];
    for (const matched of matchedUrls) {
      addUrl(matched);
      if (out.length >= imageLimit) break;
    }
  }

  return out;
}

function normalizeAddress(item) {
  const cand = normalizeText(
    pick(item, [
      "address",
      "addr",
      "juso",
      "atclAddr",
      "articleAddress",
      "fullAddress",
      "fullRoadAddr",
      "도로명주소",
      "지번주소",
    ]) ||
      pick(item, [
        "areaName",
        "tradeAreaName",
        "complexAddress",
        "regionName",
        "dongName",
        "gugunName",
        "detailAddress",
        "address1",
        "jibunAddress",
        "roadAddress",
      ], ""),
  );

  if (cand) return cand;

  const title = normalizeText(pick(item, ["atclNm", "articleName", "title", "name", "buildingName"], ""));
  if (title && !BUILDING_TYPE_NAMES.has(title)) return title;
  return null;
}

function isAccessBlocked(payload) {
  if (!payload || typeof payload !== "object") return false;

  const parts = [
    pick(payload, ["message", "errorMessage", "messageKo", "msg", "description", "reason", "detail", "alert", "statusText"], ""),
    pick(payload, ["code", "errorCode", "status", "statusCode", "resultCode", "error", "errCode"], ""),
    pick(payload, ["error_msg", "error_desc", "errorMessageKo"], ""),
  ];

  const s = normalizeText(parts.join(" ")).toLowerCase();
  if (!s) return false;

  const blockedWords = [
    "로그인",
    "차단",
    "block",
    "blocked",
    "forbidden",
    "권한",
    "접근",
    "제한",
    "too many",
    "rate limit",
    "429",
    "403",
    "401",
    "로그인하세요",
    "로봇",
  ];

  return blockedWords.some((w) => s.includes(w));
}

function buildFallbackRef(item) {
  const addr = normalizeAddress(item);
  const rent = asNumber(pick(item, ["tradePrc", "rentPrc", "rent", "monthlyRent", "rentAmount"], null));
  const deposit = asNumber(
    pick(item, ["deposit", "보증금", "depositAmount", "depositPrc", "prcDeposit"], null),
  );
  const area = parseArea(pick(item, ["spc1", "spc2", "exclusiveArea", "supplyArea", "grossArea"]));
  const room = parseRoom(pick(item, ["room", "roomCount", "roomCnt", "articleType", "roomType"], null));
  const key = `${addr || ""}|${rent || ""}|${deposit || ""}|${area.value || ""}|${room || ""}`;

  let hash = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${String((hash >>> 0) % 1000000000).padStart(9, "0")}`;
}

export class NaverListingAdapter extends BaseListingAdapter {
  constructor(options = {}) {
    super({
      platformCode: "naver",
      platformName: "네이버 부동산",
      collectionMode: "STEALTH_AUTOMATION",
      options,
    });

    this.imageLimit = Number.isFinite(Number(options.imageLimit))
      ? Math.max(1, Math.min(24, Number(options.imageLimit)))
      : 12;
    this.leaseTypeFilter = normalizeLeaseTypeFilter(
      options.leaseTypeFilter || options.leaseType,
    );
    this.maxCandidates = Number.isFinite(Number(options.maxCandidates))
      ? Math.max(1000, Number(options.maxCandidates))
      : 8000;
  }

  isLeaseTypeAllowed(leaseType) {
    if (!this.leaseTypeFilter || this.leaseTypeFilter.size === 0) return true;
    return this.leaseTypeFilter.has(leaseType);
  }

  normalizeFromRawRecord(rawRecord) {
    const payload = rawRecord.payload_json || rawRecord.payload || rawRecord._payload || {};
    if (!payload || typeof payload !== "object") return [];

    if (isAccessBlocked(payload)) {
      const err = new Error(ADAPTER_VALIDATION_CODES.SOURCE_ACCESS_BLOCKED);
      err.code = ADAPTER_VALIDATION_CODES.SOURCE_ACCESS_BLOCKED;
      throw err;
    }

    const rows = collectCandidates(payload, 0, new WeakSet(), {
      maxDepth: 10,
      maxNodes: this.maxCandidates,
    });

    const bestBySource = new Map();
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const sourceRef =
        pick(row, [
          "atclNo",
          "articleNo",
          "articleId",
          "complexNo",
          "complexNoCd",
          "itemNo",
          "id",
        ]) || buildFallbackRef(row);

      const key = `naver::${String(sourceRef)}`;
      const nextScore = scoreListingCandidate(row);
      const existing = bestBySource.get(key);
      if (!existing || existing.score < nextScore) {
        bestBySource.set(key, { row, score: nextScore });
      }
    }

    return Array.from(bestBySource.values())
      .map((entry) => entry.row)
      .map((item) => this.normalizeOne(item, rawRecord))
      .filter((item) => item !== null);
  }

  normalizeOne(item, rawRecord) {
    const sourceRef =
      pick(item, [
        "atclNo",
        "articleNo",
        "articleId",
        "complexNo",
        "complexNoCd",
        "itemNo",
        "id",
      ]) || buildFallbackRef(item);

    if (!sourceRef && !pick(item, ["atclNm", "articleName", "title", "articleTitle", "atclNm"], null)) {
      return null;
    }

    const tradeTypeCode = pick(
      item,
      [
        "tradeTypeCode",
        "tradeType",
        "tradeTypeCd",
      ],
      null,
    );
    const tradeTypeName = pick(
      item,
      [
        "tradTpNm",
        "tradeType",
        "tradeTypeName",
        "leaseType",
        "rentType",
        "type",
        "articleType",
      ],
      null,
    );
    let addr = normalizeAddress(item);
    if (!addr) {
      addr = extractCortarAddress(rawRecord);
    }
    const exclusive = parseArea(
      pick(
        item,
        [
          "area1",
          "spc1",
          "exclusiveArea",
          "전용면적",
          "exclusiveAreaM2",
          "areaExcl",
        ],
        null,
      ),
    );
    const gross = parseArea(
      pick(
        item,
        [
          "area2",
          "spc2",
          "grossArea",
          "supplyArea",
          "공급면적",
          "supplyAreaM2",
          "areaGross",
        ],
        null,
      ),
    );

    const floorValue = parseFloorRaw(
      pick(item, ["flrInfo", "floorInfo", "floor", "floorInfoText", "floorText"], null),
    );

    const leaseType = normalizeLeaseType(tradeTypeName, tradeTypeCode);
    if (!this.isLeaseTypeAllowed(leaseType)) {
      return null;
    }

    const splitPrice = parseDealOrWarrantPrc(
      pick(
        item,
        [
          "dealOrWarrantPrc",
          "dealOrWarrantPrice",
          "tradePrice",
          "sameAddrMaxPrc",
        ],
        null,
      ),
    );

    let rentAmount = asNumber(
      pick(item, ["tradePrc", "rentPrc", "rent", "monthlyRent", "rentAmount", "월세", "rentFee", "월세금액"], null),
    );
    let depositAmount = asNumber(
      pick(item, ["deposit", "보증금", "depositAmount", "depositPrc", "prcDeposit", "보증금금액"], null),
    );

    if (depositAmount === null && splitPrice.deposit !== null) {
      depositAmount = splitPrice.deposit;
    }
    if (rentAmount === null && splitPrice.rent !== null) {
      rentAmount = splitPrice.rent;
    }
    if (leaseType === "월세" && rentAmount === null && depositAmount !== null && splitPrice.deposit !== null) {
      rentAmount = splitPrice.rent;
    }

    if (leaseType === "전세" && rentAmount !== null && depositAmount === null) {
      depositAmount = rentAmount;
      rentAmount = null;
    }

    if (leaseType === "매매" && rentAmount !== null && depositAmount === null) {
      depositAmount = rentAmount;
      rentAmount = null;
    }

    let areaClaimed = "estimated";
    if (exclusive.value !== null) areaClaimed = "exclusive";
    if (exclusive.value === null && gross.value !== null) areaClaimed = "gross";
    if (
      (exclusive.areaType === "range" && exclusive.value !== null) ||
      (gross.areaType === "range" && gross.value !== null)
    ) {
      areaClaimed = "range";
    }

    const roomRaw = pick(item, [
      "roomCount",
      "roomCnt",
      "room",
      "articleType",
      "tradeType",
      "roomNm",
      "roomType",
    ], null);

    const normalized = {
      platform_code: "naver",
      collected_at: rawRecord.collected_at || new Date().toISOString(),
      source_url: resolveNaverSourceUrl(item, rawRecord, sourceRef),
      source_ref: sourceRef ? String(sourceRef) : null,
      external_id: sourceRef ? String(sourceRef) : null,
      address_text: addr || null,
      address_code: extractCortarCode(rawRecord),
      lease_type: leaseType,
      rent_amount: rentAmount,
      deposit_amount: depositAmount,
      area_exclusive_m2: exclusive.value,
      area_exclusive_m2_min: exclusive.min,
      area_exclusive_m2_max: exclusive.max,
      area_gross_m2: gross.value,
      area_gross_m2_min: gross.min,
      area_gross_m2_max: gross.max,
      area_claimed: areaClaimed,
      room_count: Number.isFinite(Number(roomRaw))
        ? Number(roomRaw)
        : parseRoom(
            pick(item, ["roomType", "roomNm", "articleTitle", "atclNm", "title"], null) ||
              normalizeText(pick(item, ["atclDtl", "tradeTitle"], "")),
          ),
      direction: normalizeDirectionValue(
        pick(item, [
          "facing",
          "direction",
          "directionText",
          "houseDirection",
          "houseDir",
          "dir",
        ], null),
      ),
      building_use: normalizeDirectionValue(
        pick(item, [
          "houseType",
          "houseTypeNm",
          "houseTypeName",
          "atclType",
          "buildingType",
          "buildingTypeNm",
          "type",
        ], null),
      ),
      floor: floorValue.floor,
      total_floor: floorValue.total_floor,
      building_name: pick(item, ["buildingName", "cntrName", "complexName", "complexNameKr"], null),
      agent_name: pick(item, ["agentName", "realtorName", "broker", "agent"], null),
      agent_phone: pick(item, ["agentPhone", "realtorPhone", "tel", "phone", "contact"], null),
      listed_at: pick(item, ["atclCrtYmd", "createdAt", "등록일", "등록일시"], null),
      available_date: pick(item, ["useDate", "availableDate", "입주가능일"], null),
      image_urls: collectImageUrls(item, { imageLimit: this.imageLimit }),
      raw_attrs: {
        atclNo: pick(item, ["atclNo"], null),
        articleNo: pick(item, ["articleNo", "articleId", "id"], null),
        articleName: pick(item, ["atclNm", "articleName"], null),
        itemNo: pick(item, ["itemNo"], null),
        cpPcArticleUrl: pick(item, ["cpPcArticleUrl"], null),
        cpMobileArticleUrl: pick(item, ["cpMobileArticleUrl"], null),
        direction: pick(item, ["facing", "direction", "directionText", "houseDirection"], null),
        building_use: pick(item, ["houseType", "houseTypeNm", "buildingType", "buildingTypeNm", "atclType"], null),
      },
    };

    if (!normalized.address_text) {
      normalized.validation = [
        {
          level: ADAPTER_WARNING_LEVEL.WARN,
          code: ADAPTER_VALIDATION_CODES.ADDRESS_NORMALIZE_FAIL,
          message: "주소 정규화 실패",
          detail: {
            address_candidates: pick(item, [
              "address",
              "addr",
              "atclAddr",
              "articleAddress",
              "fullAddress",
            ], null),
          },
        },
      ];
    }

    if (isAccessBlocked(item)) {
      normalized.validation = [
        {
          level: ADAPTER_WARNING_LEVEL.WARN,
          code: ADAPTER_VALIDATION_CODES.SOURCE_ACCESS_BLOCKED,
          message: "로그인/권한 부족 응답으로 판정됨",
          detail: { raw_keys: Object.keys(item || {}).slice(0, 10) },
        },
      ];
    }

    return normalized;
  }
}
