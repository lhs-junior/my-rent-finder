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
const sampleCap = Number(getArg("--sample-cap", "0")) || Infinity;
const rentMax = Number(getArg("--rent-max", "80"));
const depositMax = Number(getArg("--deposit-max", "6000"));
const minAreaM2 = Number(getArg("--min-area", "40"));
const verbose = hasFlag("--verbose");
const outputRaw = getArg("--output-raw", null);
const outputMeta = getArg("--output-meta", null);

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

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/,/g, "").replace(/\s+/g, "");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeUrlPath(candidate) {
  if (candidate === null || candidate === undefined) return "";
  const pathOnly = String(candidate)
    .trim()
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("?")[0]
    .split("#")[0];
  return pathOnly.replace(/\/+$/, "");
}

function buildDetailKeys(identifier) {
  const keys = new Set();
  if (!identifier) return keys;

  const raw = String(identifier).trim();
  const candidates = new Set([
    raw,
    raw.split("?")[0].split("#")[0],
    raw.replace(/^https?:\/\/www\.daangn\.com/i, ""),
  ]);
  try {
    candidates.add(decodeURIComponent(raw));
  } catch {
    // noop
  }

  const addPath = (v) => {
    if (!v) return;
    const normalized = normalizeUrlPath(v);
    if (!normalized) return;

    const lower = normalized.toLowerCase();
    keys.add(normalized);
    keys.add(lower);

    if (/^https?:\/\//i.test(v)) {
      keys.add(normalized);
    } else if (normalized.startsWith("/")) {
      keys.add(`https://www.daangn.com${normalized}`);
      keys.add(`https://www.daangn.com${lower}`);
    } else {
      keys.add(`/${lower}`);
      keys.add(`https://www.daangn.com/${lower}`);
    }

    const parts = normalized.split("/");
    const last = parts[parts.length - 1];
    if (last) {
      keys.add(last);
      keys.add(last.toLowerCase());
    }
  };

  for (const v of candidates) {
    addPath(v);
    if (typeof v === "string" && /^https?:\/\//i.test(v)) {
      try {
        const u = new URL(v);
        addPath(u.pathname);
        addPath(decodeURIComponent(u.pathname));
      } catch {
        // noop
      }
    }
  }

  return keys;
}

function collectDaangnDetails(html) {
  const marker = "window.__remixContext = ";
  const start = html.indexOf(marker);
  if (start === -1) return new Map();

  const end = html.indexOf(";</script>", start);
  if (end === -1) return new Map();

  try {
    const jsonText = html.slice(start + marker.length, end);
    const context = JSON.parse(jsonText);
    const routeData = context?.state?.loaderData?.["routes/kr.realty._index"];
    const rawPosts = Array.isArray(routeData?.realtyPosts?.realtyPosts)
      ? routeData.realtyPosts.realtyPosts
      : Array.isArray(routeData?.realtyPosts)
        ? routeData.realtyPosts
        : [];
    const detailMap = new Map();

    for (const post of rawPosts) {
      if (!post || typeof post !== "object") continue;
      for (const key of buildDetailKeys(post.id)) {
        detailMap.set(key, post);
      }
    }
    return detailMap;
  } catch {
    return new Map();
  }
}

function getDaangnDetail(detailMap, identifier) {
  for (const key of buildDetailKeys(identifier)) {
    const found = detailMap.get(key);
    if (found) return found;
  }
  return null;
}

function parseAreaFromDetail(detail) {
  if (!detail || typeof detail !== "object") {
    return {
      value: null,
      claimed: null,
    };
  }

  const area = toNumber(detail.area);
  if (area !== null) {
    return {
      value: area,
      claimed: "exclusive",
    };
  }

  const areaByPyeong = parseAreaTextValue(detail.areaPyeong, "평");
  if (areaByPyeong !== null) {
    return {
      value: areaByPyeong,
      claimed: "exclusive",
    };
  }

  const gross = toNumber(detail.supplyArea);
  if (gross !== null) {
    return {
      value: gross,
      claimed: "gross",
    };
  }

  const grossByPyeong = parseAreaTextValue(detail.supplyAreaPyeong, "평");
  if (grossByPyeong !== null) {
    return {
      value: grossByPyeong,
      claimed: "gross",
    };
  }

  return {
    value: null,
    claimed: null,
  };
}

function parsePriceFromDetail(detail) {
  if (!detail || typeof detail !== "object") return null;
  const trades = Array.isArray(detail.trades) ? detail.trades : [];
  const monthlyTrade = trades.find((trade) =>
    ["MONTH", "MONTHLY", "LEASE"].includes(String(trade?.type || "").toUpperCase()),
  );
  if (!monthlyTrade) return null;

  const deposit = toNumber(monthlyTrade.deposit ?? monthlyTrade.monthlyDeposit ?? monthlyTrade.depositPrice ?? monthlyTrade.price);
  const rent = toNumber(
    monthlyTrade.monthlyPay ??
      monthlyTrade.monthlyRent ??
      monthlyTrade.rent ??
      monthlyTrade.price ??
      monthlyTrade.monthlyRentPrice ??
      monthlyTrade.rentPrice,
  );

  if (deposit === null && rent === null) return null;

  return {
    deposit,
    rent,
    type: "monthly",
  };
}

function parseFloorValue(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trim = value.trim();
    if (!trim) return null;
    if (/반지하/.test(trim)) return -1;
    const basement = /지하\s*(\d+)?\s*층?/.exec(trim);
    if (basement) {
      const level = Number(basement[1] || 1);
      return -Math.max(1, level);
    }
    const b2 = /b(\d+)/i.exec(trim);
    if (b2) return -Math.max(1, Number(b2[1] || 1));
    const floorTextMatch = /(\d+(?:\.\d+)?)\s*층/.exec(trim);
    if (floorTextMatch) return Number.parseFloat(floorTextMatch[1]);
    return toNumber(trim);
  }
  return null;
}

function normalizeAreaValue(value, unitText = "") {
  const n = toNumber(value);
  if (n === null) return null;
  const u = String(unitText).toUpperCase();
  if (/PY|PYEONG|평|坪|PYUNG/.test(u)) {
    return n * 3.306;
  }
  return n;
}

function parseAreaTextValue(rawNumber, rawUnit = "") {
  const n = toNumber(rawNumber);
  if (n === null) return null;
  const unit = String(rawUnit).trim().toUpperCase();
  if (/PY|PYEONG|평|坪|PYUNG/.test(unit)) return n * 3.306;
  return n;
}

function parseAreaFromFloorSize(floorSize) {
  if (!floorSize) return null;

  if (typeof floorSize === "number" || typeof floorSize === "string") {
    return normalizeAreaValue(floorSize);
  }

  if (typeof floorSize !== "object") return null;
  const candidates = [
    floorSize.value,
    floorSize.size,
    floorSize.area,
    floorSize.sqm,
    floorSize.m2,
  ];

  for (const candidate of candidates) {
    const value = normalizeAreaValue(candidate, floorSize.unitCode || floorSize.unit || floorSize.unitText);
    if (value !== null) return value;
  }

  return null;
}

function parseAreaFromText(description) {
  if (!description) {
    return {
      value: null,
      claimed: null,
    };
  }

  const patterns = [
    {
      claimed: "exclusive",
      re: /(?:전용|실|실면적)\s*(?:면적)?\s*[\(:]?\s*([0-9]+(?:[.,][0-9]+)?)\s*(㎡|m²|m2|제곱미터|평|py|평|坪|평수)/i,
    },
    {
      claimed: "gross",
      re: /(?:공급|연면적|건물면적)\s*(?:면적)?\s*[\(:]?\s*([0-9]+(?:[.,][0-9]+)?)\s*(㎡|m²|m2|제곱미터|평|py|坪|평수)/i,
    },
    {
      claimed: "estimated",
      re: /([0-9]+(?:[.,][0-9]+)?)\s*(㎡|m²|m2|제곱미터|평|py|坪|평수)/i,
    },
  ];

  for (const pattern of patterns) {
    const match = pattern.re.exec(String(description));
    if (!match) continue;
    const value = parseAreaTextValue(match[1], match[2]);
    if (value !== null) {
      return {
        value,
        claimed: pattern.claimed,
      };
    }
  }

  return {
    value: null,
    claimed: null,
  };
}

function parseArea(item) {
  const detailArea = parseAreaFromDetail(item?._detail);
  if (detailArea.value !== null) {
    return detailArea;
  }

  const fromSchema = parseAreaFromFloorSize(item.floorSize);
  if (fromSchema !== null) {
    return {
      value: fromSchema,
      claimed: "estimated",
    };
  }

  const fromDescription = parseAreaFromText(item.description || "");
  if (fromDescription.value !== null) {
    return fromDescription;
  }

  return parseAreaFromText(item.name || "");
}

function extractListingId(identifier) {
  if (!identifier) return null;
  const normalized = String(identifier).trim();
  const path = normalized.split("?")[0].split("#")[0];
  const segment = path.split("/").filter(Boolean).pop();
  if (!segment) return null;

  if (/^[0-9A-Za-z]+$/.test(segment)) return segment;
  const lastDash = segment.split("-").filter(Boolean).pop();
  return lastDash ? lastDash : segment;
}

function coerceImageUrls(rawImage) {
  const out = [];
  const seen = new Set();
  const normalized = [];
  const push = (value) => {
    if (typeof value !== "string") return;
    const s = value.replace(/&amp;/g, "&").replace(/\s+/g, "").trim();
    if (!/^https?:\/\//i.test(s)) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  const walk = (v, depth = 0) => {
    if (!v || out.length >= 24 || depth > 6) return;
    if (typeof v === "string") {
      push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    if (typeof v === "object") {
      for (const val of Object.values(v)) walk(val, depth + 1);
    }
  };

  walk(rawImage);
  for (const url of out) {
    if (normalized.length >= 12) break;
    normalized.push(url);
  }
  return normalized;
}

function parseFloor(item) {
  const detailFloor = parseFloorValue(item?._detail?.floor ?? item?._detail?.floorText);
  if (detailFloor !== null) return detailFloor;

  if (item?.floorLevel !== undefined) {
    const bySchema = toNumber(item.floorLevel);
    if (bySchema !== null) {
      if (bySchema === 0 && /반지하/.test(item.description || "")) {
        return -1;
      }
      return bySchema;
    }
  }

  const txt = `${item.description || ""} ${item.name || ""}`;
  if (/반지하/.test(txt)) return -1;
  const basement = /지하\s*(\d+)?\s*층?/.exec(txt);
  if (basement) {
    const level = Number(basement[1] || 1);
    return -Math.max(1, level);
  }

  const b2 = /b(\d+)/i.exec(txt);
  if (b2) return -Math.max(1, Number(b2[1] || 1));

  const floorTextMatch = /(\d+)(?:\.\d+)?\s*층/.exec(txt);
  if (floorTextMatch) return Number.parseInt(floorTextMatch[1], 10);
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
  const detailMap = collectDaangnDetails(html);
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
  const districtItems = allItems.filter((item) => {
    const detail = getDaangnDetail(detailMap, item.identifier);
    if (detail?.region?.name2 === districtName) return true;
    return (
      item.address?.addressRegion === "서울특별시" &&
      item.address?.addressLocality === districtName
    );
  });
  if (verbose)
    console.log(
      `  [${districtName}] 해당 구 매물: ${districtItems.length}건`,
    );

  // 2. 주거용 타입만 필터링
  const residentialItems = districtItems
    .map((item) => ({
      ...item,
      _detail: getDaangnDetail(detailMap, item.identifier),
    }))
    .filter((item) => RESIDENTIAL_TYPES.has(item["@type"]));
  if (verbose)
    console.log(
      `  [${districtName}] 주거용 매물: ${residentialItems.length}건`,
    );

  // 3. 가격 파싱 및 조건 필터
  const filtered = [];
  for (const item of residentialItems) {
    const price = parsePriceFromDetail(item._detail) || parsePrice(item.name || "");
    if (!price) continue;
    if (price.type !== "monthly") continue; // 월세만

    // 보증금/월세 조건 체크
    if (rentMax > 0 && price.rent > rentMax) continue;
    if (depositMax > 0 && price.deposit > depositMax) continue;

    // 면적 체크 (있으면)
    const area = parseArea(item);
    if (minAreaM2 > 0) {
      if (area.value === null || area.value < minAreaM2) continue;
    }

    const floor = parseFloor(item);

    const propertyType = parsePropertyType(item.name || "");

    filtered.push({
      ...item,
      _parsed: {
        deposit: price.deposit,
        rent: price.rent,
        priceType: price.type,
        propertyType,
        area,
        floor,
        district: districtName,
        hasDetail: Boolean(item._detail),
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
    const cappedItems = result.items.slice(0, sampleCap);
    stats[district] = {
      total: result.total,
      residential: result.residential,
      filtered: result.items.length,
      capped: cappedItems.length,
    };

    for (const item of cappedItems) {
    const parsed = item._parsed;
    // 고유 ID 추출 (URL의 마지막 path segment)
      const sourceImageUrls = coerceImageUrls(
        item.image || item.images || item._detail?.images || [],
      );
      const externalId = extractListingId(item.identifier);
      const detail = item._detail || {};

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
          area: parsed.area.value,
          areaClaimed: parsed.area.claimed,
          floor: parsed.floor,
          floorLevel: detail.floor,
          floorText: detail.floorText,
          supplyArea: detail.supplyArea,
          areaPyeong: detail.areaPyeong,
          supplyAreaPyeong: detail.supplyAreaPyeong,
          images: sourceImageUrls,
          address: item.address,
          detailSource: detail.__typename || "unknown",
        },
        list_data: {
          priceTitle: `${parsed.deposit}/${parsed.rent}`,
          roomTitle: item.name?.replace(/ \| 당근부동산$/, "") || "",
          dongName: item.address?.streetAddress || "",
          propertyType: parsed.propertyType,
          floor: parsed.floor,
          floorText: detail.floorText || "",
          imgUrlList: sourceImageUrls.map((img) => img.replace(/&amp;/g, "&")),
        },
      };
      allRecords.push(record);
    }
  }

  // ── JSONL 저장 ──
  const outputDir = path.join(process.cwd(), "scripts");
  const rawFile = outputRaw || path.join(outputDir, "daangn_raw_samples.jsonl");
  const lines = allRecords.map((r) => JSON.stringify(r));
  fs.writeFileSync(rawFile, lines.join("\n") + "\n", "utf8");
  console.log(`\n📁 Raw JSONL: ${rawFile} (${allRecords.length}건)`);

  // ── 결과 JSON ──
  const resultFile = outputMeta || path.join(outputDir, "daangn_capture_results.json");
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
        `  ${district}: 전체 ${s.total} → 주거 ${s.residential} → 조건충족 ${s.filtered}`,
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
