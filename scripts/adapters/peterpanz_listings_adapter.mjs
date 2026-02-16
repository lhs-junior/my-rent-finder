#!/usr/bin/env node

import { BaseUserOnlyAdapter } from "./user_only_listing_adapter.mjs";

export class PeterpanzListingAdapter extends BaseUserOnlyAdapter {
  constructor(options = {}) {
    super({
      platformCode: "peterpanz",
      platformName: "피터팬",
      collectionMode: "STEALTH_AUTOMATION",
      fieldHints: {
        sourceRefKeys: ["hidx"],
        titleKeys: ["subject"],
        addressKeys: ["text"],
        rentKeys: ["monthly_fee"],
        depositKeys: ["deposit"],
        areaExclusiveKeys: ["real_size"],
        areaGrossKeys: ["supplied_size"],
        imageKeys: ["images", "thumbnail"],
      },
      options,
    });
    this.notes = [
      "피터팬 /houses/area/pc API 응답 구조에 맞춘 정규화",
      "가격은 원 단위 → 만원 변환 필요",
    ];
  }

  /**
   * PeterPanz payload is a single well-structured house object.
   * Override to skip collectCandidates walk which creates duplicate rows
   * from nested sub-objects (images, floor, etc.).
   */
  normalizeFromRawRecord(rawRecord) {
    const raw = rawRecord?.payload_json || rawRecord;
    if (!raw || !raw.hidx) return [];

    const addr = raw.location?.address;
    const addrText = addr
      ? [addr.sido, addr.sigungu, addr.dong].filter(Boolean).join(" ") || addr.text
      : null;

    const imageUrls = raw.images?.S
      ? raw.images.S.map((img) => img.path).filter(Boolean)
      : raw.info?.thumbnail
        ? [raw.info.thumbnail]
        : [];

    const item = {
      platform_code: "peterpanz",
      source_ref: String(raw.hidx),
      source_url: rawRecord?.source_url || `https://www.peterpanz.com/house/${raw.hidx}`,
      title: raw.info?.subject || null,
      address_text: addrText,
      lease_type: raw.type?.contract_type || null,
      rent_amount: raw.price?.monthly_fee != null ? Math.round(raw.price.monthly_fee / 10000) : null,
      deposit_amount: raw.price?.deposit != null ? Math.round(raw.price.deposit / 10000) : null,
      maintenance_cost: raw.price?.maintenance_cost != null ? Math.round(raw.price.maintenance_cost / 10000) : null,
      area_exclusive_m2: raw.info?.real_size || null,
      area_gross_m2: raw.info?.supplied_size || null,
      floor: raw.floor?.target ?? null,
      total_floor: raw.floor?.total ?? null,
      direction: raw.info?.direction || raw.info?.facing || raw.info?.houseDirection || null,
      building_use: raw.type?.building_type_text || raw.type?.buildingType || raw.type?.house_type || null,
      room_count: raw.info?.room_count ?? null,
      room_type: raw.info?.room_type || null,
      building_type: raw.type?.building_type_text || null,
      latitude: raw.location?.coordinate?.latitude ? parseFloat(raw.location.coordinate.latitude) : null,
      longitude: raw.location?.coordinate?.longitude ? parseFloat(raw.location.coordinate.longitude) : null,
      image_urls: imageUrls,
    };

    return [item];
  }
}
