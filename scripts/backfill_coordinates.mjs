#!/usr/bin/env node

import { withDbClient, toInt, toNumber, toText } from "./lib/db_client.mjs";
import { extractCoordsFromRaw } from "./lib/geocode_extractor.mjs";
import { geocodeAddress } from "./lib/kakao_geocoder.mjs";

async function backfillFromRawData(client) {
  console.log("\n[Phase 1] Extracting coordinates from raw_listings payload_json...");

  const query = `
    SELECT nl.listing_id, nl.platform_code, rl.payload_json
    FROM normalized_listings nl
    JOIN raw_listings rl ON rl.raw_id = nl.raw_id
    WHERE nl.lat IS NULL
  `;

  const result = await client.query(query);
  const rows = result.rows || [];

  console.log(`Found ${rows.length} listings without coordinates`);

  let extracted = 0;
  let failed = 0;

  for (const row of rows) {
    const listingId = toInt(row.listing_id, null);
    const platformCode = toText(row.platform_code, "");
    const payloadJson = row.payload_json;

    if (!listingId || !payloadJson) {
      failed++;
      continue;
    }

    const { lat, lng } = extractCoordsFromRaw(platformCode, payloadJson);

    if (lat !== null && lng !== null) {
      await client.query(
        `UPDATE normalized_listings
         SET lat = $1, lng = $2, geocode_status = 'raw_extracted'
         WHERE listing_id = $3`,
        [lat, lng, listingId]
      );
      extracted++;
    } else {
      failed++;
    }
  }

  console.log(`✓ Extracted coordinates: ${extracted}`);
  console.log(`✗ Failed to extract: ${failed}`);

  return { extracted, failed };
}

async function backfillFromKakaoGeocoding(client) {
  console.log("\n[Phase 2] Geocoding addresses using Kakao API...");

  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    console.log("⚠ KAKAO_REST_API_KEY not set, skipping geocoding phase");
    return { geocoded: 0, failed: 0 };
  }

  const query = `
    SELECT listing_id, address_text
    FROM normalized_listings
    WHERE lat IS NULL
      AND address_text IS NOT NULL
      AND address_text != ''
    ORDER BY listing_id
  `;

  const result = await client.query(query);
  const rows = result.rows || [];

  console.log(`Found ${rows.length} listings to geocode`);

  if (rows.length === 0) {
    return { geocoded: 0, failed: 0 };
  }

  let geocoded = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const listingId = toInt(row.listing_id, null);
    const addressText = toText(row.address_text, "");

    if (!listingId || !addressText) {
      failed++;
      continue;
    }

    console.log(`[${i + 1}/${rows.length}] Geocoding: ${addressText.substring(0, 50)}...`);

    const { lat, lng } = await geocodeAddress(addressText);

    if (lat !== null && lng !== null) {
      await client.query(
        `UPDATE normalized_listings
         SET lat = $1, lng = $2, geocode_status = 'api_geocoded'
         WHERE listing_id = $3`,
        [lat, lng, listingId]
      );
      geocoded++;
    } else {
      await client.query(
        `UPDATE normalized_listings
         SET geocode_status = 'failed'
         WHERE listing_id = $1`,
        [listingId]
      );
      failed++;
    }
  }

  console.log(`✓ Successfully geocoded: ${geocoded}`);
  console.log(`✗ Failed to geocode: ${failed}`);

  return { geocoded, failed };
}

async function printSummary(client) {
  console.log("\n[Summary]");

  const stats = await client.query(`
    SELECT
      COUNT(*) as total,
      COUNT(lat) as with_coords,
      COUNT(CASE WHEN geocode_status = 'raw_extracted' THEN 1 END) as raw_extracted,
      COUNT(CASE WHEN geocode_status = 'api_geocoded' THEN 1 END) as api_geocoded,
      COUNT(CASE WHEN geocode_status = 'failed' THEN 1 END) as failed,
      COUNT(CASE WHEN lat IS NULL THEN 1 END) as still_missing
    FROM normalized_listings
  `);

  const row = stats.rows[0];
  console.log(`Total listings: ${row.total}`);
  console.log(`With coordinates: ${row.with_coords} (${((row.with_coords / row.total) * 100).toFixed(1)}%)`);
  console.log(`  - Extracted from raw data: ${row.raw_extracted}`);
  console.log(`  - Geocoded via API: ${row.api_geocoded}`);
  console.log(`  - Failed: ${row.failed}`);
  console.log(`  - Still missing: ${row.still_missing}`);
}

async function main() {
  const args = process.argv.slice(2);
  const shouldGeocode = args.includes("--geocode");

  console.log("=".repeat(60));
  console.log("Backfill Coordinates Script");
  console.log("=".repeat(60));

  await withDbClient(async (client) => {
    // Phase 1: Extract from raw data (free, no API needed)
    await backfillFromRawData(client);

    // Phase 2: Kakao Geocoding (only if --geocode flag is passed)
    if (shouldGeocode) {
      await backfillFromKakaoGeocoding(client);
    } else {
      console.log("\n⚠ Skipping geocoding phase. Use --geocode flag to enable Kakao API geocoding.");
    }

    // Print final summary
    await printSummary(client);
  });

  console.log("\n✓ Backfill complete!");
}

// Run if executed directly
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun) {
  main().catch((error) => {
    console.error("\n✗ Error:", error.message);
    process.exit(1);
  });
}

export { backfillFromRawData, backfillFromKakaoGeocoding };
