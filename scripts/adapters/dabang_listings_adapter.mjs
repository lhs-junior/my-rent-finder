#!/usr/bin/env node

import { BaseUserOnlyAdapter, parseMoneyPair } from "./user_only_listing_adapter.mjs";

const DEFAULT_CITY = "서울특별시";

const DABANG_FIELD_HINTS = {
  sourceRefKeys: [
    "id",
    "seq",
    "articleId",
    "article_id",
    "articleNo",
    "externalId",
    "source_ref",
  ],
  titleKeys: [
    "roomTitle",
    "title",
    "name",
    "headline",
    "summary",
    "subject",
  ],
  addressKeys: [
    "address",
    "address_text",
    "addressText",
    "fullAddress",
    "full_address",
    "roadAddress",
    "address_detail",
    "streetAddress",
  ],
  addressCityKeys: [
    "sido",
    "city",
    "province",
    "addressCity",
    "address_city",
  ],
  addressGuKeys: [
    "sigungu",
    "gu",
    "district",
    "region_name",
    "region",
    "sidoNm",
  ],
  addressDongKeys: [
    "dong",
    "dongName",
    "town",
    "읍면동",
    "neighborhood",
  ],
  leaseTypeKeys: [
    "priceTypeName",
    "leaseType",
    "tradeTypeName",
    "tradeType",
    "type",
  ],
  rentKeys: [
    "rent",
    "월세",
    "rentFee",
    "rent_fee",
    "monthlyRent",
    "monthly_rent",
    "monthlyPrice",
    "rentPrice",
  ],
  depositKeys: [
    "deposit",
    "보증금",
    "depositFee",
    "deposit_fee",
    "depositPrice",
    "depositPriceText",
    "보증금금액",
  ],
  areaExclusiveKeys: [
    "area_exclusive_m2",
    "area",
    "spc1",
    "areaExclusive",
    "exclusiveArea",
    "전용면적",
    "roomArea",
  ],
  areaGrossKeys: [
    "area_gross_m2",
    "area_gross",
    "spc2",
    "areaGross",
    "grossArea",
    "supplyArea",
  ],
  areaTypeKeys: [
    "area_claimed",
    "areaClaimed",
    "areaType",
  ],
  roomCountKeys: [
    "roomTypeName",
    "room_count",
    "roomCount",
    "roomCnt",
    "rooms",
    "room_type",
  ],
  bathroomCountKeys: [
    "bathroom_count",
    "bathroomCount",
    "bathroom",
    "bath_count",
  ],
  floorKeys: [
    "floor",
    "floorText",
    "floor_text",
    "roomDesc",
    "floorInfo",
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
    "buildingUse",
    "building_use",
    "buildingType",
    "building_type",
    "roomTypeName",
    "house_type",
    "houseType",
  ],
  sourceUrlKeys: [
    "source_url",
    "sourceUrl",
    "url",
    "link",
    "detail_url",
    "detailUrl",
    "article_url",
    "articleUrl",
    "request_url",
    "requestUrl",
    "href",
  ],
  imageKeys: [
    "imgUrlList",
    "images",
    "imageList",
    "image_list",
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
    "priceTitle",
    "price_title",
    "price_text",
    "roomDesc",
    "desc",
    "description",
    "description_text",
    "comment",
    "detail",
    "detailText",
    "detail_text",
    "raw_text",
    "content",
    "memo",
    "memo_text",
    "summary",
    "info",
  ],
  listHintPaths: [
    "payload_json",
    "list_data",
    "items",
    "itemList",
    "list",
    "lists",
    "result",
    "results",
    "payload",
    "response",
    "body",
    "data",
    "property_list",
    "properties",
  ],
};

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFallbackAddress(row, rawRecord) {
  const city = normalizeText(row?.sido || row?.city || rawRecord?.sido || rawRecord?.city || DEFAULT_CITY);
  const gu = normalizeText(row?.sigungu || row?.gu || rawRecord?.sigungu || row?.district || rawRecord?.district);
  const dong = normalizeText(
    row?.dong || row?.dongName || row?.town || row?.읍면동 || rawRecord?.dongName || rawRecord?.dong,
  );

  return [city, gu, dong].filter(Boolean).join(" ").trim().replace(/\s+/g, " ");
}

function enrichDabangRow(row, rawRecord) {
  const next = { ...row };
  const fallbackAddress = buildFallbackAddress(row, rawRecord);
  if (!next.sido && !next.city && !next.city_name) {
    next.sido = DEFAULT_CITY;
  }
  if (!next.sigungu && rawRecord?.sigungu) {
    next.sigungu = rawRecord.sigungu;
  }
  if (!next.dongName && rawRecord?.dongName) {
    next.dongName = rawRecord.dongName;
  }
  if (!next.roomDesc && next.desc) {
    next.roomDesc = next.desc;
  }
  if (!next.roomDesc && next.description) {
    next.roomDesc = next.description;
  }

  if (fallbackAddress) {
    if (!next.address) next.address = fallbackAddress;
    if (!next.address_text) next.address_text = fallbackAddress;
    if (!next.addressText) next.addressText = fallbackAddress;
  }
  return next;
}

function pickPriceText(row, rawRecord) {
  const candidates = [
    row?.priceTitle,
    row?.price_title,
    row?.priceText,
    row?.price_text,
    row?.list_data?.priceTitle,
    row?.list_data?.price_title,
    row?.list_data?.priceText,
    row?.list_data?.price_text,
    rawRecord?.payload_json?.priceTitle,
    rawRecord?.payload_json?.price_title,
    rawRecord?.payload_json?.priceText,
    rawRecord?.payload_json?.price_text,
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const normalized = normalizeText(candidate);
    if (!normalized) continue;
    return normalized;
  }
  return null;
}

function parseDabangPriceText(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  const parsed = parseMoneyPair(normalized, { preferDepositFirst: true });
  if (parsed.rent == null || parsed.deposit == null) return null;

  return parsed;
}

function parseDabangAreaFromDesc(roomDesc) {
  const s = normalizeText(roomDesc);
  if (!s) return null;
  const m = /(\d+(?:\.\d+)?)\s*(?:m²|㎡|제곱미터)/i.exec(s);
  if (!m) return null;
  const v = Number.parseFloat(m[1]);
  return Number.isFinite(v) && v > 0 && v < 1000 ? v : null;
}

export class DabangListingAdapter extends BaseUserOnlyAdapter {
  constructor(options = {}) {
    super({
      platformCode: "dabang",
      platformName: "다방",
      collectionMode: "STEALTH_AUTOMATION",
      fieldHints: DABANG_FIELD_HINTS,
      options,
    });
    this.notes = [
      "다방은 BaseUserOnlyAdapter의 가격/면적 파서 로직을 사용해 priceTitle 방향 이슈를 정규화",
      "roomDesc/주소 보강은 다방 특화 보완 파싱만 추가 적용",
    ];
  }

  normalizeListingRow(row, rawRecord) {
    const mergedRow = enrichDabangRow(row, rawRecord);
    const normalized = super.normalizeListingRow(mergedRow, rawRecord);
    if (!normalized) return null;

    const priceText = pickPriceText(mergedRow, rawRecord);
    if (priceText) {
      const parsed = parseDabangPriceText(priceText);
      if (parsed.rent !== null && parsed.deposit !== null) {
        normalized.rent_amount = parsed.rent;
        normalized.deposit_amount = parsed.deposit;
      }
    }

    // roomDesc에서 면적 추출 (e.g. "5층, 40m², 관리비 10만")
    if (normalized.area_exclusive_m2 == null) {
      const desc = mergedRow?.roomDesc || mergedRow?.desc || mergedRow?.description || "";
      const areaFromDesc = parseDabangAreaFromDesc(desc);
      if (areaFromDesc !== null) {
        normalized.area_exclusive_m2 = areaFromDesc;
        normalized.area_exclusive_m2_min = areaFromDesc;
        normalized.area_exclusive_m2_max = areaFromDesc;
        normalized.area_claimed = "exclusive";
      }
    }

    return normalized;
  }
}
