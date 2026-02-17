#!/usr/bin/env node

import { BaseUserOnlyAdapter } from "./user_only_listing_adapter.mjs";

const URL_IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)(\?|$)/i;

function toNumber(value) {
  const n = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function collectZigbangImageCandidates(raw) {
  const urls = [];
  const seen = new Set();

  const add = (url) => {
    if (typeof url !== "string") return;
    const trimmed = url.trim();
    if (!trimmed) return;

    try {
      const parsed = new URL(trimmed);
      const path = parsed.pathname.toLowerCase();
      if (!URL_IMAGE_RE.test(path)) return;
      if (seen.has(trimmed)) return;
      seen.add(trimmed);
      urls.push(trimmed);
    } catch {
      // no-op
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
      ];
      for (const c of candidates) {
        collectCandidateValue(c);
      }
    }
  };

  const candidates = [
    raw.images,
    raw.images_thumbnail,
    raw.image_thumbnail,
    raw.imageThumbnail,
    raw.thumbnail,
    raw.thumb,
    raw.image,
    raw.image_list,
    raw.imageList,
    raw.img,
    raw.imgList,
    raw.photo,
    raw.photo_list,
    raw.photoList,
    raw.photoUrl,
    raw.imageUrl,
    raw.image_url,
    raw.imgUrl,
    raw.img_url,
  ];

  for (const candidate of candidates) {
    collectCandidateValue(candidate);
  }

  return urls;
}

function normalizeZigbangFloor(rawValue) {
  const v = String(rawValue ?? "").trim();
  if (!v) return null;
  const numeric = Number.parseInt(v.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeZigbangAddress(raw) {
  const addr = [
    raw?.addressOrigin?.local1,
    raw?.addressOrigin?.local2,
    raw?.addressOrigin?.local3,
    raw?.addressOrigin?.address2,
    raw?.addressOrigin?.fullText,
    raw?.addressOrigin?.localText,
    raw.address,
    raw.address_text,
    raw.addressText,
  ].filter((x) => typeof x === "string" && x.trim());

  return addr.length ? addr[0] : "";
}

function normalizeZigbangBuildingUse(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  return v.includes("빌라") ? "빌라/연립" : v.includes("오피스텔") ? "오피스텔" : v;
}

function normalizeZigbangDirection(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (v.includes("향")) return v;
  const normalized = v.replace(/\s+/g, "").toUpperCase();
  const map = {
    S: "남향",
    N: "북향",
    E: "동향",
    W: "서향",
    SE: "남동향",
    SW: "남서향",
    NE: "북동향",
    NW: "북서향",
    SSE: "남향",
    NNW: "북향",
    WNW: "서향",
    SSW: "남향",
    ENE: "동향",
    WSW: "서향",
    NNE: "북향",
  };
  return map[normalized] || null;
}

function isLikelyZigbangListingRow(value) {
  if (!value || typeof value !== "object") return false;

  return (
    value.item_id !== undefined
    || value.itemId !== undefined
    || value.item_no !== undefined
    || value.itemNo !== undefined
    || value.rent !== undefined
    || value.deposit !== undefined
    || value.price?.rent !== undefined
    || value.price?.deposit !== undefined
    || value.size_m2 !== undefined
    || value.area !== undefined
    || value.전용면적 !== undefined
    || value["전용면적M2"] !== undefined
    || value.address !== undefined
    || value.addressOrigin !== undefined
    || value.room_type !== undefined
    || value.roomType !== undefined
    || value.service_type !== undefined
    || value.serviceType !== undefined
    || value.images !== undefined
  );
}

function collectZigbangListingRows(payload) {
  const rows = [];
  const visited = new Set();

  const tryPush = (candidate) => {
    if (!candidate || typeof candidate !== "object") return;
    if (visited.has(candidate)) return;
    visited.add(candidate);

    if (isLikelyZigbangListingRow(candidate)) {
      rows.push(candidate);
    }
  };

  if (!payload || typeof payload !== "object") return rows;

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (isLikelyZigbangListingRow(entry)) rows.push(entry);
    }
    return rows;
  }

  const nestedCandidates = [
    payload.item,
    payload.data,
    payload.result,
    payload.result?.items,
    payload.items,
    payload.itemList,
    payload.list,
    payload.item_list,
    payload.payload,
  ];

  for (const candidate of nestedCandidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      for (const item of candidate) tryPush(item);
    } else {
      tryPush(candidate);
    }
  }

  // V2 API에서 payload가 바로 매물 객체인 케이스를 커버.
  if (isLikelyZigbangListingRow(payload)) {
    rows.push(payload);
  }

  // Fallback: 최소한 후보가 하나도 없으면 원본 자체를 유일 단위로 전달.
  if (rows.length === 0) rows.push(payload);
  return rows;
}

function dedupeZigbangNormalized(items) {
  const computeScore = (item) => {
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
  };

  const fallback = (item) =>
    `${item?.address_text || ""}|${item?.rent_amount ?? ""}|${item?.deposit_amount ?? ""}|${item?.area_exclusive_m2 ?? item?.area_gross_m2 ?? ""}`;

  const normalizeForDedupe = (item) => {
    if (!item || typeof item !== "object") return null;
    const sourceRef = item.source_ref != null ? String(item.source_ref).trim() : "";
    if (sourceRef) return `src:${sourceRef}`;
    return `fb:${fallback(item)}`;
  };

  const seen = new Map();

  for (const item of items) {
    const key = normalizeForDedupe(item);
    if (!key) continue;

    const score = computeScore(item);
    const current = seen.get(key);
    if (!current || score > current.score) {
      seen.set(key, { item, score });
    }
  }

  return [...seen.values()].map((entry) => entry.item);
}

export class ZigbangListingAdapter extends BaseUserOnlyAdapter {
  constructor(options = {}) {
    const normalizedOptions = { imageLimit: 12, ...options };
    super({
      platformCode: "zigbang",
      platformName: "직방",
      collectionMode: "STEALTH_AUTOMATION",
      fieldHints: {
        sourceRefKeys: [
          "articleId",
          "article_id",
          "itemId",
          "item_id",
          "itemNo",
          "item_no",
          "listingId",
          "id",
          "_id",
        ],
        titleKeys: ["itemTitle", "title", "articleTitle", "subject", "headline", "name"],
        addressKeys: [
          "addr",
          "address",
          "address1",
          "addressText",
          "address_text",
          "fullAddress",
          "addressOrigin.fullText",
          "addressOrigin.localText",
          "addressOrigin.local1",
          "addressOrigin.local2",
          "addressOrigin.local3",
          "roadAddress",
          "도로명주소",
        ],
        addressCityKeys: ["local1", "addressOrigin.local1", "sido", "sidoNm", "city", "city_name", "province"],
        addressGuKeys: ["local2", "sigungu", "gu", "district", "borough", "region_name", "region"],
        addressDongKeys: ["local3", "dong", "town", "neighborhood", "읍면동", "addressOrigin.local3"],
        rentKeys: [
          "rentPrice",
          "rent",
          "monthlyRent",
          "월세",
          "월세금액",
          "depositRent",
        ],
        depositKeys: ["depositPrice", "deposit", "보증금", "보증금금액", "depositFee"],
        areaExclusiveKeys: [
          "area",
          "exclusiveArea",
          "spc1",
          "전용면적",
          "exclusiveAreaM2",
          "size_m2",
        ],
        areaGrossKeys: [
          "size_m2",
          "area2",
          "supplyArea",
          "grossArea",
          "spc2",
          "공급면적",
          "grossAreaM2",
          "전용면적.m2",
          "공급면적.m2",
        ],
        imageKeys: [
          "thumbNail",
          "thumbnail",
          "images",
          "imgList",
          "imageList",
          "photo",
          "images_thumbnail",
          "image_thumbnail",
          "photoUrl",
        ],
        latKeys: [
          "lat",
          "latitude",
          "location.lat",
          "random_location.lat",
        ],
        lngKeys: [
          "lng",
          "longitude",
          "location.lng",
          "random_location.lng",
        ],
        directionKeys: [
          "direction",
          "direction_text",
          "facing",
          "houseDir",
          "houseDirection",
          "buildingDirection",
          "direction_text",
          "roomDirection",
        ],
        buildingUseKeys: [
          "house_type",
          "houseType",
          "houseTypeNm",
          "building_use",
          "buildingUse",
          "buildingUseNm",
          "building_type",
          "buildingType",
          "service_type",
          "serviceType",
        ],
      },
      options: normalizedOptions,
    });
    this.notes = [
      "직방 STEALTH raw 구조에 대한 정규화 파서 적용",
    ];
  }

  normalizeFromRawRecord(rawRecord) {
    const payload = rawRecord?.payload_json || rawRecord?.payload || rawRecord;
    const rawRows = collectZigbangListingRows(payload);

    const normalizedRows = [];
    for (const row of rawRows) {
      if (!row || typeof row !== "object") continue;

      const rowRecord = {
        ...rawRecord,
        payload_json: row,
      };
      const normalized = this.normalizeListingRow(row, rowRecord);
      if (!normalized) continue;
      const processed = this.postProcess(normalized, rowRecord);
      if (processed) {
        normalizedRows.push(processed);
      }
    }

    return dedupeZigbangNormalized(normalizedRows);
  }

  postProcess(item, rawRecord) {
    const raw = rawRecord?.payload_json || rawRecord;
    if (!raw || typeof raw !== "object") return item;

    const sourceRef =
      item.source_ref ||
      (raw.item_id != null ? String(raw.item_id) : null) ||
      (raw.itemId != null ? String(raw.itemId) : null) ||
      null;

    if (sourceRef) {
      item.source_ref = sourceRef;
      item.external_id = sourceRef;
      if (!item.source_url || item.source_url.includes("/home/oneroom/map")) {
        item.source_url = `https://sp.zigbang.com/share/oneroom/${encodeURIComponent(sourceRef)}?userNo=undefined`;
      }
    }

    if (!item.address_text) {
      const normalizedAddress = normalizeZigbangAddress(raw);
      if (normalizedAddress) item.address_text = normalizedAddress;
    }

    if (item.area_exclusive_m2 == null) {
      const area = toNumber(raw.size_m2);
      if (area != null) {
        item.area_exclusive_m2 = area;
        item.area_claimed = "exclusive";
      }
    }

    if (!item.floor && raw.floor_string) {
      item.floor = normalizeZigbangFloor(raw.floor_string);
    }
    if (!item.total_floor && raw.building_floor) {
      item.total_floor = normalizeZigbangFloor(raw.building_floor);
    }

    if (!item.building_use && raw.service_type) {
      item.building_use = normalizeZigbangBuildingUse(raw.service_type);
    }

    if (!item.direction && (raw.direction || raw.facing || raw.houseDirection || raw.buildingDirection)) {
      item.direction = normalizeZigbangDirection(
        raw.direction || raw.facing || raw.houseDirection || raw.buildingDirection,
      );
    }

    const imageCandidates = collectZigbangImageCandidates(raw);
    if (imageCandidates.length > 0) {
      const merged = [
        ...(Array.isArray(item.image_urls) ? item.image_urls : []),
        ...imageCandidates,
      ];
      const seen = new Set();
      item.image_urls = [];
      for (const url of merged) {
        if (!seen.has(url)) {
          seen.add(url);
          item.image_urls.push(url);
        }
      }
    }

    if (!item.room_count) {
      const roomTypeNum = normalizeZigbangFloor(raw.room_type);
      if (roomTypeNum != null) {
        item.room_count = roomTypeNum;
      }
    }

    // Extract nested coordinates: location.lat/lng or random_location.lat/lng
    if (item.lat == null || item.lng == null) {
      const lat = toNumber(raw?.location?.lat)
        ?? toNumber(raw?.random_location?.lat)
        ?? toNumber(raw?.lat);
      const lng = toNumber(raw?.location?.lng)
        ?? toNumber(raw?.random_location?.lng)
        ?? toNumber(raw?.lng);
      if (lat != null) item.lat = lat;
      if (lng != null) item.lng = lng;
    }

    return item;
  }
}
