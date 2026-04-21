#!/usr/bin/env node

import { BaseUserOnlyAdapter } from "./user_only_listing_adapter.mjs";
import { normalizeListedAt } from "../lib/listed_at_normalizer.mjs";

const KBLAND_FIELD_HINTS = {
  sourceRefKeys: ["매물일련번호", "external_id", "id"],
  titleKeys: ["buildingName", "title"],
  addressKeys: ["address", "address_text"],
  addressDongKeys: ["dong", "dongName"],
  leaseTypeKeys: ["dealType", "lease_type"],
  rentKeys: ["rent", "rent_amount"],
  depositKeys: ["deposit", "deposit_amount"],
  areaExclusiveKeys: ["area", "area_exclusive_m2"],
  areaGrossKeys: ["supplyArea", "area_gross_m2"],
  // rooms: 개별 매물 방수 (1~3이 99.5%), 5이상은 건물 총합이므로 post-processing에서 cap
  roomCountKeys: ["room_count", "rooms"],
  bathroomCountKeys: ["bathroomCount", "bathroom_count"],
  floorKeys: ["floor"],
  totalFloorKeys: ["totalFloor", "total_floor"],
  buildingUseKeys: ["propertyType", "building_use"],
  latKeys: ["lat", "latitude"],
  lngKeys: ["lng", "longitude"],
  imageKeys: ["imageUrls", "image_urls"],
  salePriceKeys: ["salePrice", "dealAmount", "price"],
  loanAmountKeys: ["loanAmount", "loan"],
  buildingYearKeys: ["approveDate", "useApproveYmd", "buildYear", "builtYear"],
  descriptionKeys: ["description"],
  listHintPaths: ["payload_json"],
};

function extractKblandJibunAddress(address) {
  if (!address) return null;
  const parts = String(address).trim().split(/\s+/);
  if (parts.length < 2) return null;
  const lot = parts[parts.length - 1];
  const dong = parts[parts.length - 2];
  if (!/^\d+(?:-\d+)*$/.test(lot)) return null;
  if (!/(?:동|가|리)\d*$/.test(dong)) return null;
  return `${dong} ${lot}`;
}

function fixBuildingUse(propertyType) {
  if (!propertyType) return null;
  if (/연립|빌라/.test(propertyType)) return "빌라/연립";
  if (/다가구|단독/.test(propertyType)) return "단독/다가구";
  if (/오피스텔/.test(propertyType)) return "오피스텔";
  return null;
}

export class KblandListingAdapter extends BaseUserOnlyAdapter {
  constructor(options = {}) {
    super({
      platformCode: "kbland",
      platformName: "KB부동산",
      collectionMode: "STEALTH_AUTOMATION",
      fieldHints: KBLAND_FIELD_HINTS,
      options,
    });
    this.notes = ["KB부동산 raw 정규화 파서 연결 완료"];
  }

  normalizeFromRawRecord(rawRecord) {
    const results = super.normalizeFromRawRecord(rawRecord);
    const payload = rawRecord?.payload_json || rawRecord;
    const propertyType = payload?.propertyType;
    const correctedBuildingUse = fixBuildingUse(propertyType);

    return results.map((item) => {
      // source_url 보정
      const sourceRef = item.source_ref || rawRecord?.external_id;
      if (sourceRef && (!item.source_url || !item.source_url.includes("kbland.kr"))) {
        item.source_url = `https://kbland.kr/p/${sourceRef}`;
      }
      if (rawRecord?.source_url && rawRecord.source_url.includes("kbland.kr")) {
        item.source_url = rawRecord.source_url;
      }

      // building_use 보정 (parseBuildingUseFallback의 "연립/다세대" 오매핑 수정)
      if (correctedBuildingUse) {
        item.building_use = correctedBuildingUse;
      }

      // rooms > 4이면 건물 총합이므로 null 처리
      if (item.room_count != null && item.room_count > 4) {
        item.room_count = null;
      }

      if (!item.jibun_address) {
        const raw = rawRecord?.payload_json || rawRecord;
        item.jibun_address = extractKblandJibunAddress(raw?.address || item.address_text);
      }

      // listed_at: base adapter가 반환하지 않으므로 registeredDate에서 직접 설정
      if (!item.listed_at) {
        const regDate = payload?.registeredDate || payload?.registered_date;
        if (regDate) item.listed_at = normalizeListedAt(regDate) || null;
      }

      // agent_name: base adapter가 반환하지 않으므로 agencyName에서 직접 설정
      if (!item.agent_name) {
        item.agent_name = payload?.agencyName || payload?.agent_name || null;
      }

      // total_floor: parseFloor(숫자) → total_floor: null 이므로 totalFloor에서 직접 보정
      if (item.total_floor == null) {
        const tf = payload?.totalFloor ?? payload?.total_floor;
        if (tf != null) {
          const n = parseInt(tf, 10);
          if (Number.isFinite(n) && n > 0) item.total_floor = n;
        }
      }

      return item;
    });
  }
}
