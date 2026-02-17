#!/usr/bin/env node

/**
 * 부동산114 자동 수집기
 * - 전략: Playwright stealth → 빌라/연립 월세 페이지 접속 → API 응답 캡처 + page.evaluate(fetch)
 * - 핵심 API: POST /?_c=memul&_m=p10&_a=index.ajax
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

// ── CLI ──
const args = process.argv.slice(2);
function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}
const hasFlag = (name) => args.includes(name);

function normalizeSampleCap(raw, fallback = 100) {
  const parsed = Number(raw);
  if (raw === null || raw === undefined || Number.isNaN(parsed)) return fallback;
  if (parsed < 0) return fallback;
  if (!Number.isFinite(parsed) || parsed === 0) return Number.POSITIVE_INFINITY;
  return Math.floor(parsed);
}

const sigungu = getArg("--sigungu", "노원구");
const sampleCap = normalizeSampleCap(getArg("--sample-cap", "100"), 100);
const rentMax = Number(getArg("--rent-max", "80"));
const depositMax = Number(getArg("--deposit-max", "6000"));
const minAreaM2 = Number(getArg("--min-area", "40"));
const outputRaw = path.resolve(
  process.cwd(),
  getArg("--output-raw", "scripts/r114_raw_samples.jsonl"),
);
const outputMeta = path.resolve(
  process.cwd(),
  getArg("--output-meta", "scripts/r114_capture_results.json"),
);
const verbose = hasFlag("--verbose");
const headed = hasFlag("--headed");
const outputDir = path.dirname(outputRaw);
fs.mkdirSync(outputDir, { recursive: true });

// ── 매물 타입별 URL 코드 ──
// direct=F: 빌라/연립, direct=G: 원룸/투룸/오피스텔, direct=D: 주택/다가구
const CATEGORIES = [
  { code: "F", name: "빌라/연립" },
  { code: "D", name: "주택/다가구" },
];

// ── HTML 파싱 ──
function parseListings(html) {
  const listings = [];
  // Each listing is in <li>...</li>
  const liRegex = /<li>\s*<a[^>]*onClick="goHouseDetailPage\('([^']+)',\s*'(\d+)'\)"[\s\S]*?<\/li>/g;
  let match;
  while ((match = liRegex.exec(html)) !== null) {
    const li = match[0];
    const id = match[1];
    const typeCode = match[2];

    // Title/building name
    const titleMatch = li.match(/tit_a[^>]*><span>\s*([^<]+)/);
    const title = titleMatch?.[1]?.trim() || "";

    // Trade type and price
    const tradeMatch = li.match(/tag_comm2[^>]*>([^<]+)<\/span>\s*([^<]+)/);
    const tradeType = tradeMatch?.[1]?.trim() || ""; // 매매, 전세, 월세
    const priceText = tradeMatch?.[2]?.trim() || "";

    // Property type and details
    const detailMatch = li.match(
      /<strong>([^<]+)<\/strong><span class="info_memul">\s*([\s\S]*?)<\/span>/,
    );
    const propertyType = detailMatch?.[1]?.trim() || "";
    const infoText = detailMatch?.[2]?.trim() || "";

    // Area parsing from info_memul: "방3개 83.45/59.4㎡ 8층/총22층"
    const areaMatch = infoText.match(/([0-9.]+)\/([0-9.]+)㎡/);
    const grossArea = areaMatch ? parseFloat(areaMatch[1]) : null;
    const exclusiveArea = areaMatch ? parseFloat(areaMatch[2]) : null;

    // Rooms
    const roomMatch = infoText.match(/방(\d+)개/);
    const rooms = roomMatch ? parseInt(roomMatch[1], 10) : null;

    // Floor
    const floorMatch = infoText.match(/(\d+)층\/총(\d+)층/);
    const floor = floorMatch ? parseInt(floorMatch[1], 10) : null;
    const totalFloor = floorMatch ? parseInt(floorMatch[2], 10) : null;

    // Price parsing
    let deposit = null;
    let rent = null;
    if (tradeType === "월세") {
      // 월세: "1,000/50" or "500/40"
      const monthlyMatch = priceText.match(
        /([0-9,]+)\s*\/\s*([0-9,]+)\s*만원/,
      );
      if (monthlyMatch) {
        deposit = parseInt(monthlyMatch[1].replace(/,/g, ""), 10);
        rent = parseInt(monthlyMatch[2].replace(/,/g, ""), 10);
      }
    }

    // Image
    const imgMatch = li.match(/src="([^"]+)"/);
    const imageUrl = imgMatch?.[1] || null;

    // Date
    const dateMatch = li.match(/tag_comm3[^>]*>[^<]*<em>([^<]+)/);
    const date = dateMatch?.[1]?.trim() || "";

    // Address from info
    const addressMatch = li.match(/info_area[^>]*>([^<]+)/);
    const address = addressMatch?.[1]?.trim() || "";

    listings.push({
      id,
      typeCode,
      title,
      tradeType,
      priceText,
      propertyType,
      deposit,
      rent,
      grossArea,
      exclusiveArea,
      rooms,
      floor,
      totalFloor,
      imageUrl,
      date,
      address,
    });
  }
  return listings;
}

async function collectDistrict(districtName) {
  console.log(`\n[${districtName}] 수집 시작...`);

  const browser = await chromium.launch({
    headless: !headed,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "ko-KR",
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();
  const allListings = [];
  const seenIds = new Set();

  for (const category of CATEGORIES) {
    if (verbose)
      console.log(`  [${category.name}] 페이지 접속 중...`);

    // Navigate to the category page
    const pageUrl = `https://www.r114.com/?_c=memul&_m=p10&direct=${category.code}`;
    try {
      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log(`  [${category.name}] 페이지 로드 실패: ${e.message}`);
      continue;
    }

    // Use page.evaluate to call the API with browser cookies/session
    // The API is a standard jQuery AJAX POST
    for (let pageNum = 1; pageNum <= 20; pageNum++) {
      try {
        const html = await page.evaluate(
          async ({ addr1, addr2, pageNum: pn }) => {
            const params = new URLSearchParams({
              page: String(pn),
              addr1,
              addr2,
              addr3: "",
              complexCd: "",
              complexTypeName: "",
              newVilla: "0",
              sortTag: "",
              sortTag2: "",
              rndValue: String(Math.floor(Math.random() * 1000)),
              areaSize: "",
              areaSizeType: "",
            });

            const res = await fetch("/?_c=memul&_m=p10&_a=index.ajax", {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
              },
              body: params.toString(),
            });
            return await res.text();
          },
          { addr1: "서울특별시", addr2: districtName, pageNum },
        );

        const listings = parseListings(html);
        if (verbose)
          console.log(
            `  [${category.name}] 페이지 ${pageNum}: ${listings.length}건`,
          );

        // Filter for 월세 only
        const monthlyListings = listings.filter(
          (l) => l.tradeType === "월세",
        );
        if (verbose && monthlyListings.length !== listings.length) {
          console.log(
            `    월세만: ${monthlyListings.length}건 (매매/전세 ${listings.length - monthlyListings.length}건 제외)`,
          );
        }

        let newCount = 0;
        for (const l of monthlyListings) {
          if (seenIds.has(l.id)) continue;
          seenIds.add(l.id);
          l._category = category.code;
          l._categoryName = category.name;
          allListings.push(l);
          newCount++;
        }

        if (listings.length === 0) break; // No more pages
        if (newCount === 0 && pageNum > 1) break; // All duplicates — API looping
      } catch (e) {
        if (verbose) console.log(`  [${category.name}] 페이지 ${pageNum} 에러: ${e.message}`);
        break;
      }
    }
  }

  await browser.close();

  // Filter by conditions
  const filtered = allListings.filter((l) => {
    if (rentMax > 0 && l.rent !== null && l.rent > rentMax) return false;
    if (depositMax > 0 && l.deposit !== null && l.deposit > depositMax)
      return false;
    if (minAreaM2 > 0 && l.exclusiveArea !== null && l.exclusiveArea < minAreaM2)
      return false;
    return true;
  });

  console.log(
    `[${districtName}] 전체 ${allListings.length}건 → 조건 충족 ${filtered.length}건`,
  );

  return {
    district: districtName,
    total: allListings.length,
    filtered: filtered.length,
    items: filtered,
  };
}

async function main() {
  console.log("=== 부동산114 수집기 ===");
  console.log(
    `구: ${sigungu}, cap: ${sampleCap}, 월세≤${rentMax}, 보증금≤${depositMax}, 면적≥${minAreaM2}㎡`,
  );

  const districts = sigungu.split(",").map((s) => s.trim());
  const allRecords = [];
  const stats = {};

  for (const district of districts) {
    const result = await collectDistrict(district);
    stats[district] = {
      total: result.total,
      filtered: result.filtered,
    };

    for (const item of result.items) {
      const record = {
        platform_code: "r114",
        collected_at: new Date().toISOString(),
        source_url: `https://www.r114.com/?_c=memul&_m=p10&_a=goDetail&memulNo=${item.id}`,
        request_url: `https://www.r114.com/?_c=memul&_m=p10&direct=${item._category}`,
        response_status: 200,
        sigungu: district,
        payload_json: {
          id: item.id,
          title: item.title,
          tradeType: item.tradeType,
          propertyType: item.propertyType,
          deposit: item.deposit,
          rent: item.rent,
          grossArea: item.grossArea,
          exclusiveArea: item.exclusiveArea,
          rooms: item.rooms,
          floor: item.floor,
          totalFloor: item.totalFloor,
          address: item.address || `서울특별시 ${district} ${item.title}`.trim(),
          date: item.date,
          imageUrl: item.imageUrl,
          category: item._categoryName,
        },
        list_data: {
          priceTitle: `${item.deposit || 0}/${item.rent || 0}`,
          roomTitle: item.title,
          dongName: item.address || "",
          propertyType: item.propertyType,
          imgUrlList: item.imageUrl ? [item.imageUrl] : [],
        },
      };
      allRecords.push(record);
    }
  }

  // Save JSONL
  fs.writeFileSync(
    outputRaw,
    allRecords.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
  console.log(`\n📁 Raw JSONL: ${outputRaw} (${allRecords.length}건)`);

  // Save results JSON
  const resultFile = outputMeta;
  const resultData = {
    runId: `r114_${Date.now()}`,
    success: allRecords.length > 0,
    districts: districts.join(","),
    sampleCap,
    filters: { rentMax, depositMax, minAreaM2 },
    stats,
    totalListings: allRecords.length,
    dataQuality: {
      grade:
        allRecords.length >= 5
          ? "GOOD"
          : allRecords.length > 0
            ? "PARTIAL"
            : "EMPTY",
    },
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(resultFile, JSON.stringify(resultData, null, 2), "utf8");
  console.log(`📊 Results: ${resultFile}`);

  console.log("\n=== 수집 결과 ===");
  for (const [district, s] of Object.entries(stats)) {
    console.log(
      `  ${district}: 전체 ${s.total} → 조건충족 ${s.filtered}`,
    );
  }
  console.log(`  총 수집: ${allRecords.length}건`);
  console.log(`  데이터 품질: ${resultData.dataQuality.grade}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
