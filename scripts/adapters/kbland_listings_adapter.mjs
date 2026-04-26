#!/usr/bin/env node

import { BaseUserOnlyAdapter } from "./user_only_listing_adapter.mjs";
import { normalizeListedAt } from "../lib/listed_at_normalizer.mjs";

// bbox 경계에서 인접 구 매물이 수집될 때 동 이름 기준으로 실제 구를 교정하기 위한 매핑
// 법정동 기준 (동 이름 → 실제 구)
const SEOUL_DONG_TO_GU = {
  // 광진구
  "자양동": "광진구", "구의동": "광진구", "군자동": "광진구", "능동": "광진구",
  "광장동": "광진구", "화양동": "광진구", "중곡동": "광진구", "송정동": "광진구",
  // 동대문구
  "신설동": "동대문구", "용두동": "동대문구", "제기동": "동대문구", "전농동": "동대문구",
  "답십리동": "동대문구", "장안동": "동대문구", "청량리동": "동대문구", "회기동": "동대문구",
  "이문동": "동대문구", "휘경동": "동대문구",
  // 중랑구
  "면목동": "중랑구", "묵동": "중랑구", "상봉동": "중랑구", "망우동": "중랑구",
  "중화동": "중랑구", "신내동": "중랑구",
  // 성북구
  "성북동": "성북구", "삼선동": "성북구", "동선동": "성북구", "안암동": "성북구",
  "보문동": "성북구", "정릉동": "성북구", "길음동": "성북구", "종암동": "성북구",
  "월곡동": "성북구", "장위동": "성북구", "석관동": "성북구", "돈암동": "성북구",
  // 강북구
  "미아동": "강북구", "번동": "강북구", "수유동": "강북구", "우이동": "강북구",
  // 도봉구
  "쌍문동": "도봉구", "방학동": "도봉구", "창동": "도봉구", "도봉동": "도봉구",
  // 노원구
  "월계동": "노원구", "공릉동": "노원구", "하계동": "노원구", "중계동": "노원구", "상계동": "노원구",
  // 성동구
  "마장동": "성동구", "사근동": "성동구", "행당동": "성동구", "응봉동": "성동구",
  "금호동": "성동구", "옥수동": "성동구", "성수동": "성동구", "용답동": "성동구",
  "하왕십리동": "성동구", "상왕십리동": "성동구", "왕십리동": "성동구",
  // 서대문구
  "북아현동": "서대문구", "홍은동": "서대문구", "홍제동": "서대문구",
  // 용산구
  "서계동": "용산구", "이촌동": "용산구", "이태원동": "용산구", "한남동": "용산구",
  // 중구
  "황학동": "중구", "신당동": "중구",
};

/**
 * dong 이름에서 숫자 접미사를 제거하여 기본 dong 이름을 반환
 * 예: "보문동6가" → "보문동", "삼선동5가" → "삼선동"
 */
function extractBaseDongName(dong) {
  if (!dong) return null;
  return String(dong).replace(/\d+가?$/, "").trim();
}

/**
 * KB부동산 주소 문자열에서 bbox 경계 오류로 인한 잘못된 구를 교정
 * dong 필드를 SEOUL_DONG_TO_GU 매핑으로 검증하고, 불일치 시 주소를 교정
 */
function correctKblandAddress(address, dong) {
  if (!address || !dong) return address;
  const baseDong = extractBaseDongName(dong);
  const correctGu = baseDong ? SEOUL_DONG_TO_GU[baseDong] : null;
  if (!correctGu) return address; // 매핑에 없으면 그대로

  // "서울특별시 X구 Y동..." 패턴에서 구 이름 교정
  const corrected = String(address).replace(
    /(서울특별시\s+)([가-힣]+구)(\s+)/,
    (_, prefix, gu, suffix) => {
      if (gu !== correctGu) {
        return `${prefix}${correctGu}${suffix}`;
      }
      return _;
    }
  );
  return corrected;
}

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

      // bbox 경계 오류 교정: dong 기준으로 실제 구 검증 후 주소 교정
      const rawDong = payload?.dong || payload?.dongName;
      if (rawDong && item.address_text) {
        item.address_text = correctKblandAddress(item.address_text, rawDong);
      }

      if (!item.jibun_address) {
        const raw = rawRecord?.payload_json || rawRecord;
        const baseAddress = correctKblandAddress(raw?.address || item.address_text, rawDong);
        item.jibun_address = extractKblandJibunAddress(baseAddress);
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
