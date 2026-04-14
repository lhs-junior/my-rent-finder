#!/usr/bin/env node

/**
 * 부동산써브 (serve.co.kr) Listing Adapter
 *
 * serve.co.kr getAtclList API 응답을 normalized_listings 스키마로 변환.
 * BaseListingAdapter를 상속하여 normalizeFromRawRecord()을 직접 구현.
 */

import { BaseListingAdapter, normalizeDirection } from "./base_listing_adapter.mjs";

export class ServeListingAdapter extends BaseListingAdapter {
  constructor(options = {}) {
    super({
      platformCode: "serve",
      platformName: "부동산써브",
      collectionMode: "DIRECT_FETCH",
      options,
    });
  }

  /**
   * serve.co.kr payload → normalized item 배열
   *
   * 필드 매핑:
   *   atclNo → source_ref
   *   sidoNm+sggNm+emdNm → address_text
   *   bscTnthWuntAmt → deposit_amount (만원)
   *   addTnthWuntAmt → rent_amount (만원)
   *   area1 → area_gross_m2
   *   area2 → area_exclusive_m2
   *   laCrd/loCrd → lat/lng
   *   flr1/flr2 → floor/total_floor
   *   roomNcnt/toilCnt → room_count/bathroom_count
   *   drcCdNm → direction
   *   ctgryCd2Nm → building_use
   *   photoList[].imageData → image_urls
   */
  normalizeFromRawRecord(rawRecord) {
    const raw = rawRecord?.payload_json || rawRecord;
    if (!raw || !raw.atclNo) return [];

    // 월세만 처리
    if (raw.dealKindCd && raw.dealKindCd !== "B2") return [];

    const atclNo = String(raw.atclNo);

    // 주소 조합
    const addrParts = [raw.sidoNm, raw.sggNm, raw.emdNm].filter(Boolean);
    const addressText = addrParts.join(" ") || null;

    // 가격 (만원 단위 그대로)
    const deposit = parseIntSafe(raw.bscTnthWuntAmt);
    const rent = parseIntSafe(raw.addTnthWuntAmt);

    // 면적
    const areaGross = parseFloatSafe(raw.area1);
    const areaExclusive = parseFloatSafe(raw.area2);

    // 좌표
    const lat = parseFloatSafe(raw.laCrd);
    const lng = parseFloatSafe(raw.loCrd);

    // 층수
    const floor = parseIntSafe(raw.flr1);
    const totalFloor = parseIntSafe(raw.flr2);

    // 방/화장실
    const roomCount = parseIntSafe(raw.roomNcnt);
    const bathroomCount = parseIntSafe(raw.toilCnt);

    // 방향
    const direction = normalizeDirection(raw.drcCdNm || raw.drcCd);

    // 이미지 — photoList[].imageData 또는 expsrImgFileUrl
    const imageUrls = extractImageUrls(raw);

    // 건축일
    const builtDate = raw.bldDt || null;

    // 관리비
    const maintenanceCost = parseIntSafe(raw.mmMcost);

    const item = {
      platform_code: "serve",
      source_ref: atclNo,
      source_url: rawRecord?.source_url || `https://www.serve.co.kr/good/map?m=2&atcl=${atclNo}`,
      title: raw.atclSfeCn || null,
      address_text: addressText,
      lease_type: "월세",
      rent_amount: rent,
      deposit_amount: deposit,
      maintenance_cost: maintenanceCost,
      area_exclusive_m2: areaExclusive,
      area_gross_m2: areaGross,
      floor,
      total_floor: totalFloor,
      direction,
      building_use: raw.ctgryCd2Nm || null,
      room_count: roomCount,
      bathroom_count: bathroomCount,
      lat,
      lng,
      image_urls: imageUrls,
      built_date: builtDate,
      cross_ref: raw.naverAtclNo ? String(raw.naverAtclNo) : null,
      meta: {
        naverAtclNo: raw.naverAtclNo || null,
        ctgryCd1: raw.ctgryCd1 || null,
        ctgryCd2: raw.ctgryCd2 || null,
        grade: raw.grade || null,
        agentName: raw.mdiatBzestNm || null,
        agentTel: raw.mdiatBzestRepTelno || null,
        regDate: raw.atclRegDttm || null,
      },
    };

    return [item];
  }
}

// ============================================================================
// Helpers
// ============================================================================

function parseIntSafe(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloatSafe(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function extractImageUrls(raw) {
  const urls = [];

  // photoList 우선
  if (Array.isArray(raw.photoList)) {
    for (const photo of raw.photoList) {
      const url = photo?.imageData;
      if (url && typeof url === "string" && url.startsWith("http")) {
        urls.push(url);
      }
    }
  }

  // photoList가 없으면 expsrImgFileUrl 사용 (프로필 이미지일 수 있으므로 후순위)
  // expsrImgFileUrl은 보통 중개사 프로필이므로 photoList가 없을 때만

  return urls;
}
