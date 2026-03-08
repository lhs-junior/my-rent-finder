#!/usr/bin/env node

/**
 * KB부동산 자동 수집기 v4
 *
 * 전략:
 *   1) Chrome CDP로 기존 kbland.kr 탭 연결 (새 탭/창 안 열음)
 *   2) 지도 페이지 이동 → Vuex markerMaemulList에서 클러스터 ID 획득
 *   3) /cl/{클러스터ID} 이동 → site가 propList/filter 호출
 *   4) page.route() 인터셉트로 필터 변경 (물건종류=08,38 + 월세)
 *   5) 응답에서 propertyList 추출 (매물일련번호 + 전체 상세)
 *
 * Chrome 디버깅 모드 실행 필수:
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-debug-profile"
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// ── CLI 인자 ──
const args = process.argv.slice(2);
function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}
const hasFlag = (name) => args.includes(name);

const sigungu = getArg("--sigungu", "노원구");
const sampleCap = Number(getArg("--sample-cap", "200"));
const rentMax = Number(getArg("--rent-max", "80"));
const depositMax = Number(getArg("--deposit-max", "6000"));
const minAreaM2 = Number(getArg("--min-area", "40"));
const verbose = hasFlag("--verbose");

// ── 구별 좌표 + 바운딩박스 ──
const DISTRICTS = {
  노원구: { lat: 37.6542, lng: 127.0568, bbox: { sLat: 37.625, sLng: 127.030, eLat: 37.690, eLng: 127.085 } },
  중랑구: { lat: 37.6063, lng: 127.0925, bbox: { sLat: 37.580, sLng: 127.060, eLat: 37.630, eLng: 127.110 } },
  동대문구: { lat: 37.5744, lng: 127.0395, bbox: { sLat: 37.555, sLng: 127.015, eLat: 37.600, eLng: 127.065 } },
  광진구: { lat: 37.5384, lng: 127.0823, bbox: { sLat: 37.525, sLng: 127.060, eLat: 37.560, eLng: 127.105 } },
  성북구: { lat: 37.5894, lng: 127.0164, bbox: { sLat: 37.570, sLng: 126.990, eLat: 37.615, eLng: 127.040 } },
  성동구: { lat: 37.5633, lng: 127.0371, bbox: { sLat: 37.545, sLng: 127.010, eLat: 37.580, eLng: 127.065 } },
  중구: { lat: 37.5641, lng: 126.9979, bbox: { sLat: 37.550, sLng: 126.975, eLat: 37.580, eLng: 127.020 } },
  종로구: { lat: 37.5735, lng: 126.9790, bbox: { sLat: 37.560, sLng: 126.955, eLat: 37.600, eLng: 127.005 } },
};

// KB부동산 propList/filter 물건종류 코드
// 08=빌라(연립/다세대), 38=다가구주택, 09=단독주택, 34=원룸, 35=투룸
const PROPERTY_TYPE_CODES = "08,38,09";
const DEAL_TYPE_CODE = "3"; // 월세

// ── 지도 페이지에서 클러스터 목록 가져오기 ──
async function getClusters(page, district) {
  const d = DISTRICTS[district];
  if (!d) throw new Error(`Unknown district: ${district}`);

  // 지도 페이지로 이동
  const mapUrl = `https://kbland.kr/map?xy=${d.lat},${d.lng},15`;
  await page.goto(mapUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(6000);

  // Vuex에서 클러스터 추출
  const clusters = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    const list = vm?.$store?.state?.map?.markerMaemulList || [];
    return list.map(m => ({
      id: m.클러스터식별자,
      count: m.매물개수,
      lat: m.wgs84위도,
      lng: m.wgs84경도,
    })).filter(c => c.id && c.count > 0)
      .sort((a, b) => b.count - a.count);
  });

  return clusters;
}

// ── propList/filter 인터셉트 + /cl/ 네비게이션으로 매물 수집 ──
async function fetchClusterListings(page, clusterId, lat, lng) {
  const collected = [];
  let capturedStatus = 200;

  // route 인터셉터: propList/filter body를 우리 필터로 변경
  await page.route("**/propList/filter", async (route) => {
    let handled = false;
    try {
      const origBody = route.request().postData();
      const bodyObj = JSON.parse(origBody);
      // 빌라/다가구 + 월세 필터로 변경
      bodyObj["물건종류"] = PROPERTY_TYPE_CODES;
      bodyObj["거래유형"] = DEAL_TYPE_CODE;
      bodyObj["보증금종료값"] = String(depositMax);
      bodyObj["월세종료값"] = String(rentMax);
      bodyObj["면적시작값"] = String(minAreaM2);
      bodyObj["페이지목록수"] = 100; // 최대한 많이
      const modifiedBody = JSON.stringify(bodyObj);

      // 수정된 body로 원본 서버에 요청
      const response = await route.fetch({ postData: modifiedBody });
      capturedStatus = response.status();
      const text = await response.text();

      // 응답 파싱 + 수집
      try {
        const json = JSON.parse(text);
        const data = json?.dataBody?.data;
        if (data?.propertyList) {
          collected.push(...data.propertyList);
          if (data.총매물건수 > data.propertyList.length) {
            console.warn(`     ⚠ 페이지네이션 필요: 총${data.총매물건수}건 중 ${data.propertyList.length}건만 반환됨 (cluster ${clusterId})`);
          }
        }
      } catch (parseErr) {
        console.warn(`     ⚠ 응답 파싱 실패 (cluster ${clusterId}): ${parseErr.message}`);
      }

      // 원본 응답 그대로 전달 (사이트 UI 깨지지 않게)
      await route.fulfill({ response });
      handled = true;
    } catch (e) {
      if (!handled) {
        try { await route.continue(); } catch {}
      }
    }
  });

  // /cl/ 페이지로 이동 → 사이트가 propList/filter 자동 호출
  try {
    await page.goto(
      `https://kbland.kr/cl/${clusterId}?xy=${lat},${lng},17`,
      { waitUntil: "domcontentloaded", timeout: 20000 }
    );
    await page.waitForTimeout(3000);
  } catch (navErr) {
    console.warn(`     ⚠ 네비게이션 실패 (cluster ${clusterId}): ${navErr.message}`);
  }

  // 인터셉터 해제
  await page.unroute("**/propList/filter");

  return { listings: collected, status: capturedStatus };
}

// ── 매물 이미지 URL 수집 (phtoList API) ──
async function fetchImageUrls(page, listingId) {
  try {
    const url = `https://api.kbland.kr/land-property/property/phtoList?${encodeURIComponent("매물일련번호")}=${listingId}`;
    const result = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return await r.json();
    }, url);
    const photos = result?.dataBody?.data?.psalePhtoList || [];
    return photos
      .map((p) => p["전체이미지경로"])
      .filter((u) => typeof u === "string" && u.startsWith("http"));
  } catch (e) {
    console.warn(`     ⚠ 이미지 조회 실패 (${listingId}): ${e.message}`);
    return [];
  }
}

// ── 매물 상세 정보 조회 (방향/욕실/정확면적) ──
const KB_DETAIL_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  Accept: "application/json",
  Referer: "https://kbland.kr/",
};

async function fetchKbDetailInfo(listingId) {
  try {
    const url = `https://api.kbland.kr/land-property/property/dtailInfo?${encodeURIComponent("매물일련번호")}=${listingId}`;
    const res = await fetch(url, { headers: KB_DETAIL_HEADERS });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.dataBody?.data?.dtailInfo || null;
  } catch {
    return null;
  }
}

// ── 층수 파싱 (KB 원본: "B1층"→-1, "3층"→3, "B2층"→-2) ──
function parseFloor(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/층$/, "");
  if (/^B(\d+)$/i.test(s)) return -parseInt(s.slice(1), 10);
  if (/^(저|중간|고)$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

// ── 매물 레코드 → 출력 형식 변환 ──
function toRecord(item, district) {
  const rent = item.월세가 ? parseInt(item.월세가, 10) : null;
  const deposit = item.월세보증금 ? parseInt(item.월세보증금, 10) : null;
  const jeonse = item.전세가 ? parseInt(item.전세가, 10) : null;
  const area = item.전용면적 ? parseFloat(item.전용면적) : null;
  const supplyArea = item.공급면적 ? parseFloat(item.공급면적) : null;

  return {
    매물일련번호: item.매물일련번호,
    매물종별구분명: item.매물종별구분명,
    매물거래구분명: item.매물거래구분명,
    읍면동명: item.읍면동명,
    상세번지: item.상세번지내용 || "",
    건물명: item.건물명 || item.단지명 || "",
    월세가: rent,
    월세보증금: deposit,
    전세가: jeonse,
    전용면적: area,
    공급면적: supplyArea,
    방수: item.방수 ? parseInt(item.방수, 10) : null,
    해당층수: item.해당층수 || null,
    총층수: item.총층수 || item.총지상층수 || null,
    wgs84위도: item.wgs84위도 ? parseFloat(item.wgs84위도) : null,
    wgs84경도: item.wgs84경도 ? parseFloat(item.wgs84경도) : null,
    등록년월일: item.등록년월일 || null,
    중개업소명: item.중개업소명 || null,
    특징광고: item.특징광고내용 ? item.특징광고내용.substring(0, 100) : null,
    이미지수: item.매물이미지개수 ? parseInt(item.매물이미지개수, 10) : 0,
    sigungu: district,
    // 상세 API 보강 필드 (fetchKbDetailInfo 후 병합)
    방향명: null,
    방향기준명: null,
    욕실수: null,
    사용승인일: null,
  };
}

// ── 필터 적용 ──
function applyFilters(records) {
  return records.filter((r) => {
    // 월세만
    if (r.매물거래구분명 && !r.매물거래구분명.includes("월세")) return false;
    // 월세 범위
    if (r.월세가 != null && rentMax > 0 && r.월세가 > rentMax) return false;
    // 보증금 범위
    if (r.월세보증금 != null && depositMax > 0 && r.월세보증금 > depositMax) return false;
    // 면적
    if (r.전용면적 != null && minAreaM2 > 0 && r.전용면적 < minAreaM2) return false;
    return true;
  });
}

// ── JSONL 출력 형식 ──
function toJsonlRecord(record, district) {
  const d = DISTRICTS[district];
  return {
    platform_code: "kbland",
    external_id: String(record.매물일련번호),
    collected_at: new Date().toISOString(),
    source_url: `https://kbland.kr/p/${record.매물일련번호}`,
    request_url: "https://api.kbland.kr/land-property/propList/filter",
    response_status: record._capturedStatus ?? 200,
    sigungu: district,
    payload_json: {
      매물일련번호: record.매물일련번호,
      propertyType: record.매물종별구분명,
      dealType: record.매물거래구분명,
      address: `서울특별시 ${district} ${record.읍면동명} ${record.상세번지}`.trim(),
      dong: record.읍면동명,
      buildingName: record.건물명,
      deposit: record.월세보증금,
      rent: record.월세가,
      jeonse: record.전세가,
      area: record.전용면적,
      supplyArea: record.공급면적,
      rooms: record.방수,
      floor: record.해당층수,
      totalFloor: record.총층수,
      lat: record.wgs84위도,
      lng: record.wgs84경도,
      registeredDate: record.등록년월일,
      agencyName: record.중개업소명,
      description: record.특징광고,
      direction: record.방향명 || null,
      directionCriterion: record.방향기준명 || null,
      bathroomCount: record.욕실수 || null,
      approveDate: record.사용승인일 || null,
      imageCount: record.이미지수,
      imageUrls: record._imageUrls || [],
    },
    image_urls: record._imageUrls || [],
    list_data: {
      priceTitle: `보증금 ${record.월세보증금 ?? "?"}만 / 월세 ${record.월세가 ?? "?"}만`,
      roomTitle: `${record.건물명 || record.매물종별구분명} ${record.읍면동명}`,
      dongName: record.읍면동명,
      propertyType: record.매물종별구분명,
    },
  };
}

// ── 정규화 레코드 (normalized_listings 테이블 호환) ──
function toNormalizedRecord(record, district) {
  const eid = String(record.매물일련번호);
  const address = `서울특별시 ${district} ${record.읍면동명 || ""} ${record.상세번지 || ""}`.trim();
  const buildingType = record.매물종별구분명 || "";
  let buildingUse = "기타";
  if (/빌라|연립/.test(buildingType)) buildingUse = "빌라/연립";
  else if (/단독|다가구|다세대/.test(buildingType)) buildingUse = "단독/다가구";
  else if (/오피스텔/.test(buildingType)) buildingUse = "오피스텔";

  return {
    external_id: eid,
    source_ref: eid,
    source_url: `https://kbland.kr/p/${eid}`,
    title: `${record.건물명 || buildingType} ${record.읍면동명 || ""}`.trim(),
    lease_type: "월세",
    rent_amount: record.월세가 ?? null,
    deposit_amount: record.월세보증금 ?? null,
    area_exclusive_m2: record.전용면적 ?? null,
    area_gross_m2: record.공급면적 ?? null,
    area_claimed: record.전용면적 ? "exclusive" : "estimated",
    address_text: address,
    address_code: "",
    room_count: record.방수 != null ? parseInt(record.방수, 10) : null,
    floor: parseFloor(record.해당층수),
    total_floor: parseFloor(record.총층수),
    building_use: buildingUse,
    building_name: record.건물명 || null,
    direction: record.방향명 || null,
    bathroom_count: record.욕실수 || null,
    agent_name: record.중개업소명 || null,
    listed_at: record.등록년월일 || null,
    image_urls: record._imageUrls || [],
  };
}

// ── 메인 ──
async function main() {
  console.log("=== KB부동산 수집기 v4 ===");
  console.log(`구: ${sigungu}, cap: ${sampleCap}, 월세≤${rentMax}만, 보증금≤${depositMax}만, 면적≥${minAreaM2}㎡`);
  console.log(`물건종류: ${PROPERTY_TYPE_CODES} (빌라+다가구+단독), 거래유형: 월세\n`);

  const districts = sigungu.split(",").map((s) => s.trim());
  const allRecords = [];
  const stats = {};
  const globalSeenIds = new Set();      // 매물일련번호 cross-district dedup
  const visitedClusters = new Set();    // 클러스터 cross-district dedup

  // CDP 연결
  let browser;
  try {
    browser = await chromium.connectOverCDP("http://localhost:9222");
    console.log("✓ Chrome CDP 연결");
  } catch (e) {
    console.error(`✗ CDP 연결 실패: ${e.message}`);
    console.error("  Chrome을 디버깅 모드로 실행하세요:");
    console.error('  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-debug-profile"');
    process.exit(1);
  }

  // 기존 kbland.kr 탭 찾기
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes("kbland.kr")) { page = p; break; }
    }
    if (page) break;
  }

  if (!page) {
    console.log("ℹ kbland.kr 탭 없음 — 새 페이지를 생성하여 SPA 로드합니다...");
    const context = browser.contexts()[0] || await browser.newContext();
    page = await context.newPage();
    await page.goto("https://kbland.kr/map?xy=37.6423,127.0714,14", {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    // SPA Vuex 스토어 초기화 대기 (지도 렌더링 + API 바인딩)
    await page.waitForTimeout(5000);
    console.log(`✓ kbland.kr 신규 탭 로드 완료: ${page.url().substring(0, 60)}`);
  } else {
    console.log(`✓ kbland.kr 기존 탭: ${page.url().substring(0, 60)}`);
  }
  console.log("");

  for (const district of districts) {
    console.log(`\n${"=".repeat(40)}`);
    console.log(`[${district}] 수집 시작`);
    console.log("=".repeat(40));

    const districtRecords = [];

    // 1단계: 지도에서 클러스터 목록 가져오기
    console.log("  1) 지도 로드 → 클러스터 목록...");
    let clusters;
    try {
      clusters = await getClusters(page, district);
      console.log(`     ${clusters.length}개 클러스터`);
      if (verbose) {
        for (const c of clusters.slice(0, 5)) {
          console.log(`       ${c.id}: ${c.count}건 (${c.lat}, ${c.lng})`);
        }
      }
    } catch (e) {
      console.log(`     ✗ 클러스터 로드 실패: ${e.message}`);
      stats[district] = { error: e.message };
      continue;
    }

    if (clusters.length === 0) {
      console.log("     ⚠ 클러스터 없음 (매물이 없거나 줌레벨 조정 필요)");
      stats[district] = { clusters: 0, raw: 0, filtered: 0, final: 0 };
      continue;
    }

    // 2단계: 각 클러스터에서 매물 리스트 수집
    const freshClusters = clusters.filter(c => !visitedClusters.has(c.id));
    const skippedCount = clusters.length - freshClusters.length;
    if (skippedCount > 0) {
      console.log(`  2) ${clusters.length}개 클러스터 중 ${skippedCount}개 이전 구에서 방문 → ${freshClusters.length}개 순회`);
    } else {
      console.log(`  2) ${freshClusters.length}개 클러스터 순회 (propList/filter 인터셉트)...`);
    }
    const seenIds = new Set();
    let clusterIdx = 0;

    for (const cluster of freshClusters) {
      clusterIdx++;
      visitedClusters.add(cluster.id);

      const { listings, status } = await fetchClusterListings(page, cluster.id, cluster.lat, cluster.lng);

      let newCount = 0;
      for (const item of listings) {
        const id = item.매물일련번호;
        if (!id || seenIds.has(id) || globalSeenIds.has(id)) continue;
        seenIds.add(id);
        globalSeenIds.add(id);
        const record = toRecord(item, district);
        record._capturedStatus = status;
        districtRecords.push(record);
        newCount++;
      }

      if (verbose || newCount > 0) {
        console.log(`     [${clusterIdx}/${freshClusters.length}] ${cluster.id}: API ${listings.length}건, 신규 ${newCount}건 (누적 ${districtRecords.length})`);
      }
    }

    // 3단계: 필터 적용
    console.log(`  3) 필터 적용...`);
    const filtered = applyFilters(districtRecords);
    const capped = filtered.slice(0, sampleCap);

    stats[district] = {
      clusters: clusters.length,
      skippedClusters: skippedCount,
      visitedClusters: freshClusters.length,
      raw: districtRecords.length,
      filtered: filtered.length,
      final: capped.length,
    };

    console.log(`     원본 ${districtRecords.length} → 필터 ${filtered.length} → 최종 ${capped.length}`);

    // 4단계: 이미지 URL 수집 (이미지 있는 매물만)
    const withImages = capped.filter((r) => r.이미지수 > 0);
    if (withImages.length > 0) {
      console.log(`  4) 이미지 URL 수집 (${withImages.length}건)...`);
      for (const r of withImages) {
        const urls = await fetchImageUrls(page, r.매물일련번호);
        r._imageUrls = urls;
        if (urls.length > 0) console.log(`     • ${r.매물일련번호}: ${urls.length}장`);
      }
    }

    // 5단계: 상세 API로 방향/욕실/면적 보강
    console.log(`  5) 상세 API 보강 (${capped.length}건)...`);
    let detailOk = 0;
    for (const r of capped) {
      const detail = await fetchKbDetailInfo(r.매물일련번호);
      if (!detail) continue;
      detailOk++;
      if (detail.방향명) r.방향명 = detail.방향명;
      if (detail.방향기준명) r.방향기준명 = detail.방향기준명;
      if (detail.욕실수 != null) r.욕실수 = parseInt(detail.욕실수, 10);
      if (detail.사용승인일) r.사용승인일 = detail.사용승인일;
      // 면적 보정: 상세 API 전용면적이 더 정확
      const detailArea = detail.전용면적 ? parseFloat(detail.전용면적) : null;
      const detailSupply = detail.공급면적 ? parseFloat(detail.공급면적) : null;
      if (detailArea && Number.isFinite(detailArea) && detailArea > 0 && detailArea < 1000) {
        r.전용면적 = detailArea;
      }
      if (detailSupply && Number.isFinite(detailSupply) && detailSupply > 0) {
        r.공급면적 = detailSupply;
      }
    }
    console.log(`     상세 보강 완료: ${detailOk}/${capped.length}건`);

    // 샘플 출력
    for (const r of capped.slice(0, 3)) {
      console.log(`     • ${r.매물일련번호}: [${r.매물종별구분명}] ${r.읍면동명} ${r.건물명} | ${r.월세보증금}/${r.월세가}만 | ${r.전용면적}㎡ ${r.방수}방 ${r.방향명 || ""}`);
    }

    // JSONL 레코드 생성
    for (const r of capped) {
      allRecords.push({ raw: toJsonlRecord(r, district), norm: toNormalizedRecord(r, district) });
    }
  }

  // ── 결과 저장 ──
  const startedAt = new Date().toISOString();
  const outputDir = path.join(process.cwd(), "scripts");
  const rawFile = path.join(outputDir, "kbland_raw.jsonl");
  const normalizedFile = path.join(outputDir, "kbland_normalized.jsonl");

  fs.writeFileSync(
    rawFile,
    allRecords.length > 0
      ? allRecords.map((r) => JSON.stringify(r.raw)).join("\n") + "\n"
      : "",
    "utf8",
  );
  console.log(`\n📁 Raw JSONL: ${rawFile} (${allRecords.length}건)`);

  fs.writeFileSync(
    normalizedFile,
    allRecords.length > 0
      ? allRecords.map((r) => JSON.stringify(r.norm)).join("\n") + "\n"
      : "",
    "utf8",
  );
  console.log(`📁 Normalized JSONL: ${normalizedFile} (${allRecords.length}건)`);

  const finishedAt = new Date().toISOString();
  const runId = `kbland_${Date.now()}`;
  const resultFile = path.join(outputDir, "kbland_capture_results.json");
  const resultData = {
    runId,
    success: allRecords.length > 0,
    districts: districts.join(","),
    sampleCap,
    filters: { rentMax, depositMax, minAreaM2, propertyTypes: PROPERTY_TYPE_CODES },
    stats,
    totalListings: allRecords.length,
    dataQuality: {
      grade: allRecords.length >= 10 ? "GOOD" : allRecords.length > 0 ? "PARTIAL" : "EMPTY",
    },
    timestamp: finishedAt,
    // persistSummaryToDb 호환 형식
    results: [
      {
        platform: "kbland",
        rawFile: path.resolve(rawFile),
        normalizedPath: path.resolve(normalizedFile),
        ok: allRecords.length > 0,
        sigungu: districts.join(","),
        startedAt,
        finishedAt,
      },
    ],
  };
  fs.writeFileSync(resultFile, JSON.stringify(resultData, null, 2), "utf8");
  console.log(`📊 Results: ${resultFile}`);

  console.log("\n=== 수집 결과 요약 ===");
  for (const [district, s] of Object.entries(stats)) {
    if (s.error) {
      console.log(`  ${district}: ✗ ${s.error}`);
    } else {
      const skipInfo = s.skippedClusters > 0 ? ` (${s.skippedClusters} skipped)` : "";
      console.log(`  ${district}: 클러스터 ${s.visitedClusters}/${s.clusters}${skipInfo} | 원본 ${s.raw} | 필터 ${s.filtered} | 최종 ${s.final}`);
    }
  }
  console.log(`\n  총 수집: ${allRecords.length}건 (고유 매물 ${globalSeenIds.size}개)`);
  console.log(`  방문 클러스터: ${visitedClusters.size}개 (중복 제거됨)`);
  console.log(`  데이터 품질: ${resultData.dataQuality.grade}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
