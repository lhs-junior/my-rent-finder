#!/usr/bin/env node

import { BaseListingAdapter, ADAPTER_VALIDATION_CODES } from "./base_listing_adapter.mjs";

const DEFAULT_FIELD_HINTS = {
  sourceRefKeys: [
    "id",
    "article_id",
    "articleId",
    "articleNo",
    "listingId",
    "propertyId",
    "itemId",
    "_id",
  ],
  titleKeys: [
    "title",
    "name",
    "name_kor",
    "subject",
    "headline",
    "summary",
    "roomTitle",
    "article_title",
  ],
  addressKeys: [
    "address",
    "address_text",
    "addressText",
    "address_raw",
    "addr",
    "addr_text",
    "addrText",
    "address_detail",
    "road_address",
    "roadAddress",
    "jibun_address",
    "jibunAddress",
    "full_addr",
    "fullAddress",
    "property_address",
  ],
  addressCityKeys: [
    "sido",
    "sidoNm",
    "city",
    "city_name",
    "province",
  ],
  addressGuKeys: [
    "sigungu",
    "gu",
    "district",
    "borough",
    "region_name",
    "region",
  ],
  addressDongKeys: [
    "dong",
    "town",
    "neighborhood",
    "읍면동",
  ],
  leaseTypeKeys: [
    "lease_type",
    "leaseType",
    "trade_type",
    "tradeType",
    "type",
    "listing_type",
  ],
  rentKeys: [
    "rent",
    "monthly_rent",
    "monthlyRent",
    "월세",
    "rentPrice",
    "월세금액",
  ],
  depositKeys: [
    "deposit",
    "보증금",
    "depositPrice",
    "deposit_price",
    "보증금금액",
  ],
  areaExclusiveKeys: [
    "area_exclusive_m2",
    "areaExclusive",
    "areaExclusiveM2",
    "exclusive_area",
    "exclusiveArea",
    "exclusiveAreaM2",
    "전용면적",
    "spc1",
  ],
  areaGrossKeys: [
    "area_gross_m2",
    "areaGross",
    "areaGrossM2",
    "gross_area",
    "grossArea",
    "grossAreaM2",
    "supplyArea",
    "spc2",
  ],
  areaTypeKeys: [
    "area_type",
    "areaType",
    "area_claimed",
    "area_claimed_type",
  ],
  roomCountKeys: [
    "room_count",
    "roomCount",
    "roomCnt",
    "rooms",
    "room",
    "room_type",
  ],
  bathroomCountKeys: [
    "bathroom_count",
    "bathroomCount",
    "bathroom",
  ],
  floorKeys: [
    "floor",
    "floorInfo",
    "floor_text",
    "floorText",
    "current_floor",
    "currentFloor",
  ],
  totalFloorKeys: [
    "total_floor",
    "totalFloor",
    "floors",
    "floors_total",
    "totalFloorCount",
  ],
  directionKeys: [
    "direction",
    "direction_text",
    "facing",
    "facing_text",
    "house_facing",
    "houseFacing",
  ],
  buildingUseKeys: [
    "building_use",
    "buildingUse",
    "building_use_text",
    "house_type",
    "houseType",
    "houseTypeNm",
    "building_type",
    "buildingType",
    "buildingTypeNm",
  ],
  sourceUrlKeys: [
    "source_url",
    "sourceUrl",
    "url",
    "link",
    "detail_url",
    "detailUrl",
    "articleUrl",
    "article_url",
    "href",
  ],
  imageKeys: [
    "images",
    "image",
    "imageList",
    "image_list",
    "img",
    "imgList",
    "img_list",
    "thumb",
    "thumbnail",
    "photo",
    "photoList",
    "photo_list",
    "imageUrl",
    "image_url",
    "imgUrl",
    "img_url",
  ],
  rawTextKeys: [
    "text",
    "desc",
    "description",
    "description_text",
    "comment",
    "detail",
    "detailText",
    "detail_text",
    "raw_text",
    "content",
    "roomDesc",
    "room_desc",
    "memo",
    "memo_text",
    "summary",
    "info",
  ],
  listHintPaths: [
    "items",
    "itemList",
    "list",
    "lists",
    "data",
    "result",
    "results",
    "payload",
    "payload_json",
    "response",
    "body",
    "article_list",
    "articles",
    "articleList",
    "complexes",
    "complexList",
    "houses",
    "housesList",
    "property_list",
    "properties",
  ],
};

function normalizeText(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getByPath(v, path) {
  if (v === null || v === undefined) return undefined;
  if (!path.includes(".")) return v[path];
  return path.split(".").reduce((acc, key) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, key)) return acc[key];
    return undefined;
  }, v);
}

function pick(v, keys, fallback = null) {
  if (!v || !Array.isArray(keys)) return fallback;
  for (const key of keys) {
    const value = getByPath(v, key);
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !normalizeText(value)) continue;
    return value;
  }
  return fallback;
}

function hash11(v) {
  const base = normalizeText(v).replace(/\s+/g, "");
  if (!base) return null;
  let acc = 2166136261 >>> 0;
  for (let i = 0; i < base.length; i += 1) {
    acc ^= base.charCodeAt(i);
    acc = Math.imul(acc, 16777619);
  }
  return `11${String((acc >>> 0) % 900000000).padStart(9, "0")}`;
}

function parseMoney(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const s = normalizeText(value)
    .replace(/,/g, "")
    .toLowerCase();
  if (!s || /협의|문의|contact|상담|추가요청/.test(s)) return null;

  const toNum = (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const m = /^([0-9]+(?:\.[0-9]+)?)\s*억\s*([0-9]+(?:\.[0-9]+)?)?\s*천?/.exec(s);
  if (m) {
    const base = toNum(m[1]);
    const bonus = m[2] ? toNum(m[2]) : 0;
    return base !== null && bonus !== null ? base * 10000 + bonus : null;
  }

  const mThousand = /^([0-9]+(?:\.[0-9]+)?)\s*천만(?:원)?$/.exec(s);
  if (mThousand) return toNum(mThousand[1]);

  const mMan = /^([0-9]+(?:\.[0-9]+)?)\s*만(?:원)?$/.exec(s);
  if (mMan) return toNum(mMan[1]);

  const fallback = /([0-9]+(?:\.[0-9]+)?)/.exec(s);
  return fallback ? toNum(fallback[1]) : null;
}

function normalizeMoneyPairOrder(pair, rawText, options = {}) {
  if (!pair) return { rent: null, deposit: null };

  const { preferDepositFirst = false } = options;
  const s = normalizeText(rawText).toLowerCase();

  if (pair.rent == null && pair.deposit == null) return pair;

  const hasRentHint = (part) => /(월세|월세료|월\s*세)/.test(part);
  const hasDepositHint = (part) => /(보증금|전세|전세금)/.test(part);

  const resolveDirection = (left, right) => {
    const leftHasRent = hasRentHint(left);
    const rightHasRent = hasRentHint(right);
    const leftHasDeposit = hasDepositHint(left);
    const rightHasDeposit = hasDepositHint(right);

    if (leftHasDeposit && rightHasRent && !leftHasRent && !rightHasDeposit) return true;
    if (leftHasRent && rightHasDeposit && !leftHasDeposit && !rightHasRent) return false;
    if (leftHasDeposit && !rightHasDeposit && !rightHasRent) return true;
    if (leftHasRent && !rightHasRent && !rightHasDeposit) return false;
    if (rightHasDeposit && !leftHasDeposit && !leftHasRent && !rightHasRent) return false;
    if (rightHasRent && !leftHasRent && !leftHasDeposit && !rightHasDeposit) return false;
    return null;
  };

  const flipPair = () => ({
    rent: pair.deposit,
    deposit: pair.rent,
  });

  const slashSep = s.indexOf("/");
  if (slashSep >= 0) {
    const left = s.slice(0, slashSep);
    const right = s.slice(slashSep + 1);
    const direction = resolveDirection(left, right);
    if (direction === true) return flipPair();
    if (direction === false) return pair;
  }

  const barSep = s.indexOf("|");
  if (barSep >= 0) {
    const left = s.slice(0, barSep);
    const right = s.slice(barSep + 1);
    const direction = resolveDirection(left, right);
    if (direction === true) return flipPair();
    if (direction === false) return pair;
  }

  const hasAnyHint = hasRentHint(s) || hasDepositHint(s);

  if (preferDepositFirst && !hasAnyHint) {
    return flipPair();
  }

  return pair;
}

function hasMoneyDirectionHint(text) {
  return /(월세|보증금|전세|rent|deposit|lease|임대료|월세료|전세금|보증금금액|rent_fee|deposit_fee)/i.test(
    text,
  );
}

function hasRentDirectionHint(text) {
  return /(월세|월세료|월\s*세|rent|rent_fee|monthly)/i.test(text);
}

function hasDepositDirectionHint(text) {
  return /(보증금|전세|전세금|deposit|deposit_fee|보증금금액)/i.test(text);
}

export function parseMoneyPair(rawText, options = {}) {
  const s = normalizeText(rawText).toLowerCase();
  if (!s) return { rent: null, deposit: null };
  const hasDirectionHint = hasMoneyDirectionHint(s);
  const hasDepositHint = hasDepositDirectionHint(s);
  const hasRentHint = hasRentDirectionHint(s);

  const splitPair = (input, sep = "/") => {
    const idx = input.indexOf(sep);
    if (idx < 0) return null;
    const left = parseMoney(input.slice(0, idx));
    const right = parseMoney(input.slice(idx + 1));
    return { rent: left, deposit: right };
  };

  const pipe = splitPair(s, "/");
  if (pipe && (pipe.rent !== null || pipe.deposit !== null)) {
    return normalizeMoneyPairOrder(pipe, s, options);
  }

  const bar = splitPair(s, "|");
  if (bar && (bar.rent !== null || bar.deposit !== null)) {
    return normalizeMoneyPairOrder(bar, s, options);
  }

  const rentMatch = /(월세|월\s*세)\s*[:\s]*\s*([0-9.,억천만만원원\s]+)/i.exec(s);
  const rentSuffixMatch = /([0-9.,억천만만원원\s]+)\s*(?:월세|월\s*세)(?![가-힣])/i.exec(s);
  const depositMatch = /(보증금|전세|전세금)\s*[:\s]*\s*([0-9.,억천만만원원\s]+)/i.exec(s);
  const depositSuffixMatch = /([0-9.,억천만만원원\s]+)\s*(?:보증금|전세|전세금)(?![가-힣])/i.exec(s);

  let rent = rentMatch ? parseMoney(rentMatch[2]) : null;
  let deposit = depositMatch ? parseMoney(depositMatch[2]) : null;
  if (rent === null && rentSuffixMatch && rentSuffixMatch[1]) {
    rent = parseMoney(rentSuffixMatch[1]);
  }
  if (deposit === null && depositSuffixMatch && depositSuffixMatch[1]) {
    deposit = parseMoney(depositSuffixMatch[1]);
  }
  if (rent !== null || deposit !== null) {
    return normalizeMoneyPairOrder({ rent, deposit }, s, options);
  }

  if (hasDirectionHint && !rentMatch && !depositMatch) {
    return normalizeMoneyPairOrder({ rent: null, deposit: null }, s, options);
  }

  const nums = s.match(/([0-9]+(?:\.[0-9]+)?(?:\s*억)?(?:\s*천만)?(?:\s*만)?|[0-9]+(?:\.[0-9]+)?\s*만원)/g);
  if (!nums || nums.length === 0) {
    return normalizeMoneyPairOrder({ rent: null, deposit: null }, s, options);
  }

  if (nums.length < 2) {
    if (!hasDirectionHint) {
      return normalizeMoneyPairOrder({ rent: null, deposit: null }, s, options);
    }
    if (hasDepositHint && !hasRentHint) {
      return normalizeMoneyPairOrder(
        { rent: null, deposit: parseMoney(nums[0]) },
        s,
        options,
      );
    }
    return normalizeMoneyPairOrder(
      { rent: parseMoney(nums[0]), deposit: null },
      s,
      options,
    );
  }

  if (!hasDirectionHint) return normalizeMoneyPairOrder({ rent: null, deposit: null }, s, options);

  return normalizeMoneyPairOrder(
    { rent: parseMoney(nums[0]), deposit: parseMoney(nums[1]) },
    s,
    options,
  );
}

function looksLikeMoneyText(rawText) {
  const s = normalizeText(rawText).toLowerCase();
  if (!s) return false;
  return /\/|\||월세|보증금|전세|만원|천만|억/.test(s);
}

function normalizeMoneyPairDirection(rawText, rentAmount, depositAmount, options = {}) {
  const { preferDepositFirst = false } = options;
  if (rentAmount == null || depositAmount == null) {
    return {
      rent: rentAmount,
      deposit: depositAmount,
    };
  }

  const normalized = parseMoneyPair(`${normalizeText(rawText || `${rentAmount}/${depositAmount}`)}`, {
    preferDepositFirst,
  });

  // Text-parsed values match structured fields in same order — no swap needed
  if (normalized.rent === rentAmount && normalized.deposit === depositAmount) {
    return normalized;
  }

  // Text-parsed values match structured fields but swapped — apply the swap
  if (normalized.rent === depositAmount && normalized.deposit === rentAmount) {
    return normalized;
  }

  // Text-parsed values differ from structured fields — trust structured data
  return { rent: rentAmount, deposit: depositAmount };
}

function platformIsMoneyOrdered(platformCode) {
  const platform = String(platformCode || "").toLowerCase();
  return platform === "dabang" || platform === "daangn";
}

function parseArea(value) {
  if (value === null || value === undefined) {
    return {
      value: null,
      min: null,
      max: null,
      unit: "sqm",
      areaType: "estimated",
    };
  }
  if (typeof value === "number") {
    const n = Number.isFinite(value) ? value : null;
    return {
      value: n,
      min: n,
      max: n,
      unit: "sqm",
      areaType: "estimated",
    };
  }

  const s = normalizeText(value)
    .replace(/,/g, "")
    .replace(/㎡|제곱미터|m\s*\^\s*2|㎡/gi, "sqm")
    .replace(/平|평/gi, "py");
  if (!s) {
    return {
      value: null,
      min: null,
      max: null,
      unit: "sqm",
      areaType: "estimated",
    };
  }

  const toM2 = (n, unit) => {
    const v = Number.parseFloat(String(n).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(v)) return null;
    return unit === "py" ? v * 3.305785 : v;
  };

  const range = /(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)\s*(sqm|py)/i.exec(s);
  if (range) {
    const mn = toM2(range[1], range[3]);
    const mx = toM2(range[2], range[3]);
    if (mn !== null && mx !== null) {
      return {
        value: mn,
        min: mn,
        max: mx,
        unit: "sqm",
        areaType: "range",
      };
    }
  }

  const single = /(\d+(?:\.\d+)?)\s*(sqm|py)/i.exec(s);
  const unit = single?.[2]?.toLowerCase() || "sqm";
  const n = single ? toM2(single[1], unit) : null;
  if (n !== null) {
    return {
      value: n,
      min: n,
      max: n,
      unit: "sqm",
      areaType: "estimated",
    };
  }

  const fallback = /(\d+(?:\.\d+)?)/.exec(s);
  const f = fallback ? toM2(fallback[1], "sqm") : null;
  if (f !== null && (f < 1 || f > 1000)) {
    return {
      value: null,
      min: null,
      max: null,
      unit: "sqm",
      areaType: "estimated",
    };
  }
  return {
    value: f,
    min: f,
    max: f,
    unit: "sqm",
    areaType: "estimated",
  };
}

function parseFloor(raw) {
  if (raw === null || raw === undefined) return { floor: null, total_floor: null };
  if (typeof raw === "number") return { floor: Number.isFinite(raw) ? raw : null, total_floor: null };
  const s = normalizeText(raw);
  if (!s) return { floor: null, total_floor: null };

  const pair = /(\d{1,3})\s*\/\s*(\d{1,3})\s*층?/.exec(s);
  if (pair) return { floor: Number(pair[1]), total_floor: Number(pair[2]) };

  const pairWithLabels = /(\d+)\s*층\s*\/\s*(\d+)\s*층/.exec(s);
  if (pairWithLabels) return { floor: Number(pairWithLabels[1]), total_floor: Number(pairWithLabels[2]) };

  const halfBasement = /(반지하|반|반층|반지층)/.exec(s);
  if (halfBasement) return { floor: -1, total_floor: null };

  const basement = /(지하)\s*(\d+)?\s*층?/.exec(s);
  if (basement) {
    const level = Number(basement[2] || 1);
    return { floor: -Math.max(1, level), total_floor: null };
  }

  const b2 = /b(\d+)/i.exec(s);
  if (b2) return { floor: -Math.max(1, Number(b2[1] || 1)), total_floor: null };

  if (/(옥탑|옥상|최상층|고층|저층)/.test(s)) {
    return { floor: null, total_floor: null };
  }

  const floor = /총\s*(\d+)\s*층/.exec(s);
  if (floor) {
    return {
      floor: null,
      total_floor: Number(floor[1]),
    };
  }

  const floorRange = /(\d+)\s*[-~]\s*(\d+)\s*층/.exec(s);
  if (floorRange) {
    return { floor: Number(floorRange[1]), total_floor: Number(floorRange[2]) };
  }

  const floorValue = /(\d+)(?:\.\d+)?\s*층/.exec(s);
  if (floorValue) {
    return {
      floor: Number.parseFloat(floorValue[1]),
      total_floor: null,
    };
  }

  return {
    floor: null,
    total_floor: null,
  };
}

function parseDirectionFallback(value) {
  const s = normalizeText(value);
  if (!s) return null;

  const directionRules = [
    [/남서향|남서|남서쪽/.test(s), "남서향"],
    [/남동향|남동|남동쪽/.test(s), "남동향"],
    [/북서향|북서|북서쪽/.test(s), "북서향"],
    [/북동향|북동|북동쪽/.test(s), "북동향"],
    [/남향|남쪽/.test(s), "남향"],
    [/북향|북쪽/.test(s), "북향"],
    [/동향|동쪽/.test(s), "동향"],
    [/서향|서쪽/.test(s), "서향"],
  ];

  for (const [condition, label] of directionRules) {
    if (condition) return label;
  }

  return s;
}

function parseBuildingUseFallback(value) {
  const s = normalizeText(value);
  if (!s) return null;

  if (/(오피스텔)/.test(s)) return "오피스텔";
  if (/(단독|다가구|다세대|다가지구|주택)/.test(s)) return "단독/다가구";
  if (/(연립|빌라)/.test(s)) return "빌라/연립";

  if (/(원룸|투룸|쓰리룸|오픈형|오피스텔)/.test(s)) return s;
  return s;
}

function parseRoom(raw) {
  const s = normalizeText(raw);
  if (!s) return null;
  if (/원룸/.test(s)) return 1;
  if (/투룸/.test(s)) return 2;
  if (/쓰리룸|3룸/.test(s)) return 3;
  const m = /([1-9])\s*룸/.exec(s);
  return m ? Number(m[1]) : null;
}

function normalizeLeaseType(raw, fallback) {
  const s = normalizeText(`${raw} ${fallback}`).toLowerCase();
  if (/(매매|매입|buy|sale)/.test(s)) return "매매";
  if (/(전세|전입|jeonse)/.test(s)) return "전세";
  return "월세";
}

function normalizeAddress(item, hints) {
  const direct = pick(item, hints.addressKeys, null);
  if (direct) return normalizeText(direct);

  const city = pick(item, hints.addressCityKeys, "");
  const gu = pick(item, hints.addressGuKeys, "");
  const dong = pick(item, hints.addressDongKeys, "");
  const extra = [city, gu, dong].map(normalizeText).filter(Boolean).join(" ");
  return extra || "";
}

function collectImageUrls(node, options = {}) {
  const limit = Number.isFinite(Number(options.imageLimit)) ? Math.max(1, Math.min(24, Number(options.imageLimit))) : 12;
  const candidateKeys = new Set(options.imageKeys || []);
  const out = [];
  const seen = new Set();
  const seenNodes = new WeakSet();

  const add = (value) => {
    if (typeof value !== "string") return;
    const raw = value.replace(/&amp;/g, "&");
    const s = normalizeText(raw);
    if (!s) return;
    let candidate = s;
    if (/^\/\//.test(candidate)) candidate = `https:${candidate}`;
    try {
      const parsed = new URL(candidate);
      const path = parsed.pathname.toLowerCase();
      if (!/(\\.jpg|\\.jpeg|\\.png|\\.webp|\\.gif|\\.avif|\\.bmp|\\.svg)(\\?|$)/.test(path)) return;
      if (out.length >= limit) return;
      if (seen.has(candidate)) return;
      seen.add(candidate);
      out.push(candidate);
    } catch {
      // no-op
    }
  };

  const walk = (value, depth = 0) => {
    if (!value || out.length >= limit) return;
    if (depth > 8) return;
    if (typeof value === "string") {
      add(value);
      return;
    }
    if (!isObject(value) && !Array.isArray(value)) return;
    if (isObject(value) && seenNodes.has(value)) return;
    if (isObject(value)) seenNodes.add(value);

    for (const key of Object.keys(value)) {
      if (out.length >= limit) return;
      const child = value[key];
      if (typeof key === "string" && candidateKeys.has(key) && child !== undefined) {
        walk(child, depth + 1);
      }
    }

    for (const child of Object.values(value)) {
      if (out.length >= limit) return;
      walk(child, depth + 1);
    }
  };

  walk(node);
  return out;
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isAccessBlocked(payload) {
  const blockedSource = pick(payload, [
    "message",
    "errorMessage",
    "messageKo",
    "msg",
    "description",
    "reason",
    "detail",
    "statusText",
    "error",
    "errorMessageKo",
    "status",
    "code",
  ]);
  if (!blockedSource) return false;
  const s = normalizeText(blockedSource).toLowerCase();
  const keywords = [
    "차단",
    "blocked",
    "forbidden",
    "403",
    "401",
    "429",
    "login",
    "로그인",
    "로봇",
    "rate limit",
    "접근",
    "권한",
    "denied",
  ];
  return keywords.some((k) => s.includes(k));
}

function isListingLike(value, hints) {
  if (!isObject(value)) return false;
  const keys = [
    ...hints.titleKeys,
    ...hints.addressKeys,
    ...hints.sourceRefKeys,
    ...hints.leaseTypeKeys,
    ...hints.rentKeys,
    ...hints.depositKeys,
    ...hints.areaExclusiveKeys,
    ...hints.areaGrossKeys,
    ...hints.roomCountKeys,
    ...hints.floorKeys,
  ];

  return keys.some((k) => Object.prototype.hasOwnProperty.call(value, k));
}

function pickStringFromRecord(record) {
  const value = String(record || "").trim();
  return value;
}

function resolveRecordSourceRef(rawRecord) {
  if (!rawRecord || typeof rawRecord !== "object") return null;

  const candidates = [
    rawRecord?.source_ref,
    rawRecord?.sourceRef,
    rawRecord?.source_url,
    rawRecord?.request_url,
    rawRecord?.url,
    rawRecord?.link,
    rawRecord?.identifier,
    rawRecord?.id,
    rawRecord?.external_id,
    rawRecord?.externalId,
    rawRecord?.payload_json?.source_ref,
    rawRecord?.payload_json?.sourceRef,
    rawRecord?.payload_json?.id,
    rawRecord?.payload_json?.external_id,
    rawRecord?.payload_json?.externalId,
    rawRecord?.payload_json?._id,
    rawRecord?.list_data?.source_ref,
    rawRecord?.list_data?.sourceRef,
    rawRecord?.list_data?.id,
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    if (typeof candidate === "object") continue;
    const text = pickStringFromRecord(candidate);
    if (text) return text;
  }

  return null;
}

function computeNormalizedListingScore(item) {
  const hasValue = (v) => v !== null && v !== undefined && String(v).trim() !== "";
  let score = 0;
  if (hasValue(item?.address_text)) score += 2;
  if (item?.rent_amount !== null && item?.rent_amount !== undefined) score += 3;
  if (item?.deposit_amount !== null && item?.deposit_amount !== undefined) score += 3;
  if (item?.area_exclusive_m2 !== null && item?.area_exclusive_m2 !== undefined) score += 2;
  if (item?.area_gross_m2 !== null && item?.area_gross_m2 !== undefined) score += 1;
  if (Array.isArray(item?.image_urls) && item.image_urls.length > 0) score += 5;
  if (item?.floor !== null && item?.floor !== undefined) score += 1;
  return score;
}

function collectCandidates(payload, hints, visited = new WeakSet(), options = {}) {
  const maxDepth = options.maxDepth || 8;
  const maxNodes = options.maxNodes || 9000;
  const state = options._state || { used: 0 };
  options._state = state;

  const out = [];
  if (payload === null || payload === undefined) return out;
  if (state.used >= maxNodes) return out;
  state.used += 1;

  if (Array.isArray(payload)) {
    if (payload.length === 0) return out;
    if (isListingLike(payload[0], hints)) return payload;

    const maybe = payload.filter((item) => isListingLike(item, hints));
    if (maybe.length >= Math.max(1, payload.length * 0.35)) return maybe;

    for (const item of payload) {
      if (state.used >= maxNodes) break;
      out.push(...collectCandidates(item, hints, visited, options));
    }
    return out;
  }

  if (!isObject(payload) || visited.has(payload) || state.used >= maxNodes) {
    return out;
  }
  visited.add(payload);

  if (isListingLike(payload, hints)) out.push(payload);

  for (const key of hints.listHintPaths) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    out.push(...collectCandidates(payload[key], hints, visited, options));
  }

  for (const value of Object.values(payload)) {
    if (state.used >= maxNodes) break;
    out.push(...collectCandidates(value, hints, visited, options));
  }

  return out;
}

function normalizeForDedupe(item) {
  if (!item || typeof item !== "object") return null;
  const sourceRef = item.source_ref != null ? String(item.source_ref).trim() : "";
  if (sourceRef) return `src:${sourceRef}`;

  return `fb:${String(item.address_text || "")}|${String(item.address_code || "")}|${String(
    item.rent_amount ?? "",
  )}|${String(item.deposit_amount ?? "")}|${String(
    item.area_exclusive_m2 ?? item.area_gross_m2 ?? "",
  )}`;
}

function dedupeNormalizedItems(items) {
  const dedupeMap = new Map();

  for (const item of items) {
    const key = normalizeForDedupe(item);
    if (!key) continue;

    const score = computeNormalizedListingScore(item);
    const current = dedupeMap.get(key);
    if (!current || score > current.score) {
      dedupeMap.set(key, { item, score });
    }
  }

  return [...dedupeMap.values()].map((entry) => entry.item);
}

function recalcSimpleRate(items, predicate) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  return items.filter(predicate).length / items.length;
}

function isNonEmptyText(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  const num = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

function buildNormalizedStats(items) {
  return {
    requiredFieldsRate: recalcSimpleRate(
      items,
      (item) => isNonEmptyText(item.address_text)
        && (toNumberOrNull(item.rent_amount) !== null || toNumberOrNull(item.deposit_amount) !== null)
        && (toNumberOrNull(item.area_exclusive_m2) !== null || toNumberOrNull(item.area_gross_m2) !== null),
    ),
    addressRate: recalcSimpleRate(items, (item) => isNonEmptyText(item.address_text)),
    imageRate: recalcSimpleRate(
      items,
      (item) => Array.isArray(item.image_urls)
        && item.image_urls.length > 0,
    ),
    imagePresenceRate: recalcSimpleRate(
      items,
      (item) => Array.isArray(item.image_urls)
        && item.image_urls.length > 0,
    ),
    priceRate: recalcSimpleRate(
      items,
      (item) => toNumberOrNull(item.rent_amount) !== null || toNumberOrNull(item.deposit_amount) !== null,
    ),
    areaRate: recalcSimpleRate(
      items,
      (item) => toNumberOrNull(item.area_exclusive_m2) !== null || toNumberOrNull(item.area_gross_m2) !== null,
    ),
  };
}

export class BaseUserOnlyAdapter extends BaseListingAdapter {
  constructor({
    platformCode,
    platformName,
    collectionMode = "STEALTH_AUTOMATION",
    fieldHints = {},
    options = {},
  } = {}) {
    super({ platformCode, platformName, collectionMode, options });
    this.readinessHint = "READY";
    this.hints = {
      ...DEFAULT_FIELD_HINTS,
      ...fieldHints,
      listHintPaths: [...DEFAULT_FIELD_HINTS.listHintPaths, ...(fieldHints.listHintPaths || [])],
    };
  }

  async normalizeFromRawFile(inputPath, { maxItems = Infinity, includeRaw = true } = {}) {
    const rawResult = await super.normalizeFromRawFile(inputPath, {
      maxItems: Infinity,
      includeRaw,
    });

    const deduped = dedupeNormalizedItems(rawResult.items);
    const normalized = deduped.slice(0, Number.isFinite(maxItems) ? Math.max(0, Math.floor(maxItems)) : Infinity);
    const recomputedStats = buildNormalizedStats(normalized);

    rawResult.items = normalized;
    rawResult.stats = {
      ...rawResult.stats,
      normalizedItems: normalized.length,
      requiredFieldsRate: recomputedStats.requiredFieldsRate,
      addressRate: recomputedStats.addressRate,
      imageRate: recomputedStats.imageRate,
      imagePresenceRate: recomputedStats.imagePresenceRate,
      priceRate: recomputedStats.priceRate,
      areaRate: recomputedStats.areaRate,
    };
    rawResult.metadata.normalized_records = normalized.length;

    return rawResult;
  }

  normalizeFromRawRecord(rawRecord) {
    const rawRecordSourceRef = resolveRecordSourceRef(rawRecord);

    const payload =
      rawRecord?.payload_json ??
      rawRecord?.payload ??
      rawRecord?._payload ??
      rawRecord?.payloadData ??
      rawRecord?.data ??
      rawRecord?.body ??
      rawRecord ??
      {};

    if (payload && isAccessBlocked(payload)) {
      const err = new Error(ADAPTER_VALIDATION_CODES.SOURCE_ACCESS_BLOCKED);
      err.code = ADAPTER_VALIDATION_CODES.SOURCE_ACCESS_BLOCKED;
      throw err;
    }

    const rows = collectCandidates(payload, this.hints, new WeakSet(), {
      maxDepth: 12,
      maxNodes: 12000,
    });
    const seen = new Map();

    for (const row of rows) {
      if (!isObject(row)) continue;

      const normalized = this.normalizeListingRow(row, rawRecord);
      if (!normalized) continue;

      if (!normalized.source_ref && rawRecordSourceRef) {
        normalized.source_ref = rawRecordSourceRef;
        normalized.external_id = rawRecordSourceRef;
      }

      const dedupeKey = normalized.source_ref || hash11(
        `${normalized.address_text || ""}|${normalized.address_code || ""}|${normalized.rent_amount || ""}|${normalized.deposit_amount || ""}|${normalized.area_exclusive_m2 || normalized.area_gross_m2 || ""}`,
      );
      if (!dedupeKey) continue;

      const nextScore = computeNormalizedListingScore(normalized);
      const current = seen.get(dedupeKey);
      if (!current || nextScore > current.score) {
        seen.set(dedupeKey, { score: nextScore, item: normalized });
      }
    }

    const out = Array.from(seen.values()).map((entry) => entry.item);

    return out;
  }

  normalizeListingRow(row, rawRecord) {
    const sourceRefRaw = pick(row, this.hints.sourceRefKeys, null);
    const sourceRef = sourceRefRaw ? String(sourceRefRaw) : null;

    const rawSourceUrl = pick(row, this.hints.sourceUrlKeys, null);
    const rawSourceBase = rawRecord?.source_url || rawRecord?.request_url || rawRecord?.url || "";
    const sourceUrl = resolveUserOnlySourceUrl({
      platformCode: this.platformCode,
      sourceRef,
      rawSourceUrl,
      rawSourceBase,
    }) || rawSourceBase;

    const addressText = normalizeAddress(row, this.hints);
    const addressCode = hash11(addressText);
    const leaseType = normalizeLeaseType(
      pick(row, this.hints.leaseTypeKeys, null),
      pick(row, this.hints.listingTypeKeys || [], null),
    );

    const exclusive = parseArea(pick(row, this.hints.areaExclusiveKeys, null));
    const gross = parseArea(pick(row, this.hints.areaGrossKeys, null));

    let areaClaimed = pick(row, this.hints.areaTypeKeys, null);
    if (!areaClaimed) {
      if (exclusive.value !== null) areaClaimed = "exclusive";
      else if (gross.value !== null) areaClaimed = "gross";
      else areaClaimed = "estimated";
    }

    let rentAmount = parseMoney(pick(row, this.hints.rentKeys, null));
    let depositAmount = parseMoney(pick(row, this.hints.depositKeys, null));
    const textForPrice = pick(row, this.hints.rawTextKeys, null);

    if ((rentAmount === null || depositAmount === null) && looksLikeMoneyText(textForPrice)) {
      const pair = parseMoneyPair(`${textForPrice || ""}`, {
        preferDepositFirst: ["dabang", "daangn"].includes(String(this.platformCode || "").toLowerCase()),
      });
      if (rentAmount === null) rentAmount = pair.rent;
      if (depositAmount === null) depositAmount = pair.deposit;
    }

    if (platformIsMoneyOrdered(this.platformCode) && rentAmount !== null && depositAmount !== null) {
      const ordered = normalizeMoneyPairDirection(
        `${textForPrice || `${rentAmount}/${depositAmount}`}`,
        rentAmount,
        depositAmount,
        { preferDepositFirst: true },
      );
      rentAmount = ordered.rent;
      depositAmount = ordered.deposit;
    }

    const floorData = parseFloor(pick(row, this.hints.floorKeys, pick(row, this.hints.totalFloorKeys, null)));
    const totalFloor = floorData.total_floor || parseFloor(pick(row, this.hints.totalFloorKeys, null)).total_floor;

    const roomCountRaw = pick(row, this.hints.roomCountKeys, null);
    const roomCount = Number(roomCountRaw) || parseRoom(pick(row, this.hints.titleKeys, null) || pick(row, this.hints.rawTextKeys, null));
    const bathroomCount = Number(pick(row, this.hints.bathroomCountKeys, null)) || null;

    const latKeys = this.hints.latKeys || ["lat", "latitude", "y", "위도"];
    const lngKeys = this.hints.lngKeys || ["lng", "longitude", "x", "경도"];
    const lat = toCoord(pick(row, latKeys, null));
    const lng = toCoord(pick(row, lngKeys, null));

    const imageUrls = collectImageUrls(row, {
      imageLimit: this.options.imageLimit || 2,
      imageKeys: this.hints.imageKeys || DEFAULT_FIELD_HINTS.imageKeys,
    });

    const rawDirection = pick(row, this.hints.directionKeys || [], null);
    const rawBuildingUse = pick(row, this.hints.buildingUseKeys || [], null);
    const direction = parseDirectionFallback(rawDirection);
    const buildingUse = parseBuildingUseFallback(rawBuildingUse);

    const sourceRefResolved = sourceRef || hash11(`${addressText}|${rentAmount}|${depositAmount}|${exclusive.value || gross.value || ""}`);
    const hasSignal =
      sourceRefResolved !== null ||
      addressText !== null ||
      rentAmount !== null ||
      depositAmount !== null ||
      exclusive.value !== null ||
      gross.value !== null ||
      roomCount !== null ||
      floorData.floor !== null ||
      imageUrls.length > 0;

    if (!hasSignal) return null;
    return {
      platform_code: this.platformCode,
      collected_at: rawRecord?.collected_at || new Date().toISOString(),
      source_url: sourceUrl || rawSourceBase || "",
      source_ref: sourceRefResolved,
      external_id: sourceRefResolved,
      address_text: addressText || null,
      address_code: addressCode || null,
      lease_type: leaseType,
      rent_amount: rentAmount,
      deposit_amount: depositAmount,
      area_exclusive_m2: exclusive.value,
      area_exclusive_m2_min: exclusive.min,
      area_exclusive_m2_max: exclusive.max,
      area_gross_m2: gross.value,
      area_gross_m2_min: gross.min,
      area_gross_m2_max: gross.max,
      area_claimed: normalizeText(areaClaimed),
      room_count: roomCount,
      bathroom_count: bathroomCount,
      direction: direction,
      building_use: buildingUse,
      floor: floorData.floor,
      total_floor: totalFloor,
      building_name: pick(row, ["building", "buildingName", "complexName", "complex"], null),
      lat,
      lng,
      image_urls: imageUrls,
      raw_attrs: {
        title: pick(row, this.hints.titleKeys, null),
        rent_raw: pick(row, this.hints.rentKeys, null),
        deposit_raw: pick(row, this.hints.depositKeys, null),
        address_raw: addressText,
        direction: rawDirection,
        building_use: rawBuildingUse,
        source_ref_candidates: sourceRef,
      },
    };
  }
}

function resolveSourceUrl(value, base) {
  const url = resolveProtocol(value);
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!base) return null;
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function resolveUserOnlySourceUrl({ platformCode, sourceRef, rawSourceUrl, rawSourceBase }) {
  const platform = String(platformCode || "").trim().toLowerCase();
  const normalizedRef = normalizeText(sourceRef || "");
  const canonicalCandidates = [];
  if (platform === "zigbang" && normalizedRef) {
    canonicalCandidates.push(`https://sp.zigbang.com/share/oneroom/${encodeURIComponent(normalizedRef)}?userNo=undefined&stamp=${Date.now()}`);
  } else if (platform === "dabang" && normalizedRef) {
    canonicalCandidates.push(`https://www.dabangapp.com/room/${encodeURIComponent(normalizedRef)}`);
  } else if (platform === "r114" && normalizedRef) {
    canonicalCandidates.push(`https://www.r114.com/?_c=memul&_m=p10&_a=goDetail&memulNo=${encodeURIComponent(normalizedRef)}`);
  } else if (platform === "naver" && normalizedRef) {
    canonicalCandidates.push(`https://fin.land.naver.com/articles/${encodeURIComponent(normalizedRef)}`);
  }

  for (const candidate of canonicalCandidates) {
    const resolved = resolveProtocol(candidate);
    if (resolved) return resolved;
  }

  if (rawSourceUrl) {
    const resolved = resolveSourceUrl(rawSourceUrl, rawSourceBase);
    if (resolved) return resolved;
  }

  if (rawSourceBase) {
    const resolved = resolveProtocol(rawSourceBase);
    if (resolved) return resolved;
  }

  return null;
}

function resolveProtocol(v) {
  const s = normalizeText(v);
  if (!s) return null;
  if (/^\/\//.test(s)) return `https:${s}`;
  return s;
}

function toCoord(value) {
  const n = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
