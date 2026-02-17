#!/usr/bin/env node

import { BaseUserOnlyAdapter } from "./user_only_listing_adapter.mjs";

function normalizeDaangnAreaValue(rawArea) {
  if (rawArea === null || rawArea === undefined) return null;
  if (typeof rawArea === "number") return Number.isFinite(rawArea) ? rawArea : null;
  if (typeof rawArea === "string") return normalizeNumber(rawArea);

  if (typeof rawArea === "object") {
    if (rawArea.value !== undefined && rawArea.value !== null) {
      return normalizeNumber(rawArea.value);
    }
    if (rawArea.area !== undefined && rawArea.area !== null) {
      return normalizeNumber(rawArea.area);
    }
    if (rawArea.size !== undefined && rawArea.size !== null) {
      return normalizeNumber(rawArea.size);
    }
    if (rawArea.min !== undefined && rawArea.min !== null) {
      return normalizeNumber(rawArea.min);
    }
    if (rawArea.max !== undefined && rawArea.max !== null) {
      return normalizeNumber(rawArea.max);
    }
  }

  return null;
}

function normalizeImageValue(rawImage) {
  if (typeof rawImage !== "string") return null;
  const withoutAmp = rawImage.replace(/&amp;/g, "&").trim();
  if (!withoutAmp) return null;
  let candidate = withoutAmp;
  if (/^\/\//.test(candidate)) candidate = `https:${candidate}`;
  if (!/^https?:\/\//i.test(candidate)) return null;
  try {
    const parsed = new URL(candidate);
    const path = parsed.pathname.toLowerCase();
    if (!/(\\.jpg|\\.jpeg|\\.png|\\.webp|\\.gif|\\.avif|\\.bmp|\\.svg)(\\?|$)/.test(path)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function collectDaangnImageUrls(...sources) {
  const limit = 12;
  const out = [];
  const seen = new Set();

  for (const source of sources) {
    if (out.length >= limit) break;
    if (!source) continue;

    const values = Array.isArray(source) ? source : [source];
    for (const value of values) {
      if (out.length >= limit) break;
      const normalized = normalizeImageValue(value);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  }

  return out;
}

function normalizeNumber(value) {
  const numeric = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
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
          "roomCount",
          "room_cnt",
          "room_cnts",
        ],
        imageKeys: [
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
          "list_data.total_floor",
          "list_data.totalFloor",
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

    return [this.postProcess(normalized, rawRecord)];
  }

  postProcess(item, rawRecord) {
    const payload = rawRecord?.payload_json || {};
    const listData = rawRecord?.list_data || {};

    const parsedRent = normalizeNumber(payload?._parsed?.rent);
    const parsedDeposit = normalizeNumber(payload?._parsed?.deposit);
    if (item.rent_amount === null && parsedRent !== null) {
      item.rent_amount = parsedRent;
    }
    if (item.deposit_amount === null && parsedDeposit !== null) {
      item.deposit_amount = parsedDeposit;
    }

    if (!item.area_exclusive_m2 && payload?.area !== null && payload?.area !== undefined) {
      const parsedArea = normalizeDaangnAreaValue(payload.area);
      if (parsedArea !== null) {
        item.area_exclusive_m2 = parsedArea;
      }
    }

    if (!item.area_claimed && payload?.areaClaimed) {
      item.area_claimed = payload.areaClaimed;
    }
    if (!item.area_claimed && payload?.areaClaimedType) {
      item.area_claimed = payload.areaClaimedType;
    }
    if (!item.area_claimed && payload?.areaClaimedTypeText) {
      item.area_claimed = payload.areaClaimedTypeText;
    }
    if (!item.area_claimed && payload?.area_claimed) {
      item.area_claimed = payload.area_claimed;
    }

    if (!item.area_exclusive_m2 && payload?.area_claimed === "gross" && payload?.area_exclusive_m2 !== null && payload?.area_exclusive_m2 !== undefined) {
      item.area_exclusive_m2 = normalizeDaangnAreaValue(payload.area_exclusive_m2);
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
      payload.imgUrlList,
      listData.imgUrlList,
      listData?.images,
    ];
    const normalizedImageUrls = collectDaangnImageUrls(...rawImages);
    if (normalizedImageUrls.length > 0) {
      item.image_urls = normalizedImageUrls;
    }

    if (!item.building_use && payload?.propertyType) {
      item.building_use = payload.propertyType;
    }

    if (!item.source_url && payload?.identifier) {
      item.source_url = payload.identifier;
    }

    return item;
  }
}
