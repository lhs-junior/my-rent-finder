#!/usr/bin/env node

import { BaseUserOnlyAdapter } from "./user_only_listing_adapter.mjs";

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
  roomCountKeys: ["rooms", "room_count"],
  floorKeys: ["floor"],
  totalFloorKeys: ["totalFloor", "total_floor"],
  buildingUseKeys: ["propertyType", "building_use"],
  latKeys: ["lat", "latitude"],
  lngKeys: ["lng", "longitude"],
  imageKeys: ["imageUrls", "image_urls"],
  listHintPaths: ["payload_json"],
};

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

      return item;
    });
  }
}
