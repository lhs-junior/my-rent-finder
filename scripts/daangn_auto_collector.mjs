#!/usr/bin/env node

/**
 * 당근 부동산 자동 수집기
 * - 전략: Direct HTML fetch → JSON-LD (application/ld+json) 파싱
 * - 브라우저 불필요 (Node.js fetch만 사용)
 * - 구별 location ID 기반 필터링
 */

import fs from "node:fs";
import path from "node:path";

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
const sampleCap = Number(getArg("--sample-cap", "10"));
const rentMax = Number(getArg("--rent-max", "80"));
const depositMax = Number(getArg("--deposit-max", "6000"));
const minAreaM2 = Number(getArg("--min-area", "40"));
const verbose = hasFlag("--verbose");

// ── 구별 당근 location ID 매핑 ──
// 당근 URL: https://www.daangn.com/kr/realty/?in=x-{id}
// ID는 동네 단위이지만, 해당 구의 매물을 가장 많이 포함하는 ID를 선택
const DISTRICT_IDS = {
  종로구: 2,
  중구: 20,
  성북구: 7,
  성동구: 60,
  동대문구: 70,
  광진구: 80,
  중랑구: 105,
  노원구: 185,
};

// ── 주거용 매물 타입 필터 ──
// SingleFamilyResidence: 원룸, 투룸, 빌라
// Place: 주택 (일부 주거용)
// Apartment: 아파트 (제외 - 우리 프로젝트는 빌라/다가구 대상)
const RESIDENTIAL_TYPES = new Set(["SingleFamilyResidence", "Place"]);

// ── 가격 파싱 ──
function parsePrice(name) {
  // 패턴1: "보증금만원/월세만원" (월세)
  // "1,000만원/50만원", "500만원/40만원", "1억2,000만원/70만원"
  const monthlyMatch = name.match(
    /(?:(\d+)억\s*)?([0-9,]+)만원\/([0-9,]+)만원/,
  );
  if (monthlyMatch) {
    let deposit = parseInt((monthlyMatch[2] || "0").replace(/,/g, ""), 10);
    if (monthlyMatch[1]) {
      deposit += parseInt(monthlyMatch[1], 10) * 10000;
    }
    const rent = parseInt((monthlyMatch[3] || "0").replace(/,/g, ""), 10);
    return { deposit, rent, type: "monthly" };
  }

  // 패턴2: 단일 가격 (전세 또는 매매)
  // "8,500만원", "3억5,000만원"
  const singleMatch = name.match(/(?:(\d+)억\s*)?([0-9,]+)만원/);
  if (singleMatch) {
    let amount = parseInt((singleMatch[2] || "0").replace(/,/g, ""), 10);
    if (singleMatch[1]) {
      amount += parseInt(singleMatch[1], 10) * 10000;
    }
    return { deposit: amount, rent: 0, type: "jeonse_or_sale" };
  }

  return null;
}

// ── 매물 타입 파싱 (name에서 추출) ──
function parsePropertyType(name) {
  if (/빌라/.test(name)) return "빌라";
  if (/투룸|2룸/.test(name)) return "투룸";
  if (/쓰리룸|3룸/.test(name)) return "쓰리룸";
  if (/원룸|1룸/.test(name)) return "원룸";
  if (/오피스텔/.test(name)) return "오피스텔";
  if (/주택|단독/.test(name)) return "주택";
  if (/아파트/.test(name)) return "아파트";
  if (/상가/.test(name)) return "상가";
  if (/사무실/.test(name)) return "사무실";
  return "기타";
}

// ── 면적 파싱 (description에서 추출) ──
function parseArea(description) {
  if (!description) return null;
  // 패턴: "전용 39.6㎡", "면적 40m²", "12평", "15py", "39.6m2"
  const m2Match = description.match(/([0-9,.]+)\s*(?:㎡|m²|m2)/i);
  if (m2Match) return parseFloat(m2Match[1].replace(/,/g, ""));

  const pyeongMatch = description.match(/([0-9,.]+)\s*(?:평|py)/i);
  if (pyeongMatch) return parseFloat(pyeongMatch[1].replace(/,/g, "")) * 3.306;

  return null;
}

// ── 수집 함수 ──
async function collectDistrict(districtName, locationId) {
  const url = `https://www.daangn.com/kr/realty/?in=x-${locationId}`;
  if (verbose) console.log(`  [${districtName}] Fetching: ${url}`);

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    },
  });

  if (!res.ok) {
    console.error(`  [${districtName}] HTTP ${res.status}`);
    return { items: [], total: 0 };
  }

  const html = await res.text();
  const ldMatch = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  if (!ldMatch) {
    console.error(`  [${districtName}] No JSON-LD found`);
    return { items: [], total: 0 };
  }

  const ld = JSON.parse(ldMatch[1]);
  const allItems = (ld.itemListElement || []).map((e) => e.item);
  if (verbose)
    console.log(
      `  [${districtName}] JSON-LD: ${allItems.length} items (numberOfItems: ${ld.numberOfItems})`,
    );

  // 1. 해당 구 매물만 필터링
  const districtItems = allItems.filter(
    (item) =>
      item.address?.addressRegion === "서울특별시" &&
      item.address?.addressLocality === districtName,
  );
  if (verbose)
    console.log(
      `  [${districtName}] 해당 구 매물: ${districtItems.length}건`,
    );

  // 2. 주거용 타입만 필터링
  const residentialItems = districtItems.filter((item) =>
    RESIDENTIAL_TYPES.has(item["@type"]),
  );
  if (verbose)
    console.log(
      `  [${districtName}] 주거용 매물: ${residentialItems.length}건`,
    );

  // 3. 가격 파싱 및 조건 필터
  const filtered = [];
  for (const item of residentialItems) {
    const price = parsePrice(item.name || "");
    if (!price) continue;
    if (price.type !== "monthly") continue; // 월세만

    // 보증금/월세 조건 체크
    if (rentMax > 0 && price.rent > rentMax) continue;
    if (depositMax > 0 && price.deposit > depositMax) continue;

    // 면적 체크 (있으면)
    const area = parseArea(item.description || "");
    if (minAreaM2 > 0 && area && area < minAreaM2) continue;

    const propertyType = parsePropertyType(item.name || "");

    filtered.push({
      ...item,
      _parsed: {
        deposit: price.deposit,
        rent: price.rent,
        priceType: price.type,
        propertyType,
        area,
        district: districtName,
      },
    });
  }

  if (verbose)
    console.log(
      `  [${districtName}] 조건 충족: ${filtered.length}건 (월세 ≤${rentMax}, 보증금 ≤${depositMax})`,
    );

  return {
    items: filtered,
    total: districtItems.length,
    residential: residentialItems.length,
  };
}

// ── 메인 ──
async function main() {
  console.log("=== 당근 부동산 수집기 ===");
  console.log(
    `구: ${sigungu}, cap: ${sampleCap}, 월세≤${rentMax}, 보증금≤${depositMax}, 면적≥${minAreaM2}㎡`,
  );

  const districts = sigungu.split(",").map((s) => s.trim());
  const allRecords = [];
  const stats = {};

  for (const district of districts) {
    const locationId = DISTRICT_IDS[district];
    if (!locationId) {
      console.error(`  [${district}] 알 수 없는 구 (지원: ${Object.keys(DISTRICT_IDS).join(", ")})`);
      stats[district] = { error: "unknown_district" };
      continue;
    }

    const result = await collectDistrict(district, locationId);
    stats[district] = {
      total: result.total,
      residential: result.residential,
      filtered: result.items.length,
      capped: Math.min(result.items.length, sampleCap),
    };

    // sampleCap 적용
    const capped = result.items.slice(0, sampleCap);

    for (const item of capped) {
      const parsed = item._parsed;
      // 고유 ID 추출 (URL의 마지막 path segment)
      const idMatch = item.identifier?.match(/-([a-z0-9]+)$/);
      const externalId = idMatch ? idMatch[1] : item.identifier;

      const record = {
        platform_code: "daangn",
        collected_at: new Date().toISOString(),
        source_url: item.identifier,
        request_url: `https://www.daangn.com/kr/realty/?in=x-${locationId}`,
        response_status: 200,
        sigungu: district,
        payload_json: {
          id: externalId,
          name: item.name,
          description: item.description,
          schemaType: item["@type"],
          propertyType: parsed.propertyType,
          deposit: parsed.deposit,
          rent: parsed.rent,
          area: parsed.area,
          images: item.image || [],
          address: item.address,
        },
        list_data: {
          priceTitle: `${parsed.deposit}/${parsed.rent}`,
          roomTitle: item.name?.replace(/ \| 당근부동산$/, "") || "",
          dongName: item.address?.streetAddress || "",
          propertyType: parsed.propertyType,
          imgUrlList: (item.image || []).map((img) =>
            img.replace(/&amp;/g, "&"),
          ),
        },
      };
      allRecords.push(record);
    }
  }

  // ── JSONL 저장 ──
  const outputDir = path.join(process.cwd(), "scripts");
  const rawFile = path.join(outputDir, "daangn_raw_samples.jsonl");
  const lines = allRecords.map((r) => JSON.stringify(r));
  fs.writeFileSync(rawFile, lines.join("\n") + "\n", "utf8");
  console.log(`\n📁 Raw JSONL: ${rawFile} (${allRecords.length}건)`);

  // ── 결과 JSON ──
  const resultFile = path.join(outputDir, "daangn_capture_results.json");
  const resultData = {
    runId: `daangn_${Date.now()}`,
    success: allRecords.length > 0,
    districts: districts.join(","),
    sampleCap,
    filters: { rentMax, depositMax, minAreaM2 },
    stats,
    totalListings: allRecords.length,
    dataQuality: {
      grade: allRecords.length >= 5 ? "GOOD" : allRecords.length > 0 ? "PARTIAL" : "EMPTY",
      addressRate:
        allRecords.filter((r) => r.payload_json.address?.streetAddress).length /
        Math.max(allRecords.length, 1),
      imageRate:
        allRecords.filter((r) => r.payload_json.images?.length > 0).length /
        Math.max(allRecords.length, 1),
      areaRate:
        allRecords.filter((r) => r.payload_json.area !== null).length /
        Math.max(allRecords.length, 1),
    },
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(resultFile, JSON.stringify(resultData, null, 2), "utf8");
  console.log(`📊 Results: ${resultFile}`);

  // ── 요약 ──
  console.log("\n=== 수집 결과 ===");
  for (const [district, s] of Object.entries(stats)) {
    if (s.error) {
      console.log(`  ${district}: ❌ ${s.error}`);
    } else {
      console.log(
        `  ${district}: 전체 ${s.total} → 주거 ${s.residential} → 조건충족 ${s.filtered} → cap ${s.capped}`,
      );
    }
  }
  console.log(`  총 수집: ${allRecords.length}건`);
  console.log(`  데이터 품질: ${resultData.dataQuality.grade}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
