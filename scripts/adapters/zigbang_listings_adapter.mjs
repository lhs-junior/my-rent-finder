#!/usr/bin/env node

import { BaseUserOnlyAdapter } from "./user_only_listing_adapter.mjs";

export class ZigbangListingAdapter extends BaseUserOnlyAdapter {
  constructor(options = {}) {
    super({
      platformCode: "zigbang",
      platformName: "직방",
      collectionMode: "STEALTH_AUTOMATION",
      fieldHints: {
        sourceRefKeys: [
          "articleId",
          "article_id",
          "listingId",
          "id",
          "_id",
          "itemNo",
        ],
        titleKeys: ["itemTitle", "title", "articleTitle", "subject", "headline", "name"],
        addressKeys: [
          "addr",
          "address",
          "addressText",
          "address_text",
          "fullAddress",
          "roadAddress",
          "도로명주소",
        ],
        rentKeys: [
          "rentPrice",
          "rent",
          "monthlyRent",
          "월세",
          "월세금액",
          "depositRent",
        ],
        depositKeys: ["depositPrice", "deposit", "보증금", "보증금금액", "depositFee"],
        areaExclusiveKeys: ["area", "exclusiveArea", "spc1", "전용면적", "exclusiveAreaM2"],
        areaGrossKeys: ["area2", "supplyArea", "grossArea", "spc2", "공급면적"],
        imageKeys: [
          "thumbNail",
          "thumbnail",
          "images",
          "imgList",
          "imageList",
          "photo",
        ],
        directionKeys: [
          "direction",
          "direction_text",
          "facing",
          "houseDir",
          "houseDirection",
          "buildingDirection",
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
        ],
      },
      options,
    });
    this.notes = [
      "직방 STEALTH raw 구조에 대한 정규화 파서 적용",
    ];
  }
}
