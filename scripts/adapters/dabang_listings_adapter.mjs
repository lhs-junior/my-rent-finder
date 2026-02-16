#!/usr/bin/env node

import { BaseUserOnlyAdapter } from "./user_only_listing_adapter.mjs";

export class DabangListingAdapter extends BaseUserOnlyAdapter {
  constructor(options = {}) {
    super({
      platformCode: "dabang",
      platformName: "다방",
      collectionMode: "STEALTH_AUTOMATION",
      fieldHints: {
        sourceRefKeys: [
          "id",
          "articleId",
          "article_id",
          "articleNo",
          "room_id",
          "listingId",
          "_id",
        ],
        titleKeys: [
          "title",
          "itemTitle",
          "articleTitle",
          "subject",
          "name",
          "desc",
          "room_desc",
        ],
        addressKeys: [
          "address",
          "address_text",
          "addr",
          "addressText",
          "fullAddress",
          "roadAddress",
          "jibunAddress",
          "room_address",
        ],
        rentKeys: [
          "rent",
          "rentPrice",
          "monthlyRent",
          "월세",
          "월세금액",
          "depositRent",
          "price_info.monthly_rent",
          "price_info.rent",
        ],
        depositKeys: [
          "deposit",
          "depositPrice",
          "보증금",
          "보증금금액",
          "price_info.deposit",
        ],
        areaExclusiveKeys: [
          "area",
          "exclusiveArea",
          "spc1",
          "전용면적",
          "areaExclusive",
          "room_area.exclusive_m2",
          "exclusive_m2",
        ],
        areaGrossKeys: [
          "area2",
          "areaGross",
          "supplyArea",
          "spc2",
          "공급면적",
          "grossArea",
          "room_area.supply_m2",
          "supply_m2",
        ],
        imageKeys: [
          "thumb",
          "thumbnail",
          "images",
          "imageList",
          "imgList",
          "photo",
          "photoUrl",
          "room_images",
        ],
        directionKeys: [
          "direction",
          "direction_text",
          "facing",
          "sunlight_direction",
          "roomDirection",
          "room_direction",
        ],
        buildingUseKeys: [
          "building_type",
          "buildingType",
          "building_type_name",
          "house_type",
          "houseType",
          "houseTypeNm",
          "use_type",
          "useType",
        ],
      },
      options,
    });
    this.notes = [
      "다방 V5 API 구조(room_area, price_info 등)에 대한 필드 힌트 강화",
      "roomDesc(면적), priceTitle(보증금/알세) 문자열 파싱 로직 추가",
    ];
  }

  postProcess(item, rawRecord) {
    const raw = rawRecord.payload_json || rawRecord;
    const listData = rawRecord.list_data || raw;

    // 1. 가격 파싱 (priceTitle: "500/45", "1억5000/70", "3억/30")
    const priceTitle = listData.priceTitle || raw.priceTitle;
    if (
      (item.rent_amount === null || item.deposit_amount === null) &&
      priceTitle
    ) {
      const match = priceTitle.match(/^([0-9억,.]+)\s*\/\s*([0-9,.]+)$/);
      if (match) {
        // Parse deposit: handle 억 unit (1억5000 = 15000만원)
        if (item.deposit_amount === null) {
          let depositStr = match[1];
          const ukMatch = depositStr.match(/(\d+)억\s*(\d*)/);
          if (ukMatch) {
            let dep = parseInt(ukMatch[1], 10) * 10000;
            if (ukMatch[2]) dep += parseInt(ukMatch[2], 10);
            item.deposit_amount = dep;
          } else {
            item.deposit_amount = parseFloat(depositStr.replace(/,/g, ""));
          }
        }
        if (item.rent_amount === null) {
          item.rent_amount = parseFloat(match[2].replace(/,/g, ""));
        }
      }
    }

    // 2. 면적 파싱 (roomDesc: "고층, 10.15m², 관리비 7만" -> area 10.15)
    const roomDesc = listData.roomDesc || raw.roomDesc;
    if (item.area_exclusive_m2 === null && roomDesc) {
      const areaMatch = roomDesc.match(/([0-9,.]+)\s*m²/);
      if (areaMatch) {
        item.area_exclusive_m2 = parseFloat(areaMatch[1].replace(/,/g, ""));
      }
    }

    // 3. 주소 생성: dongName + sigungu → "서울특별시 {구} {동}"
    if (!item.address_text) {
      const dongName = listData.dongName || raw.dongName;
      const sigungu = rawRecord.sigungu;
      if (dongName && sigungu) {
        item.address_text = `서울특별시 ${sigungu} ${dongName}`;
      } else if (dongName) {
        item.address_text = `서울특별시 ${dongName}`;
      }
    }

    // 4. 이미지 URL (imgUrlList -> image_urls)
    const imgList = listData.imgUrlList || raw.imgUrlList;
    if (
      (!item.image_urls || item.image_urls.length === 0) &&
      Array.isArray(imgList)
    ) {
      item.image_urls = imgList;
    }

    // 5. 제목 (roomTitle)
    if (!item.title) {
      item.title = listData.roomTitle || raw.roomTitle || null;
    }

    return item;
  }
}
