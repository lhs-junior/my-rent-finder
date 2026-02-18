#!/usr/bin/env node

/**
 * 당근 부동산 자동 수집기
 * - 전략: Direct HTML fetch → JSON-LD (application/ld+json) 파싱
 * - 브라우저 불필요 (Node.js fetch만 사용)
 * - 구별 location ID 기반 필터링
 */

import fs from "node:fs";
import path from "node:path";

// ── CLI 인자 ──
const args = process.argv.slice(2);
function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}
const hasFlag = (name) => args.includes(name);

const sigungu = getArg("--sigungu", "노원구");
const sampleCap = Number(getArg("--sample-cap", "0")) || Infinity;
const rentMax = Number(getArg("--rent-max", "80"));
const depositMax = Number(getArg("--deposit-max", "6000"));
const minAreaM2 = Number(getArg("--min-area", "40"));
const verbose = hasFlag("--verbose");
const outputRaw = getArg("--output-raw", null);
const outputMeta = getArg("--output-meta", null);
const DETAIL_FETCH_CONCURRENCY = 4;
const DAANGN_IMAGE_URL_HOST_HINTS = [
  /(^|\.)kr\.gcp-karroter\.net$/i,
  /(^|\.)kakaocdn\.net$/i,
  /(^|\.)kakao\.com$/i,
  /(^|\.)daangn\.com$/i,
  /(^|\.)cloudfront\.net$/i,
  /(^|\.)imgur\.com$/i,
];
const DAANGN_IMAGE_EXT_RE = /(\.jpg|\.jpeg|\.png|\.webp|\.gif|\.avif|\.bmp|\.svg)(\?|$)/i;
const DAANGN_IMAGE_QUERY_HINT_RE = /(?:[?&])(?:w|width|h|height|s|size|q|fit|format|quality|type)=/i;
const DAANGN_IMAGE_PATH_HINT_RE = /(?:^|\/)(?:realty\/(?:article|origin)|img|image|photo|upload|media|cdn|files?)\/?/i;
const DAANGN_IMAGE_PATH_BLACKLIST_RE = /(?:^|\/)(?:assets\/(?:users|profile)|local-profile|origin\/profile|member\/|users?\/|profiles?\/|avatars?\/|default[-_ ]?(?:profile|avatar|image)|user[-_ ]?(?:profile|image)|no[-_]?image|placeholder|blank|dummy)(?:$|[./?\/])/i;
const DAANGN_LD_IMAGE_FIELDS = [
  "image",
  "images",
  "imgUrlList",
  "media",
  "mediaUrl",
  "media_url",
  "photo",
  "photoList",
  "photo_url",
  "thumbnail",
  "thumbnailUrl",
  "thumbnail_url",
];

function parseDaangnNumeric(rawValue) {
  const normalized = String(rawValue ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!normalized) return null;

  let candidate = normalized;
  if (/^\d+,\d+$/.test(candidate) && !/\./.test(candidate)) {
    candidate = candidate.replace(",", ".");
  } else {
    candidate = candidate.replace(/,/g, "");
  }

  const n = Number.parseFloat(candidate);
  return Number.isFinite(n) ? n : null;
}

function isLikelyDaangnImageUrl(candidate) {
  if (!candidate) return false;
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname || "";
    const path = parsed.pathname || "";
    const lowerPath = path.toLowerCase().replace(/\/+$/, "");
    const hasDaangnListingPath = /^\/kr\/realty\/[^/?#]+$/.test(lowerPath);
    if (hasDaangnListingPath) return false;
    const hintMatch = DAANGN_IMAGE_URL_HOST_HINTS.some((re) => re.test(host));
    const extensionMatch = DAANGN_IMAGE_EXT_RE.test(path);
    const queryMatch = DAANGN_IMAGE_QUERY_HINT_RE.test(`${parsed.search}${parsed.hash || ""}`);
    const pathHintMatch = DAANGN_IMAGE_PATH_HINT_RE.test(lowerPath);
    if (DAANGN_IMAGE_PATH_BLACKLIST_RE.test(lowerPath)) return false;
    if (!(extensionMatch || queryMatch || pathHintMatch)) return false;
    if (!hintMatch && !pathHintMatch && !queryMatch) return false;
    return true;
  } catch {
    return false;
  }
}

function hasDaangnKoreanBoundaryToken(text, token) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundaryRe = new RegExp(`(^|[^가-힣a-z0-9])${escaped}(?=$|[^가-힣a-z0-9])`, "i");
  return boundaryRe.test(` ${normalized} `);
}

function normalizeDaangnAreaClaim(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return null;
  if (text.includes("exclusive")
    || hasDaangnKoreanBoundaryToken(text, "전용")
    || hasDaangnKoreanBoundaryToken(text, "전용면적")
    || hasDaangnKoreanBoundaryToken(text, "실면적")
    || /실\s*면적/.test(text)
  ) {
    return "exclusive";
  }
  if (text.includes("gross")
    || hasDaangnKoreanBoundaryToken(text, "공급")
    || hasDaangnKoreanBoundaryToken(text, "연면적")
    || hasDaangnKoreanBoundaryToken(text, "건물면적")
    || hasDaangnKoreanBoundaryToken(text, "총면적")
  ) {
    return "gross";
  }
  if (text.includes("range")) return "range";
  if (text.includes("estimated")) return "estimated";
  return null;
}
const DAANGN_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
};

// ── 구별 당근 location ID 매핑 ──
// 당근 URL: https://www.daangn.com/kr/realty/?in=x-{id}
// ID는 동네 단위이지만, 해당 구의 매물을 가장 많이 포함하는 ID를 선택
const DISTRICT_IDS = {
  종로구: 2,
  중구: 20,
  성북구: 7,
  성동구: 60,
  동대문구: 70,
  광진구: 80,
  중랑구: 105,
  노원구: 185,
};

// ── 주거용 매물 타입 필터 ──
// SingleFamilyResidence: 원룸, 투룸, 빌라
// Place: 주택 (일부 주거용)
// Apartment: 아파트 (제외 - 우리 프로젝트는 빌라/다가구 대상)
const RESIDENTIAL_TYPES = new Set(["SingleFamilyResidence", "Place"]);

// ── 가격 파싱 ──
function parsePrice(name) {
  // 패턴1: "보증금만원/월세만원" (월세)
  // "1,000만원/50만원", "500만원/40만원", "1억2,000만원/70만원"
  const monthlyMatch = name.match(
    /(?:(\d+)억\s*)?([0-9,]+)만원\/([0-9,]+)만원/,
  );
  if (monthlyMatch) {
    let deposit = parseInt((monthlyMatch[2] || "0").replace(/,/g, ""), 10);
    if (monthlyMatch[1]) {
      deposit += parseInt(monthlyMatch[1], 10) * 10000;
    }
    const rent = parseInt((monthlyMatch[3] || "0").replace(/,/g, ""), 10);
    return { deposit, rent, type: "monthly" };
  }

  // 패턴2: 단일 가격 (전세 또는 매매)
  // "8,500만원", "3억5,000만원"
  const singleMatch = name.match(/(?:(\d+)억\s*)?([0-9,]+)만원/);
  if (singleMatch) {
    let amount = parseInt((singleMatch[2] || "0").replace(/,/g, ""), 10);
    if (singleMatch[1]) {
      amount += parseInt(singleMatch[1], 10) * 10000;
    }
    return { deposit: amount, rent: 0, type: "jeonse_or_sale" };
  }

  return null;
}

function isLikelySwappedMonthlyPrice(detailPrice, titlePrice) {
  if (!detailPrice || !titlePrice) return false;
  if (detailPrice.type !== "monthly" || titlePrice.type !== "monthly") return false;

  const detailDeposit = toNumber(detailPrice.deposit);
  const detailRent = toNumber(detailPrice.rent);
  const titleDeposit = toNumber(titlePrice.deposit);
  const titleRent = toNumber(titlePrice.rent);

  if ([detailDeposit, detailRent, titleDeposit, titleRent].some((v) => v === null)) {
    return false;
  }

  const exactInversion =
    detailDeposit === titleRent &&
    detailRent === titleDeposit;

  const suspiciousSwapPattern =
    detailRent > 250 &&
    detailDeposit < 100 &&
    detailRent > detailDeposit * 3 &&
    titleRent <= 90 &&
    titleDeposit >= 200;

  return exactInversion || suspiciousSwapPattern;
}

function resolveMonthlyPrice(rawTitle, detailPrice) {
  const titlePrice = parsePrice(rawTitle || "");
  if (!titlePrice) return detailPrice;

  if (!detailPrice || detailPrice.type !== "monthly") return titlePrice;
  if (titlePrice.type !== "monthly") return detailPrice;

  if (isLikelySwappedMonthlyPrice(detailPrice, titlePrice)) return titlePrice;
  return detailPrice;
}

// ── 매물 타입 파싱 (name에서 추출) ──
function parsePropertyType(name) {
  if (/빌라/.test(name)) return "빌라";
  if (/투룸|2룸/.test(name)) return "투룸";
  if (/쓰리룸|3룸/.test(name)) return "쓰리룸";
  if (/원룸|1룸/.test(name)) return "원룸";
  if (/오피스텔/.test(name)) return "오피스텔";
  if (/주택|단독/.test(name)) return "주택";
  if (/아파트/.test(name)) return "아파트";
  if (/상가/.test(name)) return "상가";
  if (/사무실/.test(name)) return "사무실";
  return "기타";
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/,/g, "").replace(/\s+/g, "");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeUrlPath(candidate) {
  if (candidate === null || candidate === undefined) return "";
  const pathOnly = String(candidate)
    .trim()
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("?")[0]
    .split("#")[0];
  return pathOnly.replace(/\/+$/, "");
}

function buildDetailKeys(identifier) {
  const keys = new Set();
  if (!identifier) return keys;

  const raw = String(identifier).trim();
  const candidates = new Set([
    raw,
    raw.split("?")[0].split("#")[0],
    raw.replace(/^https?:\/\/www\.daangn\.com/i, ""),
  ]);
  try {
    candidates.add(decodeURIComponent(raw));
  } catch {
    // noop
  }

  const addPath = (v) => {
    if (!v) return;
    const normalized = normalizeUrlPath(v);
    if (!normalized) return;

    const lower = normalized.toLowerCase();
    keys.add(normalized);
    keys.add(lower);

    if (/^https?:\/\//i.test(v)) {
      keys.add(normalized);
    } else if (normalized.startsWith("/")) {
      keys.add(`https://www.daangn.com${normalized}`);
      keys.add(`https://www.daangn.com${lower}`);
    } else {
      keys.add(`/${lower}`);
      keys.add(`https://www.daangn.com/${lower}`);
    }

    const parts = normalized.split("/");
    const last = parts[parts.length - 1];
    if (last) {
      keys.add(last);
      keys.add(last.toLowerCase());
    }
  };

  for (const v of candidates) {
    addPath(v);
    if (typeof v === "string" && /^https?:\/\//i.test(v)) {
      try {
        const u = new URL(v);
        addPath(u.pathname);
        addPath(decodeURIComponent(u.pathname));
      } catch {
        // noop
      }
    }
  }

  return keys;
}

function collectDaangnLookupCandidates(record) {
  if (!record) return [];

  const rawValues = new Set();
  const add = (value) => {
    if (value === null || value === undefined) return;

    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }

    if (typeof value === "number" || typeof value === "string") {
      const text = String(value).trim();
      if (text) rawValues.add(text);
      return;
    }

    if (typeof value !== "object") return;

    const candidates = [
      value.id,
      value.identifier,
      value.source_ref,
      value.sourceRef,
      value.external_id,
      value.externalId,
      value.articleNo,
      value.article_id,
      value.articleId,
      value.itemId,
      value.item_id,
      value.url,
      value.href,
      value.path,
      value.slug,
      value._id,
      value.uuid,
      value.realtyPostId,
      value.realty_post_id,
      value.postId,
      value.post_id,
      value.source_url,
      value.request_url,
      value.home_url,
      value.location,
      value.code,
    ];

    for (const candidate of candidates) {
      add(candidate);
    }
  };

  add(record);
  if (record && typeof record === "object") {
    add(record.payload_json);
    add(record.list_data);
    add(record._detail);
  }

  const out = new Set();
  for (const rawValue of rawValues) {
    for (const key of buildDetailKeys(rawValue)) {
      out.add(key);
    }
  }
  return Array.from(out);
}

function parseRemixContextFromHtml(html) {
  const marker = "window.__remixContext = ";
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const end = html.indexOf(";</script>", start);
  if (end === -1) return null;
  try {
    return JSON.parse(html.slice(start + marker.length, end));
  } catch {
    return null;
  }
}

function parseDaangnJsonLdCandidates(html) {
  const candidates = [];
  try {
    const ldMatches = html.matchAll(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/g);
    for (const match of ldMatches) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed && typeof parsed === "object") {
          candidates.push(parsed);
        }
      } catch {
        // noop
      }
    }
  } catch {
    // noop
  }
  return candidates;
}

function hasDaangnValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function scoreDaangnJsonLdRecord(record) {
  const keys = [
    "@type",
    "name",
    "address",
    "description",
    "trades",
    "floor",
    "floorLevel",
    "floorSize",
    "area",
    "areaPyeong",
    "supplyArea",
    "supplyAreaPyeong",
    ...DAANGN_LD_IMAGE_FIELDS,
  ];
  let score = 0;
  for (const key of keys) {
    if (hasDaangnValue(record[key])) score += 1;
  }
  return score;
}

function pickDaangnDetailFromJsonLd(candidates) {
  let best = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const t = String(candidate["@type"] || "").toLowerCase();
    if (t === "breadcrumblist" || t === "listitem") continue;

    const score = scoreDaangnJsonLdRecord(candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function isMissingDaangnField(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function mergeDaangnDetails(primary, fallback) {
  if (!fallback || typeof fallback !== "object") return primary || null;
  const merged = { ...(primary || {}) };
  for (const [key, value] of Object.entries(fallback)) {
    if (isMissingDaangnField(merged[key])) {
      merged[key] = value;
    }
  }
  return merged;
}

function collectDaangnDetails(html) {
  const context = parseRemixContextFromHtml(html);
  if (!context || typeof context !== "object") return new Map();

  try {
    const routeData = context?.state?.loaderData?.["routes/kr.realty._index"];
    const rawPosts = Array.isArray(routeData?.realtyPosts?.realtyPosts)
      ? routeData.realtyPosts.realtyPosts
      : Array.isArray(routeData?.realtyPosts)
        ? routeData.realtyPosts
        : [];
    const detailMap = new Map();

    for (const post of rawPosts) {
      if (!post || typeof post !== "object") continue;
      const keys = collectDaangnLookupCandidates(post);
      if (keys.length === 0) {
        for (const key of buildDetailKeys(post.id)) {
          detailMap.set(key, post);
        }
        for (const key of buildDetailKeys(post.identifier)) {
          detailMap.set(key, post);
        }
        for (const key of buildDetailKeys(post.href)) {
          detailMap.set(key, post);
        }
        for (const key of buildDetailKeys(post.url)) {
          detailMap.set(key, post);
        }
        continue;
      }
      for (const key of keys) {
        detailMap.set(key, post);
      }
    }
    return detailMap;
  } catch {
    return new Map();
  }
}

function collectDaangnDetailFromContext(context) {
  if (!context || typeof context !== "object") return null;
  const loaderData = context?.state?.loaderData;
  if (!loaderData || typeof loaderData !== "object") return null;

  const direct = loaderData["routes/kr.realty.$realty_post_id"]?.realtyPost;
  if (direct && typeof direct === "object") return direct;

  const walkForRealtyPost = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 8) return null;

    if (value.__typename === "RealtyPost" && value.id) return value;
    if (value.realtyPost && typeof value.realtyPost === "object") return value.realtyPost;

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walkForRealtyPost(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    for (const current of Object.values(value)) {
      const found = walkForRealtyPost(current, depth + 1);
      if (found) return found;
    }

    return null;
  };

  for (const payload of Object.values(loaderData)) {
    if (!payload || typeof payload !== "object") continue;
    if (payload.realtyPost && typeof payload.realtyPost === "object") {
      return payload.realtyPost;
    }
    if (Array.isArray(payload?.realtyPosts) && payload.realtyPosts.length > 0) {
      const first = payload.realtyPosts[0];
      if (first && typeof first === "object") return first;
    }

    const found = walkForRealtyPost(payload);
    if (found) return found;
  }
  return null;
}

function normalizeDaangnHtmlText(rawText) {
  if (rawText === null || rawText === undefined) return "";
  if (typeof rawText === "string") {
    return rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (Array.isArray(rawText)) {
    return rawText
      .map((item) => normalizeDaangnHtmlText(item))
      .filter(Boolean)
      .join(" ");
  }
  if (typeof rawText === "object") {
    if (rawText.text) return normalizeDaangnHtmlText(rawText.text);
    const values = [];
    for (const value of Object.values(rawText)) {
      if (typeof value === "string" || Array.isArray(value) || typeof value === "object") {
        values.push(normalizeDaangnHtmlText(value));
      }
    }
    return values.filter(Boolean).join(" ");
  }
  return "";
}

function toDaangnUrl(identifier) {
  if (!identifier) return null;
  const normalized = String(identifier).trim();
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("/")) return `https://www.daangn.com${normalized}`;
  return `https://www.daangn.com/kr/realty/${normalized}`;
}

function coerceCandidateToAbsoluteImage(rawValue) {
  const noAmp = String(rawValue)
    .replace(/&amp;/g, "&")
    .replace(/\u0026/g, "&")
    .trim()
    .replace(/\s+/g, "");
  if (!noAmp) return null;
  if (/^\/\//.test(noAmp)) return `https:${noAmp}`;
  if (/^\//.test(noAmp)) return `https://www.daangn.com${noAmp}`;
  if (/^[A-Za-z0-9.-]+\.[A-Za-z0-9.-]+\//.test(noAmp)) return `https://${noAmp}`;
  if (/^https?:\/\//i.test(noAmp)) return noAmp;
  return null;
}

async function fetchDaangnDetail(identifier) {
  const url = toDaangnUrl(identifier);
  if (!url) return null;

  // Strategy 1: Remix _data JSON API (faster, richer data including coordinates)
  try {
    const baseUrl = url.split("?")[0];
    const dataUrl = `${baseUrl}?_data=routes%2Fkr.realty.%24realty_post_id`;
    const jsonRes = await fetch(dataUrl, {
      headers: {
        ...DAANGN_FETCH_HEADERS,
        Accept: "application/json",
      },
    });
    if (jsonRes.ok) {
      const json = await jsonRes.json();
      const realtyPost = json?.realtyPost;
      if (realtyPost && typeof realtyPost === "object") {
        return realtyPost;
      }
    }
  } catch {
    // JSON API failed, fall back to HTML
  }

  // Strategy 2: HTML fetch + __remixContext parsing (fallback)
  const res = await fetch(url, { headers: DAANGN_FETCH_HEADERS });
  if (!res.ok) return null;

  const html = await res.text();
  const context = parseRemixContextFromHtml(html);
  const routeDetail = collectDaangnDetailFromContext(context);
  const ldDetail = pickDaangnDetailFromJsonLd(parseDaangnJsonLdCandidates(html));

  if (routeDetail && typeof routeDetail === "object") {
    return mergeDaangnDetails(routeDetail, ldDetail);
  }

  if (ldDetail && typeof ldDetail === "object") {
    return ldDetail;
  }
  return null;
}

function shouldHydrateDetail(item) {
  const detail = item?._detail || {};
  const hasValue = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return String(value).trim() !== "";
  };
  const hasArea =
    hasValue(detail.floorSize) ||
    hasValue(detail.area) ||
    hasValue(detail.areaPyeong) ||
    hasValue(detail.supplyArea) ||
    hasValue(detail.supplyAreaPyeong);
  const hasFloor =
    hasValue(detail.floor) ||
    hasValue(detail.topFloor) ||
    hasValue(detail.totalFloor) ||
    hasValue(detail.floorText) ||
    hasValue(detail.floorLevel) ||
    hasValue(detail.floor_level);
  const hasDirection =
    hasValue(detail.direction) ||
    hasValue(detail.directionText) ||
    hasValue(detail.orientation) ||
    hasValue(detail.facing) ||
    hasValue(detail.facingDirection) ||
    hasValue(detail.buildingOrientation) ||
    hasValue(detail.building_orientation) ||
    hasValue(detail.house_facing) ||
    hasValue(detail.houseFacing);
  const hasImage = coerceImageUrls([
    detail.images,
    detail.imgUrlList,
    detail.image_urls,
    detail.image,
    detail.image_url,
    detail.imageUrl,
    detail.photo,
    detail.photoList,
    detail.photo_url,
    detail.photoUrl,
    detail.media,
    detail.mediaUrl,
    detail.media_urls,
  ]).length > 0;
  return !(hasArea && hasFloor && hasDirection && hasImage);
}

async function hydrateItemsWithDetail(items) {
  const cache = new Map();
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (!item) continue;

      if (!shouldHydrateDetail(item)) continue;

      const key =
        extractListingId(item.identifier) ||
        extractListingId(item.id) ||
        extractListingId(item.source_ref) ||
        extractListingId(item.sourceRef) ||
        extractListingId(item.url) ||
        extractListingId(item.href) ||
        extractListingId(item.external_id) ||
        extractListingId(item.externalId);
      if (!key) continue;

      const seedCandidates = new Set(
        [
          key,
          item.source_url,
          item.url,
          item.href,
          item.identifier,
          item.id,
          item.source_ref,
          item.sourceRef,
          item.external_id,
          item.externalId,
          ...collectDaangnLookupCandidates(item),
        ].filter(Boolean),
      );

      const detailLookupCandidates = new Set();
      for (const candidate of seedCandidates) {
        for (const detailKey of buildDetailKeys(candidate)) {
          detailLookupCandidates.add(detailKey);
        }
      }

      let cachedDetail = null;
      let cacheHit = false;
      for (const detailKey of detailLookupCandidates) {
        if (!cache.has(detailKey)) continue;
        cacheHit = true;
        cachedDetail = cache.get(detailKey);
        break;
      }

      if (cacheHit) {
        if (cachedDetail) {
          item._detail = { ...item._detail, ...cachedDetail };
        }
        continue;
      }

      const fetchInputs = new Set(detailLookupCandidates);
      for (const candidate of detailLookupCandidates) {
        const toUrl = toDaangnUrl(candidate);
        if (toUrl) fetchInputs.add(toUrl);
      }

      let detail = null;
      for (const input of fetchInputs) {
        const fetchedDetail = await fetchDaangnDetail(input);
        if (fetchedDetail && typeof fetchedDetail === "object") {
          detail = fetchedDetail;
          break;
        }
      }

      for (const detailKey of detailLookupCandidates) {
        cache.set(detailKey, detail);
      }

      if (detail && typeof detail === "object") {
        item._detail = { ...item._detail, ...detail };
      }
    }
  };

  await Promise.all(
    new Array(Math.min(DETAIL_FETCH_CONCURRENCY, Math.max(1, items.length))).fill(0).map(() => worker()),
  );
}

function getDaangnDetail(detailMap, identifier) {
  const detailKeys = collectDaangnLookupCandidates(identifier);
  const candidates = detailKeys.length > 0 ? detailKeys : buildDetailKeys(identifier);
  for (const key of candidates) {
    const found = detailMap.get(key);
    if (found) {
      return found;
    }
  }
  return null;
}

function parseDaangnAreaFromAny(value, unitText = "") {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseDaangnAreaFromAny(item, unitText);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  if (typeof value === "object") {
    const unitFromValue = [
      value.unit,
      value.unitCode,
      value.unitText,
      value.unit_name,
      unitText,
    ]
      .filter(Boolean)
      .join(" ");

    const candidates = [
      value.value,
      value.area,
      value.size,
      value.sqM,
      value.sqm,
      value.sq,
      value.m2,
      value.min,
      value.max,
    ];

    for (const candidate of candidates) {
      const parsed = normalizeAreaValue(candidate, unitFromValue);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  return normalizeAreaValue(value, unitText);
}

function parseAreaFromDetail(detail) {
  if (!detail || typeof detail !== "object") {
    return {
      value: null,
      claimed: null,
    };
  }

  const areaFromText = parseAreaFromText(detail.areaText || detail.area_text || "");
  if (areaFromText.value !== null && Number.isFinite(areaFromText.value)) {
    return areaFromText;
  }

  const areaCandidates = [
    { value: detail.area, unit: detail.areaUnit || detail.area_unit || detail.areaUnitText || detail.unit, claimed: "exclusive" },
    { value: detail.area?.value, unit: detail.area?.unit || detail.area?.unitCode || detail.area?.unitText || detail.area?.unit_name || detail.areaUnit || detail.unit, claimed: "exclusive" },
    { value: detail.area?.min, unit: detail.area?.unit || detail.area?.unitCode || detail.area?.unitText || detail.area?.unit_name || detail.areaUnit || detail.unit, claimed: "exclusive" },
    { value: detail.size, unit: detail.areaUnit || detail.area_unit || detail.unit, claimed: "exclusive" },
    { value: detail.exclusiveArea, unit: detail.areaUnit || detail.unit, claimed: "exclusive" },
    { value: detail.exclusiveArea?.value, unit: detail.exclusiveArea?.unit || detail.exclusiveArea?.unitCode || detail.exclusiveArea?.unitText || detail.exclusiveArea?.unit_name || detail.areaUnit || detail.unit, claimed: "exclusive" },
    { value: detail.exclusiveArea?.min, unit: detail.exclusiveArea?.unit || detail.exclusiveArea?.unitCode || detail.exclusiveArea?.unitText || detail.exclusiveArea?.unit_name || detail.areaUnit || detail.unit, claimed: "exclusive" },
    { value: detail.areaPyeong, unit: "평", claimed: "exclusive" },
    { value: detail.supplyArea, unit: detail.supplyAreaUnit || detail.supplyUnit || detail.areaUnit || detail.unit, claimed: "gross" },
    { value: detail.supplyArea?.value, unit: detail.supplyArea?.unit || detail.supplyArea?.unitCode || detail.supplyArea?.unitText || detail.supplyArea?.unit_name || detail.supplyAreaUnit || detail.supplyUnit || detail.areaUnit || detail.unit, claimed: "gross" },
    { value: detail.supplyAreaText, unit: detail.supplyAreaUnit || detail.supplyUnit || detail.unit, claimed: "gross" },
    { value: detail.supplyAreaPyeong, unit: "평", claimed: "gross" },
  ];

  for (const candidate of areaCandidates) {
    const normalized = parseDaangnAreaFromAny(candidate.value, candidate.unit || "");
    if (normalized !== null && Number.isFinite(normalized)) {
      return {
        value: normalized,
        claimed: candidate.claimed,
      };
    }
  }

  const fromFloorSize = parseAreaFromFloorSize(detail.floorSize);
  if (fromFloorSize !== null && Number.isFinite(fromFloorSize)) {
    return {
      value: fromFloorSize,
      claimed: "estimated",
    };
  }

  const description = normalizeDaangnHtmlText(detail.content || detail.description || "");
  const fromDescription = parseAreaFromText(description);
  if (fromDescription.value !== null && Number.isFinite(fromDescription.value)) {
    return fromDescription;
  }

  return {
    value: null,
    claimed: null,
  };
}

function parsePriceFromDetail(detail) {
  if (!detail || typeof detail !== "object") return null;
  const trades = Array.isArray(detail.trades) ? detail.trades : [];

  // 월세 (monthly rent)
  const monthlyTrade = trades.find((trade) =>
    ["MONTH", "MONTHLY", "LEASE", "MONTHLY_RENT", "MONTHLY_RENTAL"].includes(
      String(trade?.type || "").toUpperCase(),
    ),
  );
  if (monthlyTrade) {
    const deposit = toNumber(monthlyTrade.deposit ?? monthlyTrade.monthlyDeposit ?? monthlyTrade.depositPrice ?? monthlyTrade.price);
    const rent = toNumber(
      monthlyTrade.monthlyPay ??
        monthlyTrade.monthlyRent ??
        monthlyTrade.rent ??
        monthlyTrade.price ??
        monthlyTrade.monthlyRentPrice ??
        monthlyTrade.rentPrice,
    );
    if (deposit !== null || rent !== null) {
      return { deposit, rent, type: "monthly" };
    }
  }

  // 전세 (jeonse / borrow)
  const jeonseTrade = trades.find((trade) =>
    ["BORROW", "JEONSE", "CHARTER"].includes(
      String(trade?.type || "").toUpperCase(),
    ),
  );
  if (jeonseTrade) {
    const deposit = toNumber(jeonseTrade.deposit ?? jeonseTrade.price ?? jeonseTrade.depositPrice);
    if (deposit !== null) {
      return { deposit, rent: 0, type: "jeonse" };
    }
  }

  return null;
}

function parseFloorValue(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number" && Number.isFinite(value)) return normalizeDaangnCollectorFloor(value);
  if (typeof value === "string") {
    const trim = value.trim();
    if (!trim) return null;
    const normalized = trim.replace(/\s+/g, "");
    const floorPairMatch = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/.exec(normalized);
    if (floorPairMatch) return normalizeDaangnCollectorFloor(floorPairMatch[1]);
    if (/반지하/.test(trim)) return -1;
    const basement = /지하\s*(\d+)?\s*층?/.exec(trim);
    if (basement) {
      const level = Number(basement[1] || 1);
      return -Math.max(1, level);
    }
    const b2 = /b(\d+)/i.exec(trim);
    if (b2) return -Math.max(1, Number(b2[1] || 1));
    const floorTextMatch = /(\d+(?:[.,]\d+)?)\s*층/.exec(trim);
    if (floorTextMatch) return normalizeDaangnCollectorFloor(floorTextMatch[1]);
    const floorOnlyPair = /(\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)/.exec(trim);
    if (floorOnlyPair) return normalizeDaangnCollectorFloor(floorOnlyPair[1]);
    return normalizeDaangnCollectorFloor(toNumber(trim));
  }
  return null;
}

function normalizeDaangnCollectorFloor(value) {
  const floor = toNumber(value);
  if (floor === null) return null;
  if (floor === 0.5 || floor === -0.5) return -1;
  return floor;
}

function normalizeAreaValue(value, unitText = "") {
  const n = parseDaangnNumeric(value);
  if (n === null) return null;
  const u = `${String(value)} ${String(unitText)}`.toUpperCase();
  if (/PY|PYEONG|평|坪|PYUNG/.test(u)) {
    return n * 3.306;
  }
  return n;
}

function parseAreaTextValue(rawNumber, rawUnit = "") {
  const n = parseDaangnNumeric(rawNumber);
  if (n === null) return null;
  const unit = String(rawUnit).trim().toUpperCase();
  if (/PY|PYEONG|평|坪|PYUNG/.test(unit)) return n * 3.306;
  return n;
}

function parseAreaFromFloorSize(floorSize) {
  if (!floorSize) return null;

  if (typeof floorSize === "number" || typeof floorSize === "string") {
    return normalizeAreaValue(floorSize);
  }

  if (typeof floorSize !== "object") return null;
  const candidates = [
    floorSize.value,
    floorSize.size,
    floorSize.area,
    floorSize.sqm,
    floorSize.m2,
  ];

  for (const candidate of candidates) {
    const value = normalizeAreaValue(candidate, floorSize.unitCode || floorSize.unit || floorSize.unitText);
    if (value !== null) return value;
  }

  return null;
}

function parseAreaFromText(description) {
  if (!description) {
    return {
      value: null,
      claimed: null,
    };
  }

  const patterns = [
    {
      claimed: "exclusive",
      re: /(?:전용|실|실면적)\s*(?:면적)?\s*[\(:]?\s*([0-9]+(?:[.,][0-9]+)?)\s*(㎡|m²|m2|제곱미터|평|py|평|坪|평수)/i,
    },
    {
      claimed: "gross",
      re: /(?:공급|연면적|건물면적)\s*(?:면적)?\s*[\(:]?\s*([0-9]+(?:[.,][0-9]+)?)\s*(㎡|m²|m2|제곱미터|평|py|坪|평수)/i,
    },
    {
      claimed: "estimated",
      re: /([0-9]+(?:[.,][0-9]+)?)\s*(㎡|m²|m2|제곱미터|평|py|坪|평수)/i,
    },
  ];

  for (const pattern of patterns) {
    const match = pattern.re.exec(String(description));
    if (!match) continue;
    const value = parseAreaTextValue(match[1], match[2]);
    if (value !== null) {
      return {
        value,
        claimed: pattern.claimed,
      };
    }
  }

  return {
    value: null,
    claimed: null,
  };
}

function parseArea(item) {
  const detailArea = parseAreaFromDetail(item?._detail);
  if (
    detailArea.value !== null
    && Number.isFinite(detailArea.value)
    && detailArea.claimed === "exclusive"
  ) {
    return detailArea;
  }

  const fromSchema = parseAreaFromFloorSize(item.floorSize ?? item?._detail?.floorSize);
  if (fromSchema !== null && Number.isFinite(fromSchema)) {
    return {
      value: fromSchema,
      claimed: "estimated",
    };
  }

  const fromDescription = parseAreaFromText(
    `${item.description || ""} ${normalizeDaangnHtmlText(item.content || "")}`,
  );
  if (
    fromDescription.value !== null
    && Number.isFinite(fromDescription.value)
    && fromDescription.claimed === "exclusive"
  ) {
    return fromDescription;
  }

  const fromName = parseAreaFromText(item.name || "");
  if (
    fromName.value !== null
    && Number.isFinite(fromName.value)
    && fromName.claimed === "exclusive"
  ) {
    return fromName;
  }

  return {
    value: null,
    claimed: null,
  };
}

function extractListingId(identifier) {
  if (!identifier) return null;
  const normalized = String(identifier).trim();
  const path = normalized.split("?")[0].split("#")[0];
  const segment = path.split("/").filter(Boolean).pop();
  if (!segment) return null;

  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();

  const candidates = [segment, decoded];
  for (const value of candidates) {
    if (/^[0-9A-Za-z]+$/.test(value)) return value;
    const lastMatch = value.match(/([0-9A-Za-z]+)$/);
    if (lastMatch?.[1]) return lastMatch[1];
    const lastDash = value.split("-").filter(Boolean).pop();
    if (lastDash) return lastDash;
  }

  return segment;
}

function coerceImageUrls(rawImage) {
  const out = [];
  const seen = new Set();
  const normalized = [];
  const push = (value) => {
    const s = coerceCandidateToAbsoluteImage(value);
    if (!s) return;

  try {
    const parsed = new URL(s);
    const path = parsed.pathname.toLowerCase();
    if (!isLikelyDaangnImageUrl(s)) return;
  } catch {
    return;
  }

    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  const walk = (v, depth = 0) => {
    if (!v || out.length >= 24 || depth > 6) return;
    if (typeof v === "string") {
      push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    if (typeof v === "object") {
      for (const val of Object.values(v)) walk(val, depth + 1);
    }
  };

  walk(rawImage);
  for (const url of out) {
    if (normalized.length >= 12) break;
    normalized.push(url);
  }
  return normalized;
}

function normalizeDaangnImageSources(detail, item) {
  return coerceImageUrls([
    detail,
    item,
    detail?.image,
    detail?.imageUrl,
    detail?.image_url,
    detail?.image_urls,
    detail?.img,
    detail?.imgUrl,
    detail?.imgUrlList,
    detail?.photo,
    detail?.photoUrl,
    detail?.photoList,
    detail?.photoList?.edges,
    detail?.media,
    detail?.mediaUrl,
    detail?.media_url,
    detail?.media?.nodes,
    detail?.media?.edges,
    detail?.photoList?.nodes,
    detail?.photo_url,
    detail?.thumbnail,
    detail?.thumbnailUrl,
    detail?.thumbnail_url,
    detail?.images?.url,
    detail?.images?.item,
    detail?.imgList,
    detail?.imgListURL,
    item?.image,
    item?.images,
    item?.imageUrl,
    item?.image_url,
    item?.image_urls,
    item?.img,
    item?.imgUrl,
    item?.imgUrlList,
    item?.photoList,
    item?.photoList?.edges,
    item?.photo_url,
    item?.photo,
    item?.media,
    item?.mediaUrl,
    item?.media_url,
    item?.media?.nodes,
    item?.media?.edges,
    item?.photoList?.nodes,
    item?.thumbnail,
    item?.thumbnailUrl,
    item?.thumbnail_url,
  ]);
}

function extractDaangnDirection(detail = {}, listData = {}) {
  const candidates = [
    listData.buildingOrientation,
    listData.building_orientation,
    listData.direction,
    listData.orientation,
    listData.facing,
    listData.facingDirection,
    listData.houseFacing,
    listData.house_facing,
    listData.directionText,
    listData.direction_desc,
    detail.direction,
    detail.orientation,
    detail.houseFacing,
    detail.facing,
    detail.buildingOrientation,
    detail.building_orientation,
    detail.directionText,
    detail.facingDirection,
    detail.direction_desc,
    detail.floor_desc,
    detail.directionText || "",
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const text = String(candidate).trim();
    if (!text) continue;
    const parsedDirection = parseDaangnDirection(text);
    return parsedDirection || text;
  }
  return "";
}

function parseFloor(item) {
  const detailFloorCandidate =
    item?._detail?.floor ??
    item?._detail?.floorText ??
    item?._detail?.floorLevel ??
    item?._detail?.floorLevelText ??
    item?._detail?.floor_level ??
    item?._detail?.floor_text;
  const detailFloor = parseFloorValue(detailFloorCandidate);
  if (detailFloor !== null) return detailFloor;

  if (item?.floorLevel !== undefined) {
    const bySchema = toNumber(item.floorLevel);
    if (bySchema !== null) {
      if (bySchema === 0 && /반지하/.test(item.description || "")) {
        return -1;
      }
      return normalizeDaangnCollectorFloor(bySchema);
    }
  }

  const txt = `${item.description || ""} ${item.name || ""}`;
  if (/반지하/.test(txt)) return -1;
  const basement = /지하\s*(\d+)?\s*층?/.exec(txt);
  if (basement) {
    const level = Number(basement[1] || 1);
    return -Math.max(1, level);
  }

  const b2 = /b(\d+)/i.exec(txt);
  if (b2) return -Math.max(1, Number(b2[1] || 1));

  const floorTextMatch = /(\d+)(?:[.,]\d+)?\s*층/.exec(txt);
  if (floorTextMatch) return normalizeDaangnCollectorFloor(floorTextMatch[1]);
  const floorPairMatch = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/.exec(txt);
  if (floorPairMatch) return normalizeDaangnCollectorFloor(floorPairMatch[1]);
  return null;
}

function normalizeTextForDirection(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDaangnDirection(raw) {
  const text = normalizeTextForDirection(raw);
  if (!text) return null;

  const uppercase = text.toUpperCase();
  if (/_FACING$/.test(uppercase) || /(^|\s)(NORTH|SOUTH|EAST|WEST)/.test(uppercase)) {
    const hasNorth = /NORTH/.test(uppercase);
    const hasSouth = /SOUTH/.test(uppercase);
    const hasEast = /EAST/.test(uppercase);
    const hasWest = /WEST/.test(uppercase);
    if (hasNorth && hasEast) return "북동향";
    if (hasSouth && hasEast) return "남동향";
    if (hasNorth && hasWest) return "북서향";
    if (hasSouth && hasWest) return "남서향";
    if (hasNorth) return "북향";
    if (hasSouth) return "남향";
    if (hasEast) return "동향";
    if (hasWest) return "서향";
  }

  const candidates = [
    [/남서향|남서|남서쪽/.test(text), "남서향"],
    [/남동향|남동|남동쪽/.test(text), "남동향"],
    [/북서향|북서|북서쪽/.test(text), "북서향"],
    [/북동향|북동|북동쪽/.test(text), "북동향"],
    [/남향|남쪽|남방향/.test(text), "남향"],
    [/북향|북쪽|북방향/.test(text), "북향"],
    [/동향|동쪽|동방향/.test(text), "동향"],
    [/서향|서쪽|서방향/.test(text), "서향"],
    [/\bE\b/i.test(text), "동향"],
    [/\bW\b/i.test(text), "서향"],
    [/\bS\b/i.test(text), "남향"],
    [/\bN\b/i.test(text), "북향"],
  ];

  for (const [match, value] of candidates) {
    if (match) return value;
  }

  return null;
}

// ── 수집 함수 ──
async function collectDistrict(districtName, locationId) {
  const url = `https://www.daangn.com/kr/realty/?in=x-${locationId}`;
  if (verbose) console.log(`  [${districtName}] Fetching: ${url}`);

  const res = await fetch(url, {
    headers: DAANGN_FETCH_HEADERS,
  });

  if (!res.ok) {
    console.error(`  [${districtName}] HTTP ${res.status}`);
    return { items: [], total: 0 };
  }

  const html = await res.text();
  const detailMap = collectDaangnDetails(html);
  const ldMatch = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  if (!ldMatch) {
    console.error(`  [${districtName}] No JSON-LD found`);
    return { items: [], total: 0 };
  }

  let ld;
  try {
    ld = JSON.parse(ldMatch[1]);
  } catch {
    console.error(`  [${districtName}] JSON-LD parse failed`);
    return { items: [], total: 0 };
  }
  const allItems = (ld.itemListElement || []).map((e) => e.item);
  if (verbose)
    console.log(
      `  [${districtName}] JSON-LD: ${allItems.length} items (numberOfItems: ${ld.numberOfItems})`,
    );

  // 1. 해당 구 매물만 필터링
  const districtItems = allItems.filter((item) => {
    const detail = getDaangnDetail(detailMap, item);
    if (detail?.region?.name2 === districtName) return true;
    return (
      item.address?.addressRegion === "서울특별시" &&
      item.address?.addressLocality === districtName
    );
  });
  if (verbose)
    console.log(
      `  [${districtName}] 해당 구 매물: ${districtItems.length}건`,
    );

  // 2. 주거용 타입만 필터링
  const residentialItems = districtItems
    .map((item) => ({
      ...item,
      _detail: getDaangnDetail(detailMap, item),
    }))
    .filter((item) => RESIDENTIAL_TYPES.has(item["@type"]));
  await hydrateItemsWithDetail(residentialItems);
  if (verbose)
    console.log(
      `  [${districtName}] 주거용 매물: ${residentialItems.length}건`,
    );

  // 3. 가격 파싱 및 조건 필터
  const filtered = [];
  for (const item of residentialItems) {
    const detailPrice = parsePriceFromDetail(item._detail);
    const price = resolveMonthlyPrice(item.name || "", detailPrice);
    if (!price) continue;
    if (price.type !== "monthly") continue; // 월세만

    // 보증금/월세 조건 체크
    if (rentMax > 0 && price.rent > rentMax) continue;
    if (depositMax > 0 && price.deposit > depositMax) continue;

    // 면적 체크 (있으면)
    const area = parseArea(item);
    const areaClaim = normalizeDaangnAreaClaim(area?.claimed);
    const areaValue = Number.isFinite(area.value) ? area.value : null;
    if (minAreaM2 > 0) {
      if (areaClaim !== "exclusive" || areaValue === null || areaValue < minAreaM2) continue;
    }

    const floor = parseFloor(item);

    const propertyType = parsePropertyType(item.name || "");

    filtered.push({
      ...item,
      _parsed: {
        deposit: price.deposit,
        rent: price.rent,
        priceType: price.type,
        propertyType,
        area,
        floor,
        district: districtName,
        hasDetail: Boolean(item._detail),
      },
    });
  }

  if (verbose)
    console.log(
      `  [${districtName}] 조건 충족: ${filtered.length}건 (월세 ≤${rentMax}, 보증금 ≤${depositMax})`,
    );

  return {
    items: filtered,
    total: districtItems.length,
    residential: residentialItems.length,
  };
}

// ── 메인 ──
async function main() {
  console.log("=== 당근 부동산 수집기 ===");
  console.log(
    `구: ${sigungu}, cap: ${sampleCap}, 월세≤${rentMax}, 보증금≤${depositMax}, 면적≥${minAreaM2}㎡`,
  );

  const districts = sigungu.split(",").map((s) => s.trim());
  const allRecords = [];
  const dedupeBySourceRef = new Set();
  const stats = {};

  for (const district of districts) {
    const locationId = DISTRICT_IDS[district];
    if (!locationId) {
      console.error(`  [${district}] 알 수 없는 구 (지원: ${Object.keys(DISTRICT_IDS).join(", ")})`);
      stats[district] = { error: "unknown_district" };
      continue;
    }

    const result = await collectDistrict(district, locationId);
    const cappedItems = result.items.slice(0, sampleCap);
    stats[district] = {
      total: result.total,
      residential: result.residential,
      filtered: result.items.length,
      capped: cappedItems.length,
    };

    for (const item of cappedItems) {
      const parsed = item._parsed;
      const detail = item._detail || {};
      const directionHint = extractDaangnDirection(detail, item);
      const areaClaim = normalizeDaangnAreaClaim(parsed.area?.claimed);
      const areaValue = Number.isFinite(parsed.area?.value) ? parsed.area.value : null;
      const sourceImageUrls = normalizeDaangnImageSources(detail, item);
      const normalizedDescription = normalizeDaangnHtmlText(
        `${item.description || ""} ${detail.content || detail.description || ""}`,
      );
      const detailForPayload = detail && typeof detail === "object" ? detail : null;
      const sourceIdentifier = item.identifier || item.id || item.url || item.href;
      const requestUrl = `https://www.daangn.com/kr/realty/?in=x-${locationId}`;
      const sourceRef = extractListingId(sourceIdentifier);
      const sourceUrl = toDaangnUrl(sourceIdentifier)
        || toDaangnUrl(item?.identifier)
        || toDaangnUrl(item?.url)
        || toDaangnUrl(item?.href)
        || requestUrl;
      const dedupeKey = (sourceRef || sourceUrl || "").toLowerCase();
      if (dedupeKey) {
        if (dedupeBySourceRef.has(dedupeKey)) continue;
        dedupeBySourceRef.add(dedupeKey);
      }

      const externalId = sourceRef || null;
      const totalFloor = detail.topFloor ?? detail.totalFloor ?? detail.total_floor ?? detail.floor_total;
      const normalizedTotalFloor =
        totalFloor != null && String(totalFloor).trim() !== "" ? `${String(totalFloor).trim()}층` : null;

      const record = {
        platform_code: "daangn",
        collected_at: new Date().toISOString(),
        source_url: sourceUrl || requestUrl,
        request_url: `https://www.daangn.com/kr/realty/?in=x-${locationId}`,
        response_status: 200,
        sigungu: district,
        payload_json: {
          id: externalId,
          source_ref: sourceRef,
          name: item.name,
          description: normalizedDescription,
          schemaType: item["@type"],
          propertyType: parsed.propertyType,
          deposit: parsed.deposit,
          rent: parsed.rent,
          area: areaValue,
          areaClaimed: areaClaim || parsed.area?.claimed || null,
          _parsed: parsed,
          _detail: detailForPayload,
          floor: parsed.floor,
          floorLevel: detail.floorLevel || detail.floor_level || detail.floor_level_text,
          floorSize: detail.floorSize,
          floorLevelText: detail.floorLevelText,
          floorText: detail.floorText,
          topFloor: detail.topFloor,
          totalFloor: detail.totalFloor,
          total_floor: normalizedTotalFloor,
          buildingOrientation: detail.buildingOrientation || detail.building_orientation,
          direction: directionHint,
          directionText: directionHint,
          supplyArea: detail.supplyArea,
          floorDesc: detail.floorText,
          floor_desc: detail.floorText,
          direction_desc: directionHint,
          areaPyeong: detail.areaPyeong,
          supplyAreaPyeong: detail.supplyAreaPyeong,
          images: sourceImageUrls,
          address: item.address,
          lat: detail.coordinate?.lat ?? null,
          lng: detail.coordinate?.lon ?? detail.coordinate?.lng ?? null,
          roomCnt: detail.roomCnt ?? null,
          bathroomCnt: detail.bathroomCnt ?? null,
          manageCost: detail.manageCost ?? null,
          detailSource: detail.__typename || "unknown",
        },
        list_data: {
          source_ref: sourceRef,
          priceTitle: `${parsed.deposit}/${parsed.rent}`,
          roomTitle: item.name?.replace(/ \| 당근부동산$/, "") || "",
          dongName: item.address?.streetAddress || "",
          propertyType: parsed.propertyType,
          floor: parsed.floor,
          floorLevel: detail.floorLevel || detail.floor_level || detail.floorLevelText,
          total_floor: normalizedTotalFloor,
          topFloor: detail.topFloor,
          floorText: detail.floorText || "",
          direction: directionHint,
          directionText: directionHint,
          floor_desc: detail.floorText,
          direction_desc: directionHint,
          imgUrlList: sourceImageUrls.map((img) => img.replace(/&amp;/g, "&")),
        },
      };
      allRecords.push(record);
    }
  }

  // ── JSONL 저장 ──
  const outputDir = path.join(process.cwd(), "scripts");
  const rawFile = outputRaw || path.join(outputDir, "daangn_raw_samples.jsonl");
  const lines = allRecords.map((r) => JSON.stringify(r));
  fs.writeFileSync(rawFile, lines.join("\n") + "\n", "utf8");
  console.log(`\n📁 Raw JSONL: ${rawFile} (${allRecords.length}건)`);

  // ── 결과 JSON ──
  const resultFile = outputMeta || path.join(outputDir, "daangn_capture_results.json");
  const resultData = {
    runId: `daangn_${Date.now()}`,
    success: allRecords.length > 0,
    districts: districts.join(","),
    sampleCap,
    filters: { rentMax, depositMax, minAreaM2 },
    stats,
    totalListings: allRecords.length,
    dataQuality: {
      grade: allRecords.length >= 5 ? "GOOD" : allRecords.length > 0 ? "PARTIAL" : "EMPTY",
      addressRate:
        allRecords.filter((r) => r.payload_json.address?.streetAddress).length /
        Math.max(allRecords.length, 1),
      imageRate:
        allRecords.filter((r) => r.payload_json.images?.length > 0).length /
        Math.max(allRecords.length, 1),
      areaRate:
        allRecords.filter((r) => r.payload_json.area !== null).length /
        Math.max(allRecords.length, 1),
    },
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(resultFile, JSON.stringify(resultData, null, 2), "utf8");
  console.log(`📊 Results: ${resultFile}`);

  // ── 요약 ──
  console.log("\n=== 수집 결과 ===");
  for (const [district, s] of Object.entries(stats)) {
    if (s.error) {
      console.log(`  ${district}: ❌ ${s.error}`);
    } else {
      console.log(
        `  ${district}: 전체 ${s.total} → 주거 ${s.residential} → 조건충족 ${s.filtered}`,
      );
    }
  }
  console.log(`  총 수집: ${allRecords.length}건`);
  console.log(`  데이터 품질: ${resultData.dataQuality.grade}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
