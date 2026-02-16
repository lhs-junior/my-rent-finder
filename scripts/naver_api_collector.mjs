#!/usr/bin/env node

/**
 * Naver Real Estate API Collector
 * 네이버 부동산 API를 직접 호출하여 매물 데이터를 빠르게 수집
 */

import fs from "node:fs";
import https from "node:https";

// ============================================================================
// CLI Arguments Parsing
// ============================================================================

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const sigungu = getArg("--sigungu", "노원구");
function normalizeSampleCap(raw, fallback = 100) {
  const parsed = Number(raw);
  if (raw === null || raw === undefined || Number.isNaN(parsed)) return fallback;
  if (parsed < 0) return fallback;
  if (!Number.isFinite(parsed) || parsed === 0) return Number.POSITIVE_INFINITY;
  return Math.floor(parsed);
}

const sampleCap = normalizeSampleCap(getArg("--sample-cap", "100"), 100);
const outputRaw = getArg("--output-raw", "scripts/naver_raw_samples.jsonl");
const outputMeta = getArg(
  "--output-meta",
  "scripts/naver_capture_results.json",
);
const delayMs = parseInt(getArg("--delay-ms", "1500"), 10);
const verbose = hasFlag("--verbose");

// ============================================================================
// District Code Mapping
// ============================================================================

let districtCodes = {};
try {
  const raw = fs.readFileSync("scripts/naver_district_codes.json", "utf8");
  districtCodes = JSON.parse(raw);
} catch (err) {
  console.error("❌ Cannot load district codes:", err.message);
  process.exit(1);
}

const cortarNo = districtCodes[sigungu];
if (!cortarNo) {
  console.error(`❌ Unknown district: ${sigungu}`);
  console.error(
    `Available districts: ${Object.keys(districtCodes).join(", ")}`,
  );
  process.exit(1);
}

console.log(`🎯 Target: ${sigungu} (cortarNo: ${cortarNo})`);
console.log(`📊 Sample cap: ${sampleCap}`);
console.log(`⏱️  Delay between requests: ${delayMs}ms\n`);

// ============================================================================
// API Request Helper
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAPI(url, retries = 3) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Referer: "https://new.land.naver.com/",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (verbose)
        console.log(`  🔍 Fetching: ${url} (attempt ${attempt}/${retries})`);

      const response = await new Promise((resolve, reject) => {
        https
          .get(url, { headers }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode,
                headers: res.headers,
                body: data,
              }),
            );
            res.on("error", reject);
          })
          .on("error", reject);
      });

      if (response.status === 200) {
        try {
          const json = JSON.parse(response.body);
          return { success: true, data: json, status: response.status };
        } catch (parseErr) {
          return {
            success: false,
            error: "PARSE_ERROR",
            message: parseErr.message,
            body: response.body,
          };
        }
      } else if (response.status === 429) {
        const backoffMs = delayMs * Math.pow(2, attempt - 1);
        console.warn(`  ⚠️  Rate limited (429). Backing off ${backoffMs}ms...`);
        await sleep(backoffMs);
        continue;
      } else {
        return {
          success: false,
          error: "HTTP_ERROR",
          status: response.status,
          body: response.body,
        };
      }
    } catch (err) {
      if (attempt === retries) {
        return { success: false, error: "NETWORK_ERROR", message: err.message };
      }
      await sleep(delayMs);
    }
  }

  return { success: false, error: "MAX_RETRIES_EXCEEDED" };
}

// ============================================================================
// API Endpoint Discovery
// ============================================================================

async function discoverEndpoints() {
  console.log("🔎 Discovering API endpoints...\n");

  const endpoints = [
    // Cluster-based listing
    `https://new.land.naver.com/api/articles/cluster?cortarNo=${cortarNo}&zoom=15&tradTpCd=A1`,

    // Complex-based listing
    `https://new.land.naver.com/api/complexes?cortarNo=${cortarNo}&tradTpCd=A1`,

    // Alternative patterns found in research
    `https://m.land.naver.com/cluster/ajax/articleList?cortarNo=${cortarNo}&tradTpCd=A1`,
    `https://m.land.naver.com/cluster/ajax/complexList?cortarNo=${cortarNo}&tradTpCd=A1`,
  ];

  const results = [];

  for (const url of endpoints) {
    console.log(`Testing: ${url.substring(0, 80)}...`);
    const result = await fetchAPI(url);

    if (result.success) {
      console.log(
        `  ✅ Success! Found ${JSON.stringify(result.data).length} bytes of data`,
      );
      results.push({
        url,
        success: true,
        dataSize: JSON.stringify(result.data).length,
        sample: result.data,
      });
    } else {
      console.log(
        `  ❌ Failed: ${result.error} (status: ${result.status || "N/A"})`,
      );
      results.push({
        url,
        success: false,
        error: result.error,
        status: result.status,
      });
    }

    await sleep(delayMs);
  }

  return results;
}

// ============================================================================
// Data Collection
// ============================================================================

async function collectData(workingEndpoint) {
  console.log(`\n📥 Collecting data from working endpoint...\n`);

  const samples = [];
  const rawStream = fs.createWriteStream(outputRaw, { flags: "w" });

  // Try to collect samples with pagination if available
  let page = 1;
  let collected = 0;

  while (collected < sampleCap) {
    const url = `${workingEndpoint}&page=${page}`;
    console.log(`Page ${page}: Fetching...`);

    const result = await fetchAPI(url);

    if (!result.success) {
      console.warn(`  ⚠️  Failed to fetch page ${page}: ${result.error}`);
      break;
    }

    // Extract articles/items from response
    const items = extractItems(result.data);

    if (!items || items.length === 0) {
      console.log(`  ℹ️  No more items found. Stopping.`);
      break;
    }

    console.log(`  ✅ Found ${items.length} items`);

    for (const item of items) {
      if (collected >= sampleCap) break;

      const rawRecord = {
        platform_code: "naver",
        collected_at: new Date().toISOString(),
        source_url: url,
        request_url: url,
        response_status: 200,
        response_headers: {},
        payload_json: item,
      };

      rawStream.write(JSON.stringify(rawRecord) + "\n");
      samples.push(rawRecord);
      collected++;
    }

    console.log(`  📊 Collected: ${collected}/${sampleCap}`);

    if (collected >= sampleCap) break;

    page++;
    await sleep(delayMs);
  }

  rawStream.end();

  return samples;
}

function extractItems(data) {
  // Try different possible response structures
  if (Array.isArray(data)) return data;
  if (data.body && Array.isArray(data.body)) return data.body;
  if (data.articleList && Array.isArray(data.articleList))
    return data.articleList;
  if (data.complexList && Array.isArray(data.complexList))
    return data.complexList;
  if (data.items && Array.isArray(data.items)) return data.items;
  if (data.data && Array.isArray(data.data)) return data.data;

  return [];
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  const startTime = Date.now();

  // Step 1: Discover working endpoints
  const discoveryResults = await discoverEndpoints();
  const workingEndpoint = discoveryResults.find((r) => r.success);

  if (!workingEndpoint) {
    console.error("\n❌ No working endpoint found. All endpoints failed.");
    console.error("This might be due to:");
    console.error("  - Rate limiting (try again later or increase --delay-ms)");
    console.error(
      "  - API structure changed (check docs/naver_endpoint_map.md)",
    );
    console.error("  - Network issues");

    fs.writeFileSync(
      outputMeta,
      JSON.stringify(
        {
          runId: `naver_${Date.now()}`,
          success: false,
          error: "NO_WORKING_ENDPOINT",
          discoveryResults,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    process.exit(1);
  }

  console.log(`\n✅ Working endpoint found: ${workingEndpoint.url}\n`);

  // Step 2: Collect data
  const samples = await collectData(workingEndpoint.url);

  // Step 3: Save metadata
  const metadata = {
    runId: `naver_${Date.now()}`,
    success: true,
    sigungu,
    cortarNo,
    sampleCap,
    samplesCollected: samples.length,
    workingEndpoint: workingEndpoint.url,
    discoveryResults,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };

  fs.writeFileSync(outputMeta, JSON.stringify(metadata, null, 2));

  console.log(`\n✅ Collection complete!`);
  console.log(`   Samples: ${samples.length}/${sampleCap}`);
  console.log(`   Duration: ${Math.round(metadata.durationMs / 1000)}s`);
  console.log(`   Raw data: ${outputRaw}`);
  console.log(`   Metadata: ${outputMeta}`);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
