#!/usr/bin/env node

import { BaseUserOnlyAdapter } from "./user_only_listing_adapter.mjs";

export class R114ListingAdapter extends BaseUserOnlyAdapter {
  constructor(options = {}) {
    super({
      platformCode: "r114",
      platformName: "부동산114",
      collectionMode: "STEALTH_AUTOMATION",
      fieldHints: {
        sourceRefKeys: [
          "articleId",
          "article_id",
          "id",
          "_id",
          "propertyId",
          "listingId",
        ],
        titleKeys: [
          "title",
          "articleTitle",
          "subject",
          "name",
          "itemTitle",
        ],
        addressKeys: [
          "address",
          "address_text",
          "addr",
          "addressText",
          "fullAddress",
          "roadAddress",
          "jibunAddress",
        ],
        rentKeys: ["rent", "monthlyRent", "rentPrice", "월세", "월세금액"],
        depositKeys: ["deposit", "depositPrice", "보증금", "보증금금액"],
        areaExclusiveKeys: ["area", "exclusiveArea", "spc1", "전용면적", "areaExclusive"],
        areaGrossKeys: ["area2", "grossArea", "supplyArea", "spc2", "공급면적"],
        imageKeys: [
          "thumb",
          "thumbnail",
          "images",
          "imgList",
          "imageList",
          "photo",
          "photoUrl",
        ],
        directionKeys: [
          "direction",
          "direction_text",
          "facing",
          "roomDirection",
          "houseDirection",
          "buildingDirection",
        ],
        buildingUseKeys: [
          "building_type",
          "buildingType",
          "house_type",
          "houseType",
          "houseTypeNm",
          "building_use",
          "buildingUse",
          "propertyType",
          "property_type",
        ],
      },
      options,
    });
    this.notes = [
      "부동산114 STEALTH raw 구조에 대한 정규화 파서 적용",
    ];
  }
}
