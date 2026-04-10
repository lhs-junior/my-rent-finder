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
    "room_size",
    "provision_size",
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
  latKeys: [
    "lat",
    "latitude",
    "randomLocation.lat",
    "random_location.lat",
    "location.lat",
  ],
  lngKeys: [
    "lng",
    "longitude",
    "randomLocation.lng",
    "random_location.lng",
    "location.lng",
  ],
  roomCountKeys: [
    "beds_num",
    "room_type_str",
    "room_type_main_str",
    "roomTypeName",
    "room_count",
    "roomCount",
    "roomCnt",
    "rooms",
  ],
  bathroomCountKeys: [
    "bathroom_count",
    "bathroomCount",
    "bathroom",
    "bath_count",
    "bath_num",
  ],
  floorKeys: [
    "floor",
    "floorText",
    "floor_text",
    "roomDesc",
    "floorInfo",
    "room_floor_str",
  ],
  totalFloorKeys: [
    "total_floor",
    "totalFloor",
    "floors",
    "floors_total",
    "totalFloorCount",
    "building_floor_str",
  ],
  directionKeys: [
    "direction",
    "direction_text",
    "facing",
    "facing_text",
    "house_facing",
    "houseFacing",
    "direction_str",
  ],
  buildingUseKeys: [
    // roomTypeName: 다방이 제공하는 한글 건물 유형 (원룸/투룸 등)
    "roomTypeName",
    "house_type",
    "houseType",
    // buildingType/building_type 은 숫자 코드이므로 제외
    // building_use_types_str 은 배열이므로 normalizeFromRawRecord에서 별도 처리
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
  salePriceKeys: ["price", "salePrice", "dealPrice", "매매가"],
  loanAmountKeys: ["loan", "loanAmount", "대출금"],
  buildingYearKeys: ["buildYear", "builtYear", "built_year"],
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

  normalizeFromRawRecord(rawRecord) {
    const payload =
      rawRecord?.payload_json ??
      rawRecord?.payload ??
      rawRecord?.data ??
      rawRecord ??
      {};

    // 다방 payload_json은 단일 매물 — collectCandidates 탐색 없이 바로 처리
    const normalized = this.normalizeListingRow(payload, rawRecord);
    if (!normalized) return [];

    if (!normalized.source_ref) {
      const ref = payload?.id || payload?.seq;
      if (ref) {
        normalized.source_ref = String(ref);
        normalized.external_id = String(ref);
      }
    }

    return [normalized];
  }

  normalizeListingRow(row, rawRecord) {
    const mergedRow = enrichDabangRow(row, rawRecord);
    const normalized = super.normalizeListingRow(mergedRow, rawRecord);
    if (!normalized) return null;

    if (!normalized.title) {
      normalized.title = mergedRow?.title || mergedRow?.roomTitle || null;
    }

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

    // building_use: building_use_types_str 배열 → 한글 문자열로 변환
    // 숫자 코드(1,2,3 등)가 그대로 들어온 경우 무효화
    {
      const bu = normalized.building_use;
      if (bu != null && /^\d+$/.test(String(bu))) {
        // 숫자 코드 → null
        normalized.building_use = null;
      }
      if (normalized.building_use == null) {
        const buTypes = mergedRow?.building_use_types_str || mergedRow?.buildingUseTypesStr;
        if (Array.isArray(buTypes) && buTypes.length > 0) {
          const text = buTypes.filter(Boolean).join("/");
          if (text) normalized.building_use = text;
        } else if (typeof buTypes === "string" && buTypes.trim()) {
          normalized.building_use = buTypes.trim();
        }
      }
    }

    // 다방 building_floor_str에서 total_floor 추출 (e.g. "3층")
    if (normalized.total_floor == null) {
      const bfs = mergedRow?.building_floor_str || mergedRow?.total_floor_str;
      if (bfs) {
        const m = /(\d+)/.exec(String(bfs));
        if (m) normalized.total_floor = Number(m[1]);
      }
    }

    // 다방 image_list: [{id, prefix_url}, ...] → URL 조합 (base adapter가 객체 배열을 제대로 못 풀어서 덮어쓰기)
    if (Array.isArray(mergedRow?.image_list)) {
      const urls = [];
      for (const img of mergedRow.image_list) {
        if (img && img.prefix_url && img.id) {
          urls.push(img.prefix_url + img.id);
        }
      }
      if (urls.length > 0) {
        normalized.image_urls = urls.slice(0, 12);
      }
    }

    return normalized;
  }
}
