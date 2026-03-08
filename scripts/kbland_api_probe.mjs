#!/usr/bin/env node
/**
 * KB부동산 API Probe 스크립트
 *
 * propList/filter API에 직접 fetch로 접근 가능한지 검증한다.
 * 성공 시 recommended_approach: "direct_fetch"
 * 실패 시 recommended_approach: "stealth_playwright" (수동 전환 필요)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CLI 인자
const args = process.argv.slice(2);
function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}

const sigungu = getArg("--sigungu", "노원구");

// 구별 좌표
const DISTRICTS = {
  노원구: { lat: 37.6542, lng: 127.0568, bbox: { sLat: 37.625, sLng: 127.03, eLat: 37.69, eLng: 127.085 } },
  중랑구: { lat: 37.6063, lng: 127.0925, bbox: { sLat: 37.58, sLng: 127.06, eLat: 37.63, eLng: 127.11 } },
  동대문구: { lat: 37.5744, lng: 127.0395, bbox: { sLat: 37.555, sLng: 127.015, eLat: 37.6, eLng: 127.065 } },
};

const KB_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Content-Type": "application/json",
  Referer: "https://kbland.kr/",
  Origin: "https://kbland.kr",
};

async function probeDirectFetch(district) {
  const d = DISTRICTS[district] || DISTRICTS["노원구"];
  const body = {
    물건종류: "08,38,09",
    거래유형: "3",
    위도: d.lat,
    경도: d.lng,
    남서위도: d.bbox.sLat,
    남서경도: d.bbox.sLng,
    북동위도: d.bbox.eLat,
    북동경도: d.bbox.eLng,
    보증금종료값: "6000",
    월세종료값: "80",
    면적시작값: "40",
    페이지목록수: 10,
    페이지번호: 1,
  };

  console.log("[1] Direct fetch 시도: POST https://api.kbland.kr/land-property/propList/filter");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch("https://api.kbland.kr/land-property/propList/filter", {
      method: "POST",
      headers: KB_HEADERS,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const statusCode = res.status;
    console.log(`    → HTTP ${statusCode}`);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        method: "direct_fetch",
        success: false,
        statusCode,
        listingCount: 0,
        error: `HTTP ${statusCode}: ${text.substring(0, 200)}`,
      };
    }

    const json = await res.json();
    const listings = json?.dataBody?.data?.propertyList || json?.dataBody?.data?.list || [];
    const listingCount = Array.isArray(listings) ? listings.length : 0;

    console.log(`    → 매물 ${listingCount}건`);
    return {
      method: "direct_fetch",
      success: listingCount > 0,
      statusCode,
      listingCount,
      error: null,
      responseKeys: Object.keys(json?.dataBody?.data || {}),
    };
  } catch (err) {
    console.log(`    → 실패: ${err.message}`);
    return { method: "direct_fetch", success: false, statusCode: 0, listingCount: 0, error: err.message };
  }
}

async function probeDetailApi() {
  console.log("[2] 상세 API 검증: GET https://api.kbland.kr/land-property/property/dtailInfo");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const url = `https://api.kbland.kr/land-property/property/dtailInfo?${encodeURIComponent("매물일련번호")}=216183784`;
    const res = await fetch(url, {
      headers: { ...KB_HEADERS, "Content-Type": undefined },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const statusCode = res.status;
    console.log(`    → HTTP ${statusCode}`);

    if (!res.ok) {
      return { method: "detail_api", success: false, statusCode, error: `HTTP ${statusCode}` };
    }

    const json = await res.json();
    const hasData = !!json?.dataBody?.data?.dtailInfo;
    console.log(`    → 상세 데이터 ${hasData ? "있음" : "없음"}`);
    return { method: "detail_api", success: hasData, statusCode, error: null };
  } catch (err) {
    console.log(`    → 실패: ${err.message}`);
    return { method: "detail_api", success: false, statusCode: 0, error: err.message };
  }
}

async function main() {
  console.log("=== KB부동산 API Probe ===");
  console.log(`구: ${sigungu}\n`);

  const probes = [];

  // 1. 상세 API 검증 (기준점)
  const detailResult = await probeDetailApi();
  probes.push(detailResult);

  // 2. propList/filter 직접 fetch
  const directResult = await probeDirectFetch(sigungu);
  probes.push(directResult);

  // 추천 방식 결정
  let recommended_approach;
  if (directResult.success) {
    recommended_approach = "direct_fetch";
  } else if (detailResult.success) {
    // 상세 API는 되지만 propList/filter는 안 됨 → stealth playwright 필요
    recommended_approach = "stealth_playwright";
  } else {
    // 둘 다 안 됨 → CDP 방식 (기존)
    recommended_approach = "cdp_intercept";
  }

  const report = {
    recommended_approach,
    timestamp: new Date().toISOString(),
    sigungu,
    probes,
    summary: {
      detail_api_works: detailResult.success,
      proplist_filter_works: directResult.success,
      listing_count: directResult.listingCount,
    },
  };

  console.log(`\n=== 결과 ===`);
  console.log(`추천 방식: ${recommended_approach}`);
  console.log(`상세 API: ${detailResult.success ? "✓" : "✗"}`);
  console.log(`propList/filter: ${directResult.success ? `✓ (${directResult.listingCount}건)` : "✗"}`);

  // 리포트 저장
  const reportPath = path.join(__dirname, "kbland_probe_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n리포트 저장: ${reportPath}`);

  // evidence 복사
  const evidenceDir = path.join(__dirname, "../.sisyphus/evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "task-1-probe-report.json"), JSON.stringify(report, null, 2));
  console.log(`evidence 저장: .sisyphus/evidence/task-1-probe-report.json`);
}

main().catch((err) => {
  console.error("Probe 실패:", err);
  process.exit(1);
});
