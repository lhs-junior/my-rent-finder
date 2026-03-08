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

  postProcess(item, rawRecord) {
    // source_url이 없거나 kbland 도메인이 아닌 경우 source_ref로 생성
    const sourceRef = item.source_ref || rawRecord?.external_id;
    if (sourceRef && (!item.source_url || !item.source_url.includes("kbland.kr"))) {
      item.source_url = `https://kbland.kr/p/${sourceRef}`;
    }
    // rawRecord에 source_url이 있으면 우선 사용
    if (rawRecord?.source_url && rawRecord.source_url.includes("kbland.kr")) {
      item.source_url = rawRecord.source_url;
    }
    return item;
  }
}
