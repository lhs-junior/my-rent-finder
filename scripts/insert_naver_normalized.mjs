#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { withDbClient, ensureFnv11 } from "./lib/db_client.mjs";

function buildCanonicalKey(externalId, sourceUrl, addressCode, rentAmount, depositAmount, areaExclusive) {
  const seed = `naver|${externalId || ""}|${sourceUrl || ""}|${addressCode || ""}|${rentAmount ?? ""}|${depositAmount ?? ""}|${areaExclusive ?? ""}`;
  return ensureFnv11(seed) || ensureFnv11(`naver|${externalId}`) || "11000000000";
}

const args = process.argv.slice(2);
function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=");
}

const inputFiles = args.filter((a) => !a.startsWith("--") && a.endsWith(".json"));
const runId = getArg("--run-id", `manual-naver-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
const dryRun = args.includes("--dry-run");

if (inputFiles.length === 0) {
  console.error("Usage: node insert_naver_normalized.mjs <file1.json> [file2.json ...] [--run-id X] [--dry-run]");
  process.exit(1);
}

const PLATFORM = "naver";
const COLLECTION_RUN_ID = `${runId}::naver`;

async function ensurePlatformAndRun(client) {
  await client.query(`
    INSERT INTO platform_codes (platform_code, platform_name, collection_mode, home_url)
    VALUES ('naver', '네이버 부동산', 'STEALTH_AUTOMATION', 'https://new.land.naver.com')
    ON CONFLICT (platform_code) DO UPDATE SET updated_at = NOW()
  `);
  await client.query(`
    INSERT INTO collection_runs (run_id, platform_code, mode, status, started_at, finished_at)
    VALUES ($1, 'naver', 'STEALTH_AUTOMATION', 'DONE', NOW(), NOW())
    ON CONFLICT (run_id) DO UPDATE SET status = 'DONE', updated_at = NOW()
  `, [COLLECTION_RUN_ID]);
}

async function upsertArticleRawListing(client, articleId) {
  const sourceUrl = `https://fin.land.naver.com/articles/${articleId}`;
  const payload = JSON.stringify({ article_id: articleId, _source: "manual_insert" });
  const hash = crypto.createHash("sha1").update(payload).digest();

  const result = await client.query(`
    INSERT INTO raw_listings (platform_code, external_id, source_url, payload_json, collected_at, run_id, raw_status, raw_hash)
    VALUES ($1, $2, $3, $4::jsonb, NOW(), $5, 'FETCHED', $6)
    ON CONFLICT (platform_code, external_id) DO UPDATE
      SET source_url = EXCLUDED.source_url,
          run_id = EXCLUDED.run_id,
          updated_at = NOW()
    RETURNING raw_id
  `, [PLATFORM, String(articleId), sourceUrl, payload, COLLECTION_RUN_ID, hash]);

  return result.rows?.[0]?.raw_id ?? null;
}

async function upsertNormalizedItem(client, item, rawId) {
  const externalId = String(item.external_id || item.source_ref || "");
  const sourceUrl = item.source_url || `https://fin.land.naver.com/articles/${externalId}`;
  if (!externalId || !rawId) return null;

  const canonicalKey = buildCanonicalKey(
    externalId, sourceUrl,
    item.address_code, item.rent_amount, item.deposit_amount, item.area_exclusive_m2
  );

  const result = await client.query(`
    INSERT INTO normalized_listings (
      platform_code, external_id, canonical_key, source_ref, source_url, raw_id,
      lease_type, rent_amount, deposit_amount,
      area_exclusive_m2, area_exclusive_m2_min, area_exclusive_m2_max,
      area_gross_m2, area_gross_m2_min, area_gross_m2_max,
      area_claimed,
      address_text, address_code,
      title,
      room_count, floor, total_floor,
      direction, building_use, building_name,
      agent_name, agent_phone,
      listed_at, available_date,
      lat, lng,
      quality_flags,
      monthly_management_cost, walk_time_to_subway, parking_possible,
      bathroom_count, sale_price, loan_amount, building_year, description_text,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9,
      $10, $11, $12,
      $13, $14, $15,
      $16,
      $17, $18,
      $19,
      $20, $21, $22,
      $23, $24, $25,
      $26, $27,
      $28, $29,
      $30, $31,
      $32,
      $33, $34, $35,
      $36, $37, $38, $39, $40,
      NOW(), NOW()
    )
    ON CONFLICT (platform_code, external_id) DO UPDATE SET
      canonical_key = EXCLUDED.canonical_key,
      source_url = EXCLUDED.source_url,
      raw_id = EXCLUDED.raw_id,
      lease_type = EXCLUDED.lease_type,
      rent_amount = EXCLUDED.rent_amount,
      deposit_amount = EXCLUDED.deposit_amount,
      area_exclusive_m2 = EXCLUDED.area_exclusive_m2,
      area_exclusive_m2_min = EXCLUDED.area_exclusive_m2_min,
      area_exclusive_m2_max = EXCLUDED.area_exclusive_m2_max,
      area_gross_m2 = EXCLUDED.area_gross_m2,
      area_gross_m2_min = EXCLUDED.area_gross_m2_min,
      area_gross_m2_max = EXCLUDED.area_gross_m2_max,
      area_claimed = EXCLUDED.area_claimed,
      address_text = EXCLUDED.address_text,
      address_code = EXCLUDED.address_code,
      title = EXCLUDED.title,
      room_count = EXCLUDED.room_count,
      floor = EXCLUDED.floor,
      total_floor = EXCLUDED.total_floor,
      direction = EXCLUDED.direction,
      building_use = EXCLUDED.building_use,
      building_name = EXCLUDED.building_name,
      agent_name = EXCLUDED.agent_name,
      agent_phone = EXCLUDED.agent_phone,
      listed_at = EXCLUDED.listed_at,
      available_date = EXCLUDED.available_date,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      quality_flags = COALESCE(EXCLUDED.quality_flags, '[]'::jsonb),
      monthly_management_cost = EXCLUDED.monthly_management_cost,
      walk_time_to_subway = EXCLUDED.walk_time_to_subway,
      parking_possible = EXCLUDED.parking_possible,
      bathroom_count = EXCLUDED.bathroom_count,
      sale_price = EXCLUDED.sale_price,
      loan_amount = EXCLUDED.loan_amount,
      building_year = EXCLUDED.building_year,
      description_text = EXCLUDED.description_text,
      deleted_at = normalized_listings.deleted_at,
      updated_at = NOW()
    RETURNING listing_id
  `, [
    PLATFORM, externalId, canonicalKey, externalId, sourceUrl, rawId,
    item.lease_type ?? "월세",
    item.rent_amount ?? null,
    item.deposit_amount ?? null,
    item.area_exclusive_m2 ?? null,
    item.area_exclusive_m2_min ?? null,
    item.area_exclusive_m2_max ?? null,
    item.area_gross_m2 ?? null,
    item.area_gross_m2_min ?? null,
    item.area_gross_m2_max ?? null,
    item.area_claimed ?? null,
    item.address_text ?? "서울특별시",
    item.address_code ?? "11000000000",
    item.title ?? null,
    item.room_count ?? null,
    item.floor ?? null,
    item.total_floor ?? null,
    item.direction ?? null,
    item.building_use ?? null,
    item.building_name ?? null,
    item.agent_name ?? null,
    item.agent_phone ?? null,
    item.listed_at ?? null,
    item.available_date ?? null,
    item.lat ?? null,
    item.lng ?? null,
    item.validation?.length ? JSON.stringify(item.validation) : '[]',
    item.monthly_management_cost ?? null,
    item.walk_time_to_subway ?? null,
    item.parking_possible ?? null,
    item.bathroom_count ?? null,
    item.sale_price ?? null,
    item.loan_amount ?? null,
    item.building_year ?? null,
    item.description_text ?? null,
  ]);

  return result.rows?.[0]?.listing_id ?? null;
}

async function upsertImages(client, listingId, rawId, imageUrls) {
  if (!imageUrls?.length || !listingId) return 0;
  let inserted = 0;
  for (const url of imageUrls) {
    if (!url) continue;
    await client.query(`
      INSERT INTO listing_images (listing_id, raw_id, source_url, status, is_primary, created_at)
      VALUES ($1, $2, $3, 'queued', false, NOW())
      ON CONFLICT (listing_id, source_url) DO UPDATE SET status = 'queued'
    `, [listingId, rawId, url]);
    inserted++;
  }
  return inserted;
}

async function main() {
  let totalItems = 0;
  let totalInserted = 0;
  let totalImages = 0;
  let totalErrors = 0;

  for (const filePath of inputFiles) {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      console.error(`File not found: ${absPath}`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(absPath, "utf8"));
    const items = Array.isArray(data) ? data : (data.items ?? []);
    console.log(`\n[${path.basename(filePath)}] ${items.length} items`);

    if (dryRun) {
      console.log("  [DRY RUN] skipping DB insert");
      totalItems += items.length;
      continue;
    }

    let fileInserted = 0;
    let fileImages = 0;
    let fileErrors = 0;

    await withDbClient(async (client) => {
      await ensurePlatformAndRun(client);

      for (const item of items) {
        try {
          const articleId = item.external_id || item.source_ref;
          if (!articleId) { fileErrors++; continue; }

          const rawId = await upsertArticleRawListing(client, articleId);
          if (!rawId) { fileErrors++; continue; }

          const listingId = await upsertNormalizedItem(client, item, rawId);
          if (!listingId) { fileErrors++; continue; }

          const imgCount = await upsertImages(client, listingId, rawId, item.image_urls ?? []);
          fileImages += imgCount;
          fileInserted++;
        } catch (e) {
          fileErrors++;
          console.error(`  Error on item ${item.external_id}: ${e.message}`);
        }
      }
    });

    totalItems += items.length;
    totalInserted += fileInserted;
    totalImages += fileImages;
    totalErrors += fileErrors;
    console.log(`  → inserted/updated: ${fileInserted}, images: ${fileImages}, errors: ${fileErrors}`);
  }

  console.log(`\n=== 완료 ===`);
  console.log(`  총 항목: ${totalItems}`);
  console.log(`  삽입/업서트: ${totalInserted}`);
  console.log(`  이미지: ${totalImages}`);
  console.log(`  오류: ${totalErrors}`);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
