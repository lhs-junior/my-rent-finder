#!/usr/bin/env node

import { BaseUserOnlyAdapter } from "./user_only_listing_adapter.mjs";

const DAANGN_IMAGE_URL_HOST_HINTS = [
  /(^|\.)kr\.gcp-karroter\.net$/i,
  /(^|\.)kakaocdn\.net$/i,
  /(^|\.)kakao\.com$/i,
  /(^|\.)daangn\.com$/i,
  /(^|\.)cloudfront\.net$/i,
];
const DAANGN_IMAGE_EXT_RE = /(\.jpg|\.jpeg|\.png|\.webp|\.gif|\.avif|\.bmp|\.svg)(\?|$)/i;
const DAANGN_IMAGE_QUERY_HINT_RE = /(?:[?&])(?:w|width|h|height|s|size|q|fit|format|quality|type)=/i;
const DAANGN_IMAGE_PATH_HINT_RE = /(?:^|\/)(?:realty\/(?:article|origin)|img|image|photo|upload|media|cdn|files?)\/?/i;
const DAANGN_MIN_AREA_M2 = (() => {
  const rawMinArea = process.env.DAANGN_MIN_AREA_M2 ?? process.env.MIN_AREA_M2;
  const parsed = rawMinArea === undefined ? NaN : Number.parseFloat(String(rawMinArea));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 40;
})();

function isDaangnAreaAboveMin(item) {
  const area = item?.area_exclusive_m2;
  const numericArea = Number(area);
  return Number.isFinite(numericArea) && numericArea >= DAANGN_MIN_AREA_M2;
}

function hasDaangnKoreanBoundaryToken(text, token) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundaryRe = new RegExp(`(^|[^가-힣a-z0-9])${escaped}(?=$|[^가-힣a-z0-9])`, "i");
  return boundaryRe.test(` ${normalized} `);
}

function normalizeDaangnAreaClaim(raw) {
  const normalized = String(raw || "").trim().toLowerCase();
  if (!normalized) return "estimated";

  if (normalized === "exclusive"
    || normalized.includes("exclusive")
    || hasDaangnKoreanBoundaryToken(normalized, "전용")
    || hasDaangnKoreanBoundaryToken(normalized, "전용면적")
    || hasDaangnKoreanBoundaryToken(normalized, "실면적")
    || /실\s*면적/.test(normalized)
  ) {
    return "exclusive";
  }

  if (normalized === "gross"
    || normalized.includes("gross")
    || hasDaangnKoreanBoundaryToken(normalized, "공급")
    || hasDaangnKoreanBoundaryToken(normalized, "연면적")
    || hasDaangnKoreanBoundaryToken(normalized, "건물면적")
    || hasDaangnKoreanBoundaryToken(normalized, "총면적")
  ) {
    return "gross";
  }

  if (normalized === "range"
    || normalized.includes("range")
    || hasDaangnKoreanBoundaryToken(normalized, "범위")
  ) {
    return "range";
  }

  if (normalized === "estimated"
    || normalized.includes("estimated")
    || hasDaangnKoreanBoundaryToken(normalized, "추정")
    || hasDaangnKoreanBoundaryToken(normalized, "대략")
  ) {
    return "estimated";
  }

  return "estimated";
}

function isDaangnAreaClaimExclusive(item) {
  return normalizeDaangnAreaClaim(item?.area_claimed) === "exclusive";
}

function hasDaangnImageList(item) {
  const images = Array.isArray(item?.image_urls) ? item.image_urls : null;
  if (!images || images.length === 0) return false;
  return images.some((imageUrl) => typeof imageUrl === "string" && imageUrl.trim().length > 0);
}

function normalizeDaangnGrossArea(item, normalizedArea) {
  if (item.area_exclusive_m2 == null && Number.isFinite(normalizedArea) && normalizedArea > 0) {
    item.area_gross_m2 = normalizedArea;
    if (!item.area_claimed || item.area_claimed === "estimated") {
      item.area_claimed = "gross";
    }
    return;
  }
}

function isValidDaangnArea(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0;
}
const DAANGN_IMAGE_PATH_BLACKLIST_RE = /(?:^|\/)(?:assets\/(?:users|profile)|local-profile|origin\/profile|member\/|users?\/|profiles?\/|avatars?\/|default[-_ ]?(?:profile|avatar|image)|user[-_ ]?(?:profile|image)|no[-_]?image|placeholder|blank|dummy)(?:$|[./?\/])/i;
const DAANGN_IMAGE_LISTING_PATH_RE = /^\/kr\/realty\/[^/?#]+$/i;

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

function normalizeDaangnAreaValue(rawArea) {
  if (rawArea === null || rawArea === undefined) return null;
  if (typeof rawArea === "number") return Number.isFinite(rawArea) ? rawArea : null;
  if (typeof rawArea === "string") return normalizeDaangnAreaText(rawArea);

  if (typeof rawArea === "object") {
    const candidateUnits = [
      rawArea.unit,
      rawArea.unitCode,
      rawArea.unitText,
      rawArea.unit_name,
    ];
    const unitFromArea = candidateUnits.filter((v) => v).join(" ");

    if (rawArea.value !== undefined && rawArea.value !== null) {
      return normalizeDaangnAreaText(rawArea.value, unitFromArea);
    }
    if (rawArea.area !== undefined && rawArea.area !== null) {
      return normalizeDaangnAreaText(rawArea.area, unitFromArea);
    }
    if (rawArea.size !== undefined && rawArea.size !== null) {
      return normalizeDaangnAreaText(rawArea.size, unitFromArea);
    }
    if (rawArea.min !== undefined && rawArea.min !== null) {
      return normalizeDaangnAreaText(rawArea.min, unitFromArea);
    }
    if (rawArea.max !== undefined && rawArea.max !== null) {
      return normalizeDaangnAreaText(rawArea.max, unitFromArea);
    }
  }

  return null;
}

function normalizeDaangnAreaText(value, unitText = "") {
  if (value === null || value === undefined) return null;
  const valueText = String(value).trim();
  if (!valueText) return null;
  const numeric = parseDaangnNumeric(valueText);
  if (!Number.isFinite(numeric)) return null;
  const unit = `${valueText} ${unitText}`.toLowerCase();
  if (/(평|py|pyeong|坪|pyung)/.test(unit)) {
    return numeric * 3.305785;
  }
  return numeric;
}

function normalizeImageValue(rawImage) {
  if (typeof rawImage !== "string") return null;
  const withoutAmp = rawImage
    .replace(/&amp;/g, "&")
    .replace(/\u0026/g, "&")
    .trim();
  if (!withoutAmp) return null;
  let candidate = withoutAmp;
  if (/^\/\//.test(candidate)) candidate = `https:${candidate}`;
  if (/^[A-Za-z0-9.-]+\.[A-Za-z0-9.-]+\//.test(candidate)) candidate = `https://${candidate}`;
  if (!/^https?:\/\//i.test(candidate)) return null;
  try {
    const parsed = new URL(candidate);
    if (!isLikelyDaangnImageUrl(candidate)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function isLikelyDaangnImageUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const path = parsed.pathname || "";
    const lowerPath = path.toLowerCase();
    const host = parsed.hostname || "";
    const normalizedPath = lowerPath.replace(/\/+$/, "");
    if (DAANGN_IMAGE_LISTING_PATH_RE.test(normalizedPath)) return false;
    const hasImageExtension = DAANGN_IMAGE_EXT_RE.test(path);
    const hasImageQueryHint = DAANGN_IMAGE_QUERY_HINT_RE.test(`${parsed.search}${parsed.hash || ""}`);
    const hasImagePathHint = DAANGN_IMAGE_PATH_HINT_RE.test(lowerPath);
    const isDaangnHost = DAANGN_IMAGE_URL_HOST_HINTS.some((regex) => regex.test(host));
    if (DAANGN_IMAGE_PATH_BLACKLIST_RE.test(lowerPath)) return false;
    const hasImageSignal = hasImageExtension || hasImageQueryHint || hasImagePathHint;
    if (!hasImageSignal) return false;
    if (!isDaangnHost && !hasImageExtension && !hasImageQueryHint) return false;
    return true;
  } catch {
    return false;
  }
}

function collectDaangnImageUrls(...sources) {
  const out = [];
  const seen = new Set();
  const limit = 12;
  const collectNested = (value) => {
    if (!value || out.length >= limit) return;
    if (typeof value === "string") {
      const normalized = normalizeImageValue(value);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        out.push(normalized);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (out.length >= limit) return;
        collectNested(item);
      }
      return;
    }
    if (typeof value === "object") {
      for (const item of Object.values(value)) {
        if (out.length >= limit) return;
        collectNested(item);
      }
    }
  };

  for (const source of sources) {
    if (out.length >= limit) break;
    if (!source) continue;
    collectNested(source);
  }

  return out;
}

function normalizeNumber(value) {
  const numeric = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeSimpleText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyDaangnSourceRef(value) {
  if (!value) return false;
  if (!/^[0-9A-Za-z._-]+$/.test(value)) return false;
  const lowered = String(value).toLowerCase();
  if (lowered.length < 5) return false;
  if (["realty", "listing", "listingdetail", "profile"].includes(lowered)) return false;
  if (!/[A-Za-z]/.test(value)) return lowered.length >= 7;
  return true;
}

function parseDaangnDirection(raw) {
  const text = normalizeSimpleText(raw);
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
    [/남쪽|남\s*향|남/.test(text), "남향"],
    [/북쪽|북\s*향|북/.test(text), "북향"],
    [/동쪽|동\s*향|동/.test(text), "동향"],
    [/서쪽|서\s*향|서/.test(text), "서향"],
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

function parseDaangnAreaTextValue(raw, defaultClaimed = null) {
  const text = normalizeSimpleText(raw);
  if (!text) return null;

  const normalized = text.toLowerCase();
  const rangeMatch = /(\d+(?:[.,]\d+)?)\s*(?:~|-|〜|～)\s*(\d+(?:[.,]\d+)?)\s*(㎡|m²|m2|제곱미터|평|py|坪|평수)/i.exec(
    normalized,
  );
  if (rangeMatch) {
    const value = parseDaangnNumeric(rangeMatch[1]);
    if (Number.isFinite(value)) {
      const unit = rangeMatch[3].toLowerCase();
      return {
        value: unit.includes("평") ? value * 3.305785 : value,
        claimed: defaultClaimed || "range",
      };
    }
  }

  const singleMatch = /(\d+(?:[.,]\d+)?)\s*(㎡|m²|m2|제곱미터|평|py|坪|평수)/i.exec(normalized);
  if (!singleMatch) return null;

  const value = parseDaangnNumeric(singleMatch[1]);
  if (!Number.isFinite(value)) return null;
  const unit = singleMatch[2].toLowerCase();

  return {
    value: unit.includes("평") ? value * 3.305785 : value,
    claimed: defaultClaimed || "estimated",
  };
}

function parseDaangnAreaFromText(raw) {
  const normalized = normalizeSimpleText(raw || "");
  if (!normalized) return null;
  return parseDaangnAreaTextValue(normalized);
}

function parseDaangnAreaFromFloorSize(floorSize) {
  if (!floorSize) return null;

  if (typeof floorSize === "number" || typeof floorSize === "string") {
    const parsed = parseDaangnAreaTextValue(floorSize);
    if (parsed === null) return null;
    return {
      value: parsed.value,
      claimed: "estimated",
    };
  }

  if (typeof floorSize !== "object") return null;
  const unitFromFloor = [
    floorSize.unit,
    floorSize.unitCode,
    floorSize.unitText,
    floorSize.unit_name,
  ].filter(Boolean).join(" ");

  const candidates = [
    floorSize.value,
    floorSize.size,
    floorSize.area,
    floorSize.sqm,
    floorSize.m2,
  ];

  for (const candidate of candidates) {
    const parsed = parseDaangnAreaTextValue(candidate, unitFromFloor);
    if (parsed && parsed.value > 0) {
      return {
        value: parsed.value,
        claimed: "estimated",
      };
    }
  }

  return null;
}

function normalizeDaangnSourceRef(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  const base = normalized.split("?")[0].split("#")[0];
  if (!base) return null;
  const segment = base.split("/").filter(Boolean).pop();
  if (!segment) return null;

  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();

  const candidates = [segment, decoded];
  for (const rawCandidate of candidates) {
    if (isLikelyDaangnSourceRef(rawCandidate)) return rawCandidate;
    const match = /([0-9A-Za-z]+)$/.exec(rawCandidate);
    if (match?.[1] && isLikelyDaangnSourceRef(match[1])) return match[1];
    const lastDash = rawCandidate.split("-").filter(Boolean).pop();
    if (lastDash && isLikelyDaangnSourceRef(lastDash)) return lastDash;
  }

  return null;
}

function resolveDaangnSourceRef(payload, listData, rawRecord) {
  const candidates = [
    payload?.source_ref,
    payload?.sourceRef,
    payload?.external_id,
    payload?.externalId,
    payload?.id,
    payload?.articleId,
    payload?.article_id,
    payload?.articleNo,
    payload?.listingId,
    payload?.listing_id,
    payload?.sourceUrl,
    payload?.request_url,
    payload?.requestUrl,
    payload?.path,
    payload?.slug,
    payload?.code,
    payload?.identifier,
    payload?.url,
    payload?.href,
    listData?.source_ref,
    rawRecord?.source_ref,
    rawRecord?.sourceRef,
    rawRecord?.source_url,
    rawRecord?.sourceUrl,
    rawRecord?.request_url,
    rawRecord?.payload_json?.source_ref,
    rawRecord?.payload_json?.sourceRef,
    rawRecord?.list_data?.source_ref,
    rawRecord?.list_data?.sourceRef,
  ];

  const normalizedCandidates = [];
  for (const candidate of candidates) {
    const sourceRef = normalizeDaangnSourceRef(candidate);
    if (!sourceRef) continue;
    normalizedCandidates.push(sourceRef);
  }

  const withLetters = normalizedCandidates.find((value) => /[A-Za-z]/.test(value));
  if (withLetters) {
    return withLetters;
  }

  return normalizedCandidates[0] || null;
}

function normalizeDaangnFloorValue(value) {
  const floor = parseDaangnNumeric(value);
  if (!Number.isFinite(floor)) return null;
  if (floor === 0.5 || floor === -0.5) return -1;
  return floor;
}

function parseDaangnFloor(raw, allowLooseNumeric = false) {
  if (raw === null || raw === undefined) return { floor: null, total_floor: null };

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { floor: normalizeDaangnFloorValue(raw), total_floor: null };
  }

  const text = normalizeSimpleText(raw);
  if (!text) return { floor: null, total_floor: null };
  const normalized = text.toLowerCase().replace(/,/g, " ");

  if (/^-?\d+(?:[.,]\d+)?$/.test(normalized)) {
    return {
      floor: normalizeDaangnFloorValue(normalized),
      total_floor: null,
    };
  }

  if (/(반지하|반층|반지층|반)/.test(normalized)) {
    return { floor: -1, total_floor: null };
  }

  const basement = /지하\s*(\d+)?\s*층?/.exec(normalized);
  if (basement) {
    return { floor: -Math.max(1, Number(basement[1] || 1)), total_floor: null };
  }

  const basementShort = /b(\d+)/i.exec(normalized);
  if (basementShort) {
    return { floor: -Math.max(1, Number(basementShort[1] || 1)), total_floor: null };
  }

  const hasFloorHint = /층|지하|반지|옥탑|저층|고층|반/.test(normalized);

  const floorPair = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/.exec(normalized);
  if (floorPair) {
    return {
      floor: normalizeDaangnFloorValue(floorPair[1]),
      total_floor: normalizeDaangnFloorValue(floorPair[2]),
    };
  }

  const totalMatch = /총\s*(\d+(?:[.,]\d+)?)\s*층/.exec(normalized);
  if (totalMatch) {
    return { floor: null, total_floor: normalizeDaangnFloorValue(totalMatch[1]) };
  }

  const floorMatch = /(\d+(?:[.,]\d+)?)\s*층/.exec(normalized);
  if (floorMatch) {
    return { floor: normalizeDaangnFloorValue(floorMatch[1]), total_floor: null };
  }

  if (!hasFloorHint && !allowLooseNumeric) return { floor: null, total_floor: null };

  const numeric = parseDaangnNumeric(normalized);
  return {
    floor: Number.isFinite(numeric) ? normalizeDaangnFloorValue(numeric) : null,
    total_floor: null,
  };
}

export class DaangnListingAdapter extends BaseUserOnlyAdapter {
  constructor(options = {}) {
    super({
      platformCode: "daangn",
      platformName: "당근부동산",
      collectionMode: "STEALTH_AUTOMATION",
      fieldHints: {
        sourceRefKeys: [
          "id",
          "articleId",
          "article_id",
          "articleNo",
          "listingId",
          "source_ref",
          "sourceRef",
          "external_id",
          "externalId",
          "_id",
        ],
        titleKeys: [
          "roomTitle",
          "name",
          "title",
          "headline",
          "subject",
          "articleTitle",
          "article_title",
        ],
        addressKeys: [
          "address.streetAddress",
          "streetAddress",
          "addressText",
          "address_text",
          "street_address",
          "fullAddress",
          "jibunAddress",
          "roadAddress",
          "addr",
          "addrText",
          "list_data.dongName",
        ],
        addressCityKeys: [
          "address.addressRegion",
          "addressRegion",
          "sido",
          "city",
          "province",
        ],
        addressGuKeys: [
          "address.addressLocality",
          "addressLocality",
          "sigungu",
          "gu",
          "district",
          "region",
        ],
        addressDongKeys: [
          "dong",
          "town",
          "neighborhood",
          "address.streetAddress",
          "dongName",
          "list_data.dongName",
        ],
        leaseTypeKeys: [
          "lease_type",
          "leaseType",
          "trade_type",
          "tradeType",
          "type",
          "trade",
          "contract_type",
          "contractType",
        ],
        rentKeys: [
          "rent",
          "monthlyRent",
          "월세",
          "월세금액",
          "_parsed.rent",
        ],
        depositKeys: [
          "deposit",
          "보증금",
          "보증금금액",
          "depositPrice",
          "월세보증금",
          "_parsed.deposit",
        ],
        areaExclusiveKeys: [
          "area",
          "exclusiveArea",
          "roomSize",
          "_parsed.area",
          "areaExclusive",
          "area_exclusive_m2",
        ],
        areaTypeKeys: [
          "areaType",
          "area_claimed",
          "area_type",
        ],
        roomCountKeys: [
          "roomCnt",
          "roomCount",
          "room_cnt",
          "room_cnts",
        ],
        bathroomCountKeys: [
          "bathroomCnt",
          "bathroomCount",
          "bathroom_cnt",
        ],
        imageKeys: [
          "image",
          "image_url",
          "image_urls",
          "images",
          "imgUrlList",
          "img_url",
          "imageUrl",
          "imgUrl",
          "thumb",
          "thumbnail",
          "photo",
          "photoList",
        ],
        rawTextKeys: [
          "name",
          "description",
          "roomTitle",
          "list_data.priceTitle",
          "list_data.roomTitle",
          "subject",
        ],
        sourceUrlKeys: [
          "source_url",
          "url",
          "link",
          "detailUrl",
          "identifier",
        ],
        buildingUseKeys: [
          "propertyType",
          "building_type",
          "buildingType",
          "houseType",
          "house_type",
          "list_data.propertyType",
        ],
        floorKeys: [
          "floor",
          "floorLevel",
          "floor_level",
          "list_data.floor",
          "list_data.floorLevel",
        ],
        totalFloorKeys: [
        "total_floor",
        "totalFloor",
        "topFloor",
        "top_floor",
        "list_data.total_floor",
        "list_data.totalFloor",
        "list_data.topFloor",
        "list_data.top_floor",
        ],
      },
      options,
    });
    this.notes = [
      "당근부동산 수집 raw(payload_json) 정규화",
      "payload 내 id/name/address/images/_parsed 파싱으로 매물 정규형 생성",
    ];
  }

  normalizeFromRawRecord(rawRecord) {
    const payload = rawRecord?.payload_json || rawRecord;
    const listData = rawRecord?.list_data;
    if (!payload || typeof payload !== "object") return [];

    const merged = { ...payload };
    if (listData && typeof listData === "object") {
      for (const [key, value] of Object.entries(listData)) {
        if (merged[key] === undefined || merged[key] === null) {
          merged[key] = value;
        }
      }
      merged.list_data = listData;
    }

    const normalized = this.normalizeListingRow(merged, rawRecord);
    if (!normalized) return [];

    const resolvedSourceRef = resolveDaangnSourceRef(payload, listData, rawRecord);
    if (resolvedSourceRef) {
      normalized.source_ref = resolvedSourceRef;
      normalized.external_id = resolvedSourceRef;
    }
    if (!normalized.source_url) {
      normalized.source_url =
        payload?.identifier
        || payload?.source_url
        || payload?.sourceUrl
        || payload?.url
        || payload?.href
        || payload?.path
        || rawRecord?.source_url
        || rawRecord?.sourceUrl
        || "";
    }

    const processed = this.postProcess(normalized, rawRecord);
    if (!processed) return [];

    const areaClaim = normalizeDaangnAreaClaim(processed.area_claimed);
    processed.area_claimed = areaClaim;

    if (!isDaangnAreaClaimExclusive(processed) || !isDaangnAreaAboveMin(processed)) {
      return [];
    }
    return [processed];
  }

  postProcess(item, rawRecord) {
    const payload = rawRecord?.payload_json || {};
    const listData = rawRecord?.list_data || {};
    const isAreaClaimMissing = () => !item.area_claimed || item.area_claimed === "estimated";

    const parsedRent = normalizeNumber(payload?._parsed?.rent);
    const parsedDeposit = normalizeNumber(payload?._parsed?.deposit);
    if (item.rent_amount === null && parsedRent !== null) {
      item.rent_amount = parsedRent;
    }
    if (item.deposit_amount === null && parsedDeposit !== null) {
      item.deposit_amount = parsedDeposit;
    }

    if (item.area_exclusive_m2 == null && payload?.area !== null && payload?.area !== undefined) {
      const parsedArea = normalizeDaangnAreaValue(payload.area);
      if (parsedArea !== null && parsedArea > 0) {
        item.area_exclusive_m2 = parsedArea;
      }
    }

    if (item.area_exclusive_m2 == null && payload?.areaPyeong !== null && payload?.areaPyeong !== undefined) {
      const parsedFromPyeong = parseDaangnAreaTextValue(payload.areaPyeong, "exclusive");
      if (parsedFromPyeong && parsedFromPyeong.value > 0) {
        item.area_exclusive_m2 = parsedFromPyeong.value;
        if (isAreaClaimMissing()) item.area_claimed = parsedFromPyeong.claimed;
      }
    }

    if (item.area_exclusive_m2 == null && listData?.areaPyeong !== null && listData?.areaPyeong !== undefined) {
      const parsedFromListDataPyeong = parseDaangnAreaTextValue(listData.areaPyeong, "exclusive");
      if (parsedFromListDataPyeong && parsedFromListDataPyeong.value > 0 && item.area_exclusive_m2 == null) {
        item.area_exclusive_m2 = parsedFromListDataPyeong.value;
        if (isAreaClaimMissing()) item.area_claimed = parsedFromListDataPyeong.claimed;
      }
    }

    if (item.area_exclusive_m2 == null && payload?.supplyArea !== null && payload?.supplyArea !== undefined) {
      const parsedFromSupply = parseDaangnAreaTextValue(payload.supplyArea, "gross");
      if (parsedFromSupply) {
        const parsedFromSupplyValue = parsedFromSupply.value;
        if (isValidDaangnArea(parsedFromSupplyValue)) {
          normalizeDaangnGrossArea(item, parsedFromSupplyValue);
        }
      }
    }

    if (item.area_exclusive_m2 == null && payload?.supplyAreaPyeong !== null && payload?.supplyAreaPyeong !== undefined) {
      const parsedFromSupplyPyeong = parseDaangnAreaTextValue(payload.supplyAreaPyeong, "gross");
      if (parsedFromSupplyPyeong) {
        const parsedFromSupplyPyeongValue = parsedFromSupplyPyeong.value;
        if (isValidDaangnArea(parsedFromSupplyPyeongValue)) {
          normalizeDaangnGrossArea(item, parsedFromSupplyPyeongValue);
        }
      }
    }

    if (item.area_exclusive_m2 == null && listData?.supplyArea !== null && listData?.supplyArea !== undefined) {
      const parsedFromListDataSupply = parseDaangnAreaTextValue(listData.supplyArea, "gross");
      if (parsedFromListDataSupply) {
        const parsedFromListDataSupplyValue = parsedFromListDataSupply.value;
        if (isValidDaangnArea(parsedFromListDataSupplyValue)) {
          normalizeDaangnGrossArea(item, parsedFromListDataSupplyValue);
        }
      }
    }

    if (item.area_exclusive_m2 == null && listData?.supplyAreaPyeong !== null && listData?.supplyAreaPyeong !== undefined) {
      const parsedFromListDataSupplyPyeong = parseDaangnAreaTextValue(listData.supplyAreaPyeong, "gross");
      if (parsedFromListDataSupplyPyeong) {
        const parsedFromListDataSupplyPyeongValue = parsedFromListDataSupplyPyeong.value;
        if (isValidDaangnArea(parsedFromListDataSupplyPyeongValue)) {
          normalizeDaangnGrossArea(item, parsedFromListDataSupplyPyeongValue);
        }
      }
    }

    if (item.area_exclusive_m2 == null && payload?._parsed?.area?.value !== null && payload?._parsed?.area?.value !== undefined) {
      const parsedArea = normalizeDaangnAreaValue(payload._parsed.area);
      if (parsedArea !== null && parsedArea > 0) {
        item.area_exclusive_m2 = parsedArea;
      }
    }

    if (item.area_exclusive_m2 == null && payload?.floorSize !== null && payload?.floorSize !== undefined) {
      const parsedFromFloorSize = parseDaangnAreaFromFloorSize(payload.floorSize);
      if (parsedFromFloorSize && parsedFromFloorSize.value > 0) {
        item.area_exclusive_m2 = parsedFromFloorSize.value;
        if (isAreaClaimMissing()) item.area_claimed = parsedFromFloorSize.claimed;
      }
    }

    if (item.area_exclusive_m2 == null && listData?.floorSize !== null && listData?.floorSize !== undefined) {
      const parsedFromListDataFloorSize = parseDaangnAreaFromFloorSize(listData.floorSize);
      if (parsedFromListDataFloorSize && parsedFromListDataFloorSize.value > 0) {
        item.area_exclusive_m2 = parsedFromListDataFloorSize.value;
        if (isAreaClaimMissing()) item.area_claimed = parsedFromListDataFloorSize.claimed;
      }
    }

    if (
      item.area_exclusive_m2 == null
      && typeof payload?.areaText === "string"
    ) {
      const parsedFromText = parseDaangnAreaFromText(payload.areaText);
      if (parsedFromText && parsedFromText.value > 0) {
        item.area_exclusive_m2 = parsedFromText.value;
        if (isAreaClaimMissing()) item.area_claimed = parsedFromText.claimed;
      }
    }
    if (
      item.area_exclusive_m2 == null
      && typeof listData?.areaText === "string"
    ) {
      const parsedFromListDataText = parseDaangnAreaFromText(listData.areaText);
      if (parsedFromListDataText && parsedFromListDataText.value > 0) {
        item.area_exclusive_m2 = parsedFromListDataText.value;
        if (isAreaClaimMissing()) item.area_claimed = parsedFromListDataText.claimed;
      }
    }
    if (
      item.area_exclusive_m2 == null
      && typeof payload?.description === "string"
    ) {
      const parsedFromDescription = parseDaangnAreaFromText(payload.description);
      if (parsedFromDescription && parsedFromDescription.value > 0) {
        item.area_exclusive_m2 = parsedFromDescription.value;
        if (isAreaClaimMissing()) item.area_claimed = parsedFromDescription.claimed;
      }
    }
    if (
      item.area_exclusive_m2 == null
      && typeof listData?.description === "string"
    ) {
      const parsedFromListDescription = parseDaangnAreaFromText(listData.description);
      if (parsedFromListDescription && parsedFromListDescription.value > 0) {
        item.area_exclusive_m2 = parsedFromListDescription.value;
        if (isAreaClaimMissing()) item.area_claimed = parsedFromListDescription.claimed;
      }
    }
    if (isAreaClaimMissing() && payload?._parsed?.area?.claimed) {
      item.area_claimed = payload._parsed.area.claimed;
    }

    if (isAreaClaimMissing() && payload?.areaClaimed) {
      item.area_claimed = payload.areaClaimed;
    }
    if (isAreaClaimMissing() && payload?.areaClaimedType) {
      item.area_claimed = payload.areaClaimedType;
    }
    if (isAreaClaimMissing() && payload?.areaClaimedTypeText) {
      item.area_claimed = payload.areaClaimedTypeText;
    }
    if (isAreaClaimMissing() && payload?.area_claimed) {
      item.area_claimed = payload.area_claimed;
    }

    if (item.area_exclusive_m2 == null && payload?.area_claimed === "gross" && payload?.area_exclusive_m2 !== null && payload?.area_exclusive_m2 !== undefined) {
      const grossAreaFromPayload = normalizeDaangnAreaValue(payload.area_exclusive_m2);
      if (isValidDaangnArea(grossAreaFromPayload)) {
        normalizeDaangnGrossArea(item, grossAreaFromPayload);
      }
    }
    if (item.floor == null && payload?._parsed?.floor !== null && payload?._parsed?.floor !== undefined) {
      item.floor = normalizeDaangnFloorValue(payload._parsed.floor);
    }

    if (item.floor == null) {
      const floorCandidates = [
        payload?.floor,
        payload?.floorLevel,
        payload?.floorText,
        payload?.floorLevelText,
        payload?.floor_text,
        payload?.floor_level,
        payload?._detail?.floor,
        payload?._detail?.floorText,
        payload?._detail?.floorLevelText,
        payload?._detail?.floor_level,
        payload?._detail?.floor_text,
        listData?.floor,
        listData?.floorText,
        listData?.floor_level,
        listData?.floorLevel,
        listData?.floorLevelText,
        listData?.floor_text,
        payload?.description,
        payload?.name,
      ];

      for (const candidate of floorCandidates) {
        if (item.floor != null) break;
        const parsed = parseDaangnFloor(candidate);
        if (parsed.floor != null) {
          item.floor = normalizeDaangnFloorValue(parsed.floor);
        }
      }
    }

    if (item.total_floor == null) {
      const totalFloorCandidates = [
        payload?.total_floor,
        payload?.totalFloor,
        payload?.floor_total,
        payload?.topFloor,
        payload?.top_floor,
        payload?.topFloorText,
        payload?.total_floor_text,
        payload?.total_floor_count,
        payload?.totalFloorCount,
        payload?._detail?.topFloor,
        payload?._detail?.top_floor,
        payload?._detail?.total_floor,
        payload?._detail?.totalFloor,
        payload?._detail?.totalFloorText,
        payload?._detail?.top_floor_text,
        listData?.total_floor,
        listData?.totalFloor,
        listData?.topFloor,
        listData?.top_floor,
        listData?.topFloorText,
        listData?.total_floor_text,
        listData?.total_floor_count,
        listData?.totalFloorCount,
      ];

      for (const candidate of totalFloorCandidates) {
        if (candidate == null) continue;
        if (item.total_floor != null) break;
        const parsed = parseDaangnFloor(candidate);
        if (parsed.total_floor != null && item.total_floor == null) {
          item.total_floor = normalizeDaangnFloorValue(parsed.total_floor);
          continue;
        }
        if (parsed.floor != null && item.total_floor == null) {
          item.total_floor = normalizeDaangnFloorValue(parsed.floor);
        }
      }
    }

    if (item.floor === 0 && /반지하/.test(`${payload?.description || ""}`)) {
      item.floor = -1;
    }

    if (!item.address_text && payload?.address?.streetAddress) {
      item.address_text = payload.address.streetAddress;
    }

    if (!item.title && payload?.name) {
      item.title = payload.name;
    }

    const rawImages = [
      item.image_urls,
      payload.images,
      payload.image,
      payload.image_url,
      payload.imageUrl,
      payload.imageUrlList,
      payload.imgUrl,
      payload.imgUrlList,
      payload.image_urlList,
      payload.image_list,
      payload.imageList,
      payload.imagesUrl,
      payload.imagesURL,
      payload.imgList,
      payload.photo,
      payload.photo_url,
      payload.photoUrl,
      payload.media,
      payload.media?.nodes,
      payload.media?.edges,
      payload.mediaUrl,
      payload.media_url,
      payload.photoList,
      payload.photoList?.nodes,
      payload.photoList?.edges,
      listData.imgUrlList,
      listData.images,
      listData.imageUrl,
      listData.image_url,
      listData.image_urls,
      listData.imageList,
      listData.image_list,
      listData.photo,
      listData.photoList,
      listData.photoList?.nodes,
      listData.photoList?.edges,
      listData.photo_url,
      listData.media,
      listData.media?.nodes,
      listData.media?.edges,
      listData.media_url,
      listData.imagesUrl,
      listData.imagesURL,
      listData?.images,
      payload._detail?.images,
      payload._parsed,
    ];
    const normalizedImageUrls = collectDaangnImageUrls(...rawImages);
    if (normalizedImageUrls.length > 0) {
      item.image_urls = normalizedImageUrls;
    }

    if (!item.building_use && payload?.propertyType) {
      item.building_use = payload.propertyType;
    }

    if (item.direction == null || !normalizeSimpleText(item.direction)) {
      const direction = parseDaangnDirection(
        `${payload?.buildingOrientation || ""} ${payload?.building_orientation || ""} ${payload?.direction || ""} ${payload?.directionText || ""} ${payload?.orientation || ""} ${payload?.facing || ""} ${payload?.facingDirection || ""} ${payload?.house_facing || ""} ${payload?.houseFacing || ""} ${payload?.direction_desc || ""} ${payload?._parsed?.direction || ""} ${payload?.description || ""} ${payload?.name || ""} ${listData?.direction || ""} ${listData?.directionText || ""} ${listData?.direction_desc || ""} ${listData?.roomTitle || ""} ${listData?.floorText || ""} ${listData?.floor_text || ""} ${listData?.buildingOrientation || ""}`,
      );
      if (direction) {
        item.direction = direction;
      }
    }

    if (!item.source_url && payload?.identifier) {
      item.source_url = payload.identifier;
    }

    return item;
  }
}
