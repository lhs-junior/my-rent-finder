#!/usr/bin/env node

import { BaseUserOnlyAdapter, parseMoneyPair } from "./user_only_listing_adapter.mjs";
import { normalizeListedAt } from "../lib/listed_at_normalizer.mjs";

// 다방 anti-bot 우회용 magic 헤더 — 페이지 axios가 인터셉터로 추가하는 헤더 모방.
// 이 헤더가 있으면 pure Node fetch로도 200 응답을 받는다. (probe 검증)
const DABANG_API_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "accept": "application/json, text/plain, */*",
  "csrf": "token",
  "d-api-version": "5.0.0",
  "d-app-version": "1",
  "d-call-type": "web",
};

export async function fetchDabangNear(roomId, { timeoutMs = 8000 } = {}) {
  const url = `https://www.dabangapp.com/api/v5/room/${encodeURIComponent(roomId)}/near`;
  const res = await fetch(url, {
    headers: {
      ...DABANG_API_HEADERS,
      referer: `https://www.dabangapp.com/map/onetwo?detail_type=room&detail_id=${encodeURIComponent(roomId)}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json?.result ?? null;
}

// /api/3/new-room/detail — 매물 상세. status 체크/상세 보강에 사용.
// 반환: { status, room, msg } — 200이면 ok=true, 4xx면 ok=false (notFound 또는 error).
export async function fetchDabangDetail(roomId, { timeoutMs = 8000 } = {}) {
  const url = `https://www.dabangapp.com/api/3/new-room/detail?room_id=${encodeURIComponent(roomId)}&api_version=3.0.1&call_type=web&version=1`;
  const res = await fetch(url, {
    headers: {
      ...DABANG_API_HEADERS,
      referer: `https://www.dabangapp.com/map/onetwo?detail_type=room&detail_id=${encodeURIComponent(roomId)}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ok = res.status === 200;
  let body = null;
  try {
    body = await res.json();
  } catch {
    // content-type이 text/plain인 경우 또는 본문이 비정상인 경우 — 무시
  }
  return { ok, status: res.status, room: body?.room ?? null, msg: body?.msg ?? null };
}

export function extractJibunKey(addr) {
  if (!addr) return null;
  // 콤마/공백 모두 토큰 구분자로 처리. 예: "서울시 노원구 공릉동 683-20, 1동" / "서울특별시 중랑구 중화동 295-20"
  const tokens = String(addr).trim().split(/\s+|,\s*/).filter(Boolean);
  if (tokens.length < 2) return null;
  // 동/가/리로 끝나는 토큰을 우측에서부터 찾되, 최소 1자 한글 prefix 요구 — "1동" 같은 호수 토큰 제외
  let dongIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^[가-힣]+[가-힣A-Za-z0-9]*(?:동|가|리)\d*$/.test(tokens[i])) {
      dongIdx = i;
      break;
    }
  }
  if (dongIdx < 0) return null;
  const next = tokens[dongIdx + 1];
  if (!next || !/^\d+(?:-\d+)*$/.test(next)) return null;
  return `${tokens[dongIdx]} ${next}`;
}

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
  buildingYearKeys: ["building_approval_date_str", "buildYear", "builtYear", "built_year"],
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

function isRealDistrict(s) {
  return typeof s === "string" && /[구군시]$/.test(s.trim());
}

function buildFallbackAddress(row, rawRecord) {
  const city = normalizeText(row?.sido || row?.city || rawRecord?.sido || rawRecord?.city || DEFAULT_CITY);
  // rawRecord.sigungu 또는 payload_json.sigungu가 실제 행정구역(구/군/시로 끝남)일 때만 사용 — "서울숲권역" 같은 수집 범위 인자 제외
  const payloadSigungu = rawRecord?.payload_json?.sigungu;
  const rawSigungu =
    isRealDistrict(rawRecord?.sigungu) ? rawRecord.sigungu :
    isRealDistrict(payloadSigungu) ? payloadSigungu : null;
  const gu = normalizeText(row?.sigungu || row?.gu || row?.district || rawRecord?.district || rawSigungu);
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
  if (!next.sigungu) {
    const sg = rawRecord?.sigungu || rawRecord?.payload_json?.sigungu;
    if (isRealDistrict(sg)) next.sigungu = sg;
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

// detail 페이로드의 풍부한 attribute를 features JSONB로 묶는다.
// 다방 list-only 페이로드에는 거의 안 들어 있으므로 detail 수집 후에만 의미 있음.
function buildDabangFeatures(row) {
  if (!row) return null;
  const out = {};

  const opts = Array.isArray(row.room_options)
    ? row.room_options.map((o) => o?.name).filter(Boolean)
    : null;
  if (opts && opts.length > 0) out.options = opts;

  const safeties = Array.isArray(row.safeties)
    ? row.safeties.map((s) => s?.name).filter(Boolean)
    : null;
  if (safeties && safeties.length > 0) out.safeties = safeties;

  const tags = Array.isArray(row.hash_tags) ? row.hash_tags.filter(Boolean) : null;
  if (tags && tags.length > 0) out.tags = tags;

  if (typeof row.heating === "string" && row.heating.trim()) out.heating = row.heating.trim();

  if (row.parking != null || row.parking_str || row.parking_num != null) {
    out.parking = {
      possible: row.parking === true,
      count: Number.isFinite(Number(row.parking_num)) ? Number(row.parking_num) : null,
      label: typeof row.parking_str === "string" ? row.parking_str : null,
    };
  }

  // 다방의 단일값 attribute는 "-" 표시도 들어오므로 빈값으로 정규화
  const cleanText = (v) => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s && s !== "-" ? s : null;
  };
  const single = (k, v) => {
    const c = cleanText(v);
    if (c) out[k] = c;
  };
  single("elevator", row.elevator_str);
  single("entrance", row.entrance_type_str);
  single("households", row.household_num_str);
  single("balcony", row.balcony_str);
  single("built_in", row.built_in_str);
  single("duplex", row.duplex_str);
  single("loan", row.loan_str);
  single("short_lease", row.short_lease_str);
  single("moving_date", row.moving_date);
  single("direction_base", row.direction_measurement_base_type_str);

  if (row.is_new_construction === true) out.flags = { ...(out.flags || {}), new_construction: true };
  if (row.is_lh_lease === true) out.flags = { ...(out.flags || {}), lh_lease: true };
  if (row.is_take_tenant === true) out.flags = { ...(out.flags || {}), take_tenant: true };
  if (row.is_naver_verify === true) out.flags = { ...(out.flags || {}), naver_verify: true };

  const mc = {};
  if (Number.isFinite(Number(row.maintenance_cost))) mc.cost = Number(row.maintenance_cost);
  if (cleanText(row.maintenance_cost_str)) mc.cost_label = cleanText(row.maintenance_cost_str);
  if (cleanText(row.maintenance_items_str)) mc.items = cleanText(row.maintenance_items_str);
  if (cleanText(row.month_total_cost_str)) mc.month_total = cleanText(row.month_total_cost_str);
  if (cleanText(row.maintenance_charge_type)) mc.charge_type = cleanText(row.maintenance_charge_type);
  if (Object.keys(mc).length > 0) out.maintenance = mc;

  const popularity = {};
  if (Number.isFinite(Number(row.view_count_a_week))) popularity.week_views = Number(row.view_count_a_week);
  if (Number.isFinite(Number(row.favorited_count))) popularity.favorites = Number(row.favorited_count);
  if (Object.keys(popularity).length > 0) out.popularity = popularity;

  if (cleanText(row.shorten_url)) out.shorten_url = cleanText(row.shorten_url);

  return Object.keys(out).length > 0 ? out : null;
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

    if (!normalized.listed_at) {
      normalized.listed_at = normalizeListedAt(
        mergedRow?.saved_time_str || mergedRow?.confirm_date_str || mergedRow?.naver_verify_date_str || null,
      );
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

    // /api/v5/room/{id}/near — 지번 주소 + 정확한 lat/lng (수집기에서 _near로 보존).
    // detail의 address가 dong-level까지만 오는 한계를 보완.
    const near = mergedRow?._near?.result || null;
    if (near) {
      if (typeof near.address === "string" && near.address.trim()) {
        const j = extractJibunKey(near.address);
        if (j) normalized.jibun_address = j;
      }
      const nLat = Number(near?.location?.lat);
      const nLng = Number(near?.location?.lng);
      if (Number.isFinite(nLat) && Number.isFinite(nLng) && nLat !== 0 && nLng !== 0) {
        normalized.lat = nLat;
        normalized.lng = nLng;
      }
    }

    if (!normalized.jibun_address) {
      const j = extractJibunKey(mergedRow?.address || normalized.address_text);
      if (j) normalized.jibun_address = j;
    }

    // 다방 memo 필드 → description_text
    // base adapter는 10자 미만 텍스트를 제외하지만 다방 memo는 5자 이상이면 유효한 설명으로 취급
    // (list-only 매물에는 memo 없음 — detail 수집 후에만 채워짐)
    if (!normalized.description_text) {
      const memo = mergedRow?.memo;
      if (typeof memo === "string") {
        const trimmed = memo.trim();
        if (trimmed.length >= 5 && !/^\d+[\s/]*\d*$/.test(trimmed)) {
          normalized.description_text = trimmed;
        }
      }
    }

    // 다방 detail의 풍부한 attribute(옵션/안전/관리비/태그 등)를 features JSONB로 보존.
    const features = buildDabangFeatures(mergedRow);
    if (features) normalized.features = features;

    return normalized;
  }
}
