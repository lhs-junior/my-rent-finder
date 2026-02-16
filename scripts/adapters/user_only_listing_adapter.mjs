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
    "comment",
    "detail",
    "detailText",
    "raw_text",
    "content",
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

function parseMoneyPair(rawText) {
  const s = normalizeText(rawText).toLowerCase();
  if (!s) return { rent: null, deposit: null };

  const splitPair = (input, sep = "/") => {
    const idx = input.indexOf(sep);
    if (idx < 0) return null;
    const left = parseMoney(input.slice(0, idx));
    const right = parseMoney(input.slice(idx + 1));
    return { rent: left, deposit: right };
  };

  const pipe = splitPair(s, "/");
  if (pipe && (pipe.rent !== null || pipe.deposit !== null)) return pipe;

  const bar = splitPair(s, "|");
  if (bar && (bar.rent !== null || bar.deposit !== null)) return bar;

  const rentMatch =
    /(월세)\s*[:\s]\s*([0-9.,억천만만원원\s]+)|([0-9.,억천만만원]+\s*월세)/i.exec(s);
  const depositMatch =
    /(보증금)\s*[:\s]\s*([0-9.,억천만만원원\s]+)|([0-9.,억천만만원]+\s*보증금)/i.exec(s);

  const rent = rentMatch ? parseMoney(rentMatch[2] || rentMatch[3]) : null;
  const deposit = depositMatch ? parseMoney(depositMatch[2] || depositMatch[3]) : null;
  if (rent !== null || deposit !== null) return { rent, deposit };

  const nums = s.match(/([0-9]+(?:\.[0-9]+)?(?:\s*억)?(?:\s*천만)?(?:\s*만)?|[0-9]+(?:\.[0-9]+)?\s*만원)/g);
  if (!nums || nums.length < 2) {
    return { rent: nums?.[0] ? parseMoney(nums[0]) : null, deposit: null };
  }
  return { rent: parseMoney(nums[0]), deposit: parseMoney(nums[1]) };
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
  const pair = /(\d+)\s*\/\s*(\d+)\s*층?/.exec(s);
  if (pair) return { floor: Number(pair[1]), total_floor: Number(pair[2]) };
  const floor = /(\d+)\s*층/.exec(s);
  const total = /총\s*(\d+)\s*층/.exec(s);
  return {
    floor: floor ? Number(floor[1]) : null,
    total_floor: total ? Number(total[1]) : null,
  };
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
    const s = normalizeText(value);
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

  normalizeFromRawRecord(rawRecord) {
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
    const seen = new Set();
    const out = [];

    for (const row of rows) {
      if (!isObject(row)) continue;

      const normalized = this.normalizeListingRow(row, rawRecord);
      if (!normalized) continue;

      const dedupeKey = normalized.source_ref || hash11(
        `${normalized.address_text || ""}|${normalized.address_code || ""}|${normalized.rent_amount || ""}|${normalized.deposit_amount || ""}|${normalized.area_exclusive_m2 || normalized.area_gross_m2 || ""}`,
      );
      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push(normalized);
    }

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

    if (rentAmount === null || depositAmount === null) {
      const pair = parseMoneyPair(`${textForPrice || ""}`);
      if (rentAmount === null) rentAmount = pair.rent;
      if (depositAmount === null) depositAmount = pair.deposit;
    }

    const floorData = parseFloor(pick(row, this.hints.floorKeys, pick(row, this.hints.totalFloorKeys, null)));
    const totalFloor = floorData.total_floor || parseFloor(pick(row, this.hints.totalFloorKeys, null)).total_floor;

    const roomCountRaw = pick(row, this.hints.roomCountKeys, null);
    const roomCount = Number(roomCountRaw) || parseRoom(pick(row, this.hints.titleKeys, null) || pick(row, this.hints.rawTextKeys, null));
    const bathroomCount = Number(pick(row, this.hints.bathroomCountKeys, null)) || null;

    const lat = toCoord(pick(row, ["lat", "latitude", "y", "위도"], null));
    const lng = toCoord(pick(row, ["lng", "longitude", "x", "경도"], null));

    const imageUrls = collectImageUrls(row, {
      imageLimit: this.options.imageLimit || 2,
      imageKeys: this.hints.imageKeys || DEFAULT_FIELD_HINTS.imageKeys,
    });

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
      direction: pick(row, this.hints.directionKeys || [], null),
      building_use: pick(row, this.hints.buildingUseKeys || [], null),
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
        direction: pick(row, this.hints.directionKeys || [], null),
        building_use: pick(row, this.hints.buildingUseKeys || [], null),
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
