#!/usr/bin/env node

import {
  ADAPTER_VALIDATION_CODES,
  ADAPTER_WARNING_LEVEL,
  BaseListingAdapter,
  normalizeDirection,
} from "./base_listing_adapter.mjs";

const BUILDING_TYPE_NAMES = new Set(["단독", "빌라", "연립", "다가구", "오피스텔", "아파트", "상가주택", "다세대", "주택", "원룸", "투룸"]);
const URL_IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)(\?|$)/i;

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

function collectNaverImageCandidates(raw) {
  const urls = [];
  const seen = new Set();

  const add = (url) => {
    if (typeof url !== "string") return;
    const trimmed = url.trim();
    if (!trimmed) return;

    try {
      const parsed = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
      const path = parsed.pathname.toLowerCase();
      if (!URL_IMAGE_RE.test(path)) return;
      if (seen.has(trimmed)) return;
      seen.add(trimmed);
      urls.push(trimmed);
    } catch {
      // Invalid URL
    }
  };

  const collectCandidateValue = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) collectCandidateValue(item);
      return;
    }
    if (value === null || value === undefined) return;
    if (typeof value === "string") {
      add(value);
      return;
    }
    if (typeof value === "object") {
      const candidates = [
        value.url,
        value.image,
        value.imageUrl,
        value.image_url,
        value.img,
        value.imgUrl,
        value.img_url,
        value.src,
        value.thumbnail,
        value.thumb,
        value.source,
        value.photo,
        value.photoUrl,
      ];
      for (const c of candidates) {
        collectCandidateValue(c);
      }
    }
  };

  const candidates = [
    raw._fetchedImages,
    raw.articlePhotos,
    raw.photos,
    raw.images,
    raw.imageList,
    raw.image_list,
    raw.articlePhotoList,
    raw.photoList,
    raw.photo_list,
    raw.cpLinkImageUrl,
    raw.cpLinkThumbnailUrl,
    raw.representativeImgUrl,
    raw.thumbnail,
    raw.thumbnailUrl,
  ];

  for (const candidate of candidates) {
    collectCandidateValue(candidate);
    if (urls.length >= 24) break;
  }

  return urls;
}

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

function normalizeNaverTradeType(tradeTypeCode, tradeTypeName, leaseType) {
  const combined = normalizeText(`${tradeTypeCode || ""} ${tradeTypeName || ""} ${leaseType || ""}`).toUpperCase();
  if (/(\bA1\b|매매|SALE|매입)/.test(combined)) return "A1";
  if (/(\bB1\b|전세|JEONSE)/.test(combined)) return "B1";
  return "B2";
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

  const parsedRequestUrl = (() => {
    try {
      return rawRecord?.request_url ? new URL(String(rawRecord.request_url)) : null;
    } catch {
      return null;
    }
  })();

  const requestMs = parsedRequestUrl?.searchParams?.get("ms") || "";
  const requestA = parsedRequestUrl?.searchParams?.get("a") || pick(item, ["tradeItem", "realEstateTypeCode", "houseTypeCode"], null);
  const fallbackA = normalizeText(requestA) || "DDDGG:JWJT:SGJT:VL";
  const fallbackB = normalizeNaverTradeType(
    pick(item, ["tradeTypeCode", "tradeType", "tradeTypeName"], null),
    pick(item, ["tradeTpNm", "tradeTypeName", "leaseType"], null),
    normalizeText(item?.tradeTypeCode || item?.tradeTypeName || ""),
  );

  const fallbackD = normalizeText(item?.rentPrc || item?.tradePrc || "80") || "80";

  const fallbackPattern = normalizeHttpUrl(
    requestMs
      ? `https://new.land.naver.com/houses?ms=${encodeURIComponent(requestMs)}&a=${encodeURIComponent(fallbackA)}&b=${encodeURIComponent(fallbackB)}&d=${encodeURIComponent(fallbackD)}&e=RETAIL&articleNo=${encodeURIComponent(fallbackRef)}`
      : `https://fin.land.naver.com/articles/${encodeURIComponent(fallbackRef)}`,
  );
  if (fallbackPattern) {
    return fallbackPattern;
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

const CP_IMAGE_HOSTS = new Set(["image.bizmk.kr", "land.mk.co.kr", "homesdid.co.kr", "image.neonet.co.kr"]);
const CP_IMAGE_HOST_SUFFIXES = [
  ".mk.co.kr",
  ".homesdid.co.kr",
  ".bizmk.kr",
  ".neonet.co.kr",
  ".serve.co.kr",
];
const CP_IMAGE_PATH_HINTS = [
  "/memulPhoto/",
  "/files/",
  "/files_new_",
  "/photo/",
  "/service/neonet/images/maemul/",
  "/member_profile/",
  "/member/",
];
const CP_NEONET_IMAGE_PATH_HINT = "/service/neonet/images/maemul/";
const CP_IMAGE_EXTENSION_RE = /\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?[^\\s"'<>]*)?$/i;
const CP_IMAGE_TIMEOUT_MS = 9000;
const CP_IMAGE_FETCH_RETRIES = 2;
const CP_IMAGE_FETCH_DELAY_MS = 250;
const CP_IMAGE_SOURCE_LIMIT = 24;
const CP_JSON_IMAGE_FIELD_HINTS = ["img", "image", "photo", "thumb", "file", "url", "path"];
const CP_IMAGE_PATH_BAD_PATTERNS = /(?:blank\.gif|\/ico_|logo|banner|offerings_|common\/|home(_on)?_|myhome|mc_btn|mmc_|noimg|facebook|btn_)/i;
const CP_IMAGE_SOURCE_HOST_HINTS = ["newimg.serve.co.kr", "img.serve.co.kr", "cdn.serve.co.kr", "serve.co.kr", "www.serve.co.kr"];
const CP_HOST_IMAGE_RULES = [
  {
    suffixes: ["land.mk.co.kr", ".mk.co.kr", "bizmk.kr", "image.bizmk.kr"],
    pathHints: ["/memulPhoto/", "/files/", "/files_new_", "/photo/", "/watermark/"],
  },
  {
    suffixes: ["homesdid.co.kr"],
    pathHints: ["/sb_images/"],
  },
  {
    suffixes: ["neonet.co.kr", "image.neonet.co.kr", "www.neonet.co.kr"],
    pathHints: ["/service/neonet/images/maemul/"],
  },
  {
    suffixes: ["newimg.serve.co.kr", "www.serve.co.kr", "serve.co.kr"],
    pathHints: ["/member_profile/", "/member/"],
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAllowedCpImageHost(hostname, pathname = "") {
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  const normalizedPathname = String(pathname || "").toLowerCase();

  if (CP_IMAGE_HOSTS.has(host)) return true;
  if (CP_IMAGE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(suffix))) return true;
  if (CP_IMAGE_SOURCE_HOST_HINTS.some((hint) => host === hint || host.endsWith(hint))) return true;

  const hasMatchedRule = CP_HOST_IMAGE_RULES.some((rule) => {
    const ruleMatchesHost = rule.suffixes.some((suffix) => host === suffix || host.endsWith(suffix));
    if (!ruleMatchesHost) return false;
    return rule.pathHints.length === 0 ? true : rule.pathHints.some((hint) => normalizedPathname.includes(hint));
  });
  if (hasMatchedRule) return true;

  return isAllowedCpImagePath(normalizedPathname);
}

function isAllowedCpImagePath(pathname) {
  if (CP_IMAGE_PATH_HINTS.some((hint) => pathname.includes(hint))) {
    return true;
  }

  if (!pathname) return false;
  if (pathname.includes(CP_NEONET_IMAGE_PATH_HINT)) {
    return !/(?:offerings_navi_|offerings_navi|offerings_menu|offerings_divide|mc_btn_|mmc_|icon_|btn_|home\/.+\.(gif|jpg|png)|common\/.+\.(gif|jpg|png)|search|blank\.gif|qr\.|banner|logo|copyright)/i.test(
      pathname,
    );
  }

  return false;
}

function normalizeCpImageUrl(raw, baseUrl = null) {
  const text = normalizeText(raw);
  if (!text) return null;

  let normalized = text;
  if (normalized.startsWith("//")) {
    normalized = `https:${normalized}`;
  } else if (!/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    if (!baseUrl) return null;
    try {
      normalized = new URL(normalized, baseUrl).toString();
    } catch {
      return null;
    }
  }

  const normalizedUrl = normalizeHttpUrl(normalized);
  if (!normalizedUrl) return null;

  let parsed;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return null;
  }

  const path = parsed.pathname || "";
  const host = parsed.hostname.toLowerCase();
  if (!isAllowedCpImageHost(host) && !isAllowedCpImagePath(path)) {
    return null;
  }
  if (String(path).includes("/main/")) {
    return null;
  }
  if (!CP_IMAGE_EXTENSION_RE.test(normalizedUrl)) {
    return null;
  }

  return parsed.toString();
}

function extractMkGalleryParamsFromHtml(html, key) {
  const match = new RegExp(`['"]${key}['"]\\s*:\\s*['"]([^'"]+)['"]`, "i").exec(html);
  return match?.[1] || null;
}

function buildMkGalleryUrl(detailPageUrl, html) {
  const parsedBase = (() => {
    try {
      return new URL(detailPageUrl);
    } catch {
      return null;
    }
  })();
  if (!parsedBase || parsedBase.hostname !== "land.mk.co.kr") return null;

  const aptcode = extractMkGalleryParamsFromHtml(html, "aptcode");
  const scalecode = extractMkGalleryParamsFromHtml(html, "scalecode");
  const mseq = extractMkGalleryParamsFromHtml(html, "mseq");
  if (!mseq) return null;

  const galleryUrl = new URL("/memul/popGallery.php", parsedBase);
  galleryUrl.searchParams.set("aptcode", aptcode || "0");
  galleryUrl.searchParams.set("scalecode", scalecode || "0");
  galleryUrl.searchParams.set("mseq", mseq);
  galleryUrl.searchParams.set("pc", "Y");
  return galleryUrl.toString();
}

function resolveRedirectFromValue(rawValue, baseUrl) {
  const value = normalizeText(rawValue);
  if (!value) return null;

  const concatMatch = /^['"]([^'"]+)['"]\s*\+\s*(location\.(?:search|hash|pathname|href|host|hostname))/i.exec(value);
  if (concatMatch && baseUrl) {
    try {
      const base = new URL(baseUrl);
      let suffix = "";
      if (concatMatch[2] === "location.search") suffix = base.search;
      if (concatMatch[2] === "location.hash") suffix = base.hash;
      if (concatMatch[2] === "location.pathname") suffix = base.pathname;
      if (concatMatch[2] === "location.href") suffix = base.href;
      if (concatMatch[2] === "location.host") suffix = base.host;
      if (concatMatch[2] === "location.hostname") suffix = base.hostname;
      return new URL(`${concatMatch[1]}${suffix}`, baseUrl).toString();
    } catch {
      return null;
    }
  }

  const quotedOnly = /^['"]([^'"]+)['"]$/.exec(value);
  if (quotedOnly) {
    try {
      return new URL(quotedOnly[1], baseUrl).toString();
    } catch {
      return null;
    }
  }

  return null;
}

function extractRedirectFromHtml(html, baseUrl) {
  const patterns = [
    /location\.replace\(\s*['"]([^'"]+)['"]/i,
    /window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i,
    /window\.location\.(?:href|replace)\s*=\s*["']([^"']+)["']/i,
    /location\s*=\s*['"]([^'"]+)['"]/i,
    /location\.assign\(\s*['"]([^'"]+)['"]/i,
    /location\.replace\(\s*([^)]+)\)/i,
    /window\.location(?:\.href)?\s*=\s*([^;]+);/i,
    /location\s*=\s*([^;]+);/i,
    /<meta[^>]+http-equiv=['"]refresh['"][^>]*url=([^'">\\s]+)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match || !match[1]) continue;
    const resolved = resolveRedirectFromValue(match[1], baseUrl);
    if (resolved) {
      return resolved;
    }
    try {
      return new URL(match[1], baseUrl).toString();
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchTextWithRetry(url, {
  timeoutMs = CP_IMAGE_TIMEOUT_MS,
  retries = CP_IMAGE_FETCH_RETRIES,
  maxRedirects = 3,
} = {}) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  };

  let currentUrl = normalizeHttpUrl(url);
  if (!currentUrl) return { ok: false, status: null, text: "" };

  let pageAttempts = 0;
  let networkAttempts = 0;
  let aggregatedText = "";
  let finalUrl = currentUrl;

  while (pageAttempts <= maxRedirects && networkAttempts <= retries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(currentUrl, {
        method: "GET",
        headers: {
          ...headers,
          Referer: currentUrl,
        },
        redirect: "manual",
        signal: controller.signal,
      });
      const text = await response.text();
      clearTimeout(timer);
      aggregatedText += `\n${text}`;

      if (response.status === 429 && networkAttempts < retries) {
        networkAttempts += 1;
        await sleep(CP_IMAGE_FETCH_DELAY_MS * (networkAttempts + 1) * 2);
        continue;
      }
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        const redirectTarget = response.headers.get("location");
        const nextUrl = new URL(redirectTarget, currentUrl).toString();
        currentUrl = nextUrl;
        finalUrl = nextUrl;
        pageAttempts += 1;
        continue;
      }

      const redirectedUrl = extractRedirectFromHtml(text, currentUrl);
      if (redirectedUrl && redirectedUrl !== finalUrl) {
        currentUrl = redirectedUrl;
        finalUrl = redirectedUrl;
        pageAttempts += 1;
        continue;
      }

      return {
        ok: response.ok,
        status: response.status,
        text: aggregatedText,
        finalUrl,
      };
    } catch (error) {
      clearTimeout(timer);
      if (networkAttempts >= retries) {
        return { ok: false, status: null, text: "", finalUrl, error: String(error?.message || error) };
      }
      networkAttempts += 1;
      await sleep(CP_IMAGE_FETCH_DELAY_MS * (networkAttempts + 1) * 2);
    }
  }

  return { ok: false, status: null, text: aggregatedText, finalUrl };
}

function extractCpImageUrlsFromHtml(html, imageLimit = 12, baseUrl = null) {
  if (!html) return [];
  const imageAttributeRegex = /(?:src|href|data-src|data-original|srcset|poster)\s*=\s*["']([^"']+)["']/gi;
  const absoluteImageRegex = /(?:https?:)?\/\/[^'"\\s<>]+\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?[^'"\\s<>]*)?/gi;
  const relativeImageRegex = /\/[^'"\\s<>]+\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?[^'"\\s<>]*)?/gi;
  const out = [];
  const seen = new Set();

  const addSrcsetUrls = (value) => {
    const candidates = String(value || "")
      .split(",")
      .map((entry) => normalizeText(entry || "").split(" ")[0])
      .filter(Boolean);

    for (const candidate of candidates) {
      const normalized = normalizeCpImageUrl(candidate, baseUrl);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= imageLimit) break;
    }
  };

  for (const match of html.matchAll(imageAttributeRegex)) {
    const raw = match[0].toLowerCase();
    const normalized = normalizeCpImageUrl(match[1], baseUrl);
    if (raw.includes("srcset")) {
      addSrcsetUrls(match[1]);
      continue;
    }
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= imageLimit) break;
  }

  if (out.length < imageLimit) {
    for (const match of html.matchAll(absoluteImageRegex)) {
      const normalized = normalizeCpImageUrl(match[0], baseUrl);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= imageLimit) break;
    }
  }

  if (out.length < imageLimit) {
    for (const match of html.matchAll(relativeImageRegex)) {
      const normalized = normalizeCpImageUrl(match[0], baseUrl);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= imageLimit) break;
    }
  }

  return out;
}

async function enrichImageUrlsFromCpArticleUrl(articleUrl, imageLimit) {
  if (!articleUrl) return [];
  const normalizedArticleUrl = normalizeHttpUrl(articleUrl);
  if (!normalizedArticleUrl) return [];

  const fetchResult = await fetchTextWithRetry(normalizedArticleUrl);
  if (!fetchResult.text) return [];

  const articleUrlForBase = fetchResult.finalUrl || normalizedArticleUrl;
  const cpImageUrls = extractCpImageUrlsFromHtml(fetchResult.text, imageLimit, articleUrlForBase);
  if (cpImageUrls.length > 0) return cpImageUrls;

  const mkGalleryUrl = buildMkGalleryUrl(articleUrlForBase, fetchResult.text);
  if (!mkGalleryUrl) return [];

  const mkGalleryResult = await fetchTextWithRetry(mkGalleryUrl);
  if (!mkGalleryResult.text) return [];

  return extractCpImageUrlsFromHtml(
    mkGalleryResult.text,
    imageLimit,
    mkGalleryResult.finalUrl || mkGalleryUrl,
  );
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

  // Naver "B1/2" format: B=basement, 1=level, /2=total floors
  const basementPair = /^B(\d+)\s*\/\s*(\d+)/i.exec(s);
  if (basementPair) {
    return { floor: -Math.max(1, Number(basementPair[1])), total_floor: Number(basementPair[2]) };
  }

  // Naver "고/3", "중/4", "저/3" format: relative floor / total
  const relativePair = /^(고|중|저)\s*\/\s*(\d+)/i.exec(s);
  if (relativePair) {
    return { floor: null, total_floor: Number(relativePair[2]) };
  }

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
  if (!normalized) return null;

  const directionRules = [
    [/남서향|남서|남서쪽/.test(normalized), "남서향"],
    [/남동향|남동|남동쪽/.test(normalized), "남동향"],
    [/북서향|북서|북서쪽/.test(normalized), "북서향"],
    [/북동향|북동|북동쪽/.test(normalized), "북동향"],
    [/남향|남쪽/.test(normalized), "남향"],
    [/북향|북쪽/.test(normalized), "북향"],
    [/동향|동쪽/.test(normalized), "동향"],
    [/서향|서쪽/.test(normalized), "서향"],
  ];

  for (const [condition, label] of directionRules) {
    if (condition) return label;
  }

  return normalized;
}

function normalizeBuildingUseValue(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const normalizedLower = normalized.toLowerCase();

  if (/(단독|다가구|다세대|다가지구|주택)/.test(normalizedLower)) return "단독/다가구";
  if (/(연립|빌라|빌라\/?연립)/.test(normalizedLower)) return "빌라/연립";

  return normalized;
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
    this.imageFallbackEnabled = options.imageFallbackEnabled !== false;
    this.imageFallbackLimit = Number.isFinite(Number(options.imageFallbackLimit))
      ? Math.max(1, Math.min(24, Number(options.imageFallbackLimit)))
      : this.imageLimit;
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

  async normalizeFromRawRecord(rawRecord) {
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

    const normalized = [];
    for (const entry of Array.from(bestBySource.values())) {
      const normalizedItem = await this.normalizeOne(entry.row, rawRecord);
      if (normalizedItem) normalized.push(normalizedItem);
    }
    return normalized;
  }

  async normalizeOne(item, rawRecord) {
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

    const imageUrls = collectNaverImageCandidates(item);
    const fallbackImageUrls = imageUrls.length === 0 && this.imageFallbackEnabled
      ? await enrichImageUrlsFromCpArticleUrl(
          pick(
            item,
            [
              "cpPcArticleUrl",
              "cpPcArticleLink",
              "cpPcArticleBridgeUrl",
              "cpMobileArticleUrl",
              "cpMobileArticleLink",
              "cpMobileArticleBridgeUrl",
            ],
            null,
          ),
          Math.max(1, this.imageFallbackLimit),
        )
      : [];

    // Extract coordinates — Naver articles have latitude/longitude as strings
    const rawLat = pick(item, ["latitude", "lat", "centerLat"], null);
    const rawLng = pick(item, ["longitude", "lng", "lon", "centerLon"], null);
    const lat = rawLat !== null ? parseFloat(String(rawLat)) : null;
    const lng = rawLng !== null ? parseFloat(String(rawLng)) : null;

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
      direction: normalizeDirection(
        pick(item, [
          "facing",
          "direction",
          "directionText",
          "houseDirection",
          "houseDir",
          "dir",
        ], null),
      ),
      building_use: normalizeBuildingUseValue(
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
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      image_urls: imageUrls.length > 0 ? imageUrls : fallbackImageUrls,
      raw_attrs: {
        atclNo: pick(item, ["atclNo"], null),
        articleNo: pick(item, ["articleNo", "articleId", "id"], null),
        articleName: pick(item, ["atclNm", "articleName"], null),
        itemNo: pick(item, ["itemNo"], null),
        cpPcArticleUrl: pick(item, ["cpPcArticleUrl"], null),
        cpMobileArticleUrl: pick(item, ["cpMobileArticleUrl"], null),
        siteImageCount: pick(item, ["siteImageCount"], null),
        imageCount: pick(item, ["imageCount", "imgCount"], null),
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
