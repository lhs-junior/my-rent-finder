#!/usr/bin/env node

import { fetchPeterpanzDetailImageUrls, collectPeterpanzImageUrls } from "./peterpanz_auto_collector.mjs";
import { withDbClient, toInt, toText } from "./lib/db_client.mjs";

function getArg(name, fallback = null) {
  const args = process.argv.slice(2);
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function parseLimit(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function mergePayloadWithImages(payloadJson, imageUrls) {
  const payload = payloadJson && typeof payloadJson === "object" ? { ...payloadJson } : {};
  payload.info = payload.info && typeof payload.info === "object" ? { ...payload.info } : {};
  payload.image_urls_origin = imageUrls;
  if (!payload.info.thumbnail) {
    payload.info.thumbnail = imageUrls[0] || null;
  }
  return payload;
}

async function upsertListingImages(client, { listingId, rawId, imageUrls, dryRun }) {
  if (!listingId || !rawId || !Array.isArray(imageUrls) || imageUrls.length === 0) return 0;
  if (dryRun) return imageUrls.length;

  let inserted = 0;
  for (let index = 0; index < imageUrls.length; index += 1) {
    const sourceUrl = toText(imageUrls[index], "");
    if (!sourceUrl) continue;
    await client.query(
      `
      INSERT INTO listing_images (
        listing_id,
        raw_id,
        source_url,
        status,
        is_primary
      ) VALUES ($1, $2, $3, 'queued', $4)
      ON CONFLICT (listing_id, source_url) DO UPDATE
      SET raw_id = EXCLUDED.raw_id,
          status = CASE
            WHEN listing_images.status IN ('downloaded') THEN 'downloaded'
            ELSE EXCLUDED.status
          END,
          is_primary = listing_images.is_primary OR EXCLUDED.is_primary
      `,
      [listingId, rawId, sourceUrl, index === 0],
    );
    inserted += 1;
  }

  return inserted;
}

async function updateRawPayload(client, { rawId, payloadJson, dryRun }) {
  if (!rawId || dryRun) return;
  await client.query(
    `UPDATE raw_listings SET payload_json = $1::jsonb, updated_at = NOW() WHERE raw_id = $2`,
    [JSON.stringify(payloadJson), rawId],
  );
}

async function findTargets(client, { limit, sourceRef }) {
  const params = [];
  const cond = [
    "nl.platform_code = 'peterpanz'",
    "nl.deleted_at IS NULL",
  ];

  if (sourceRef) {
    params.push(sourceRef);
    cond.push(`nl.source_ref = $${params.length}`);
  }

  params.push(limit);
  const result = await client.query(
    `
    SELECT
      nl.listing_id,
      nl.raw_id,
      nl.source_ref,
      nl.source_url,
      rl.payload_json,
      COUNT(li.image_id) AS image_count
    FROM normalized_listings nl
    JOIN raw_listings rl ON rl.raw_id = nl.raw_id
    LEFT JOIN listing_images li ON li.listing_id = nl.listing_id
    WHERE ${cond.join(" AND ")}
    GROUP BY nl.listing_id, nl.raw_id, nl.source_ref, nl.source_url, rl.payload_json
    HAVING COUNT(li.image_id) = 0
    ORDER BY nl.created_at DESC
    LIMIT $${params.length}
    `,
    params,
  );

  return result.rows || [];
}

async function main() {
  const limit = parseLimit(getArg("--limit", "100"), 100);
  const sourceRef = toText(getArg("--source-ref", ""), "");
  const dryRun = hasFlag("--dry-run");

  console.log("=".repeat(60));
  console.log("Backfill Peterpanz Images");
  console.log("=".repeat(60));
  console.log(`limit=${limit}${sourceRef ? ` source_ref=${sourceRef}` : ""}${dryRun ? " dry-run" : ""}`);

  await withDbClient(async (client) => {
    const targets = await findTargets(client, { limit, sourceRef });
    console.log(`Found ${targets.length} peterpanz listings without listing_images`);

    let fetched = 0;
    let updated = 0;
    let failed = 0;

    for (const row of targets) {
      const listingId = toInt(row.listing_id, null);
      const rawId = toInt(row.raw_id, null);
      const ref = toText(row.source_ref, "") || toText(row.source_url, "").split("/").filter(Boolean).pop() || "";
      const existingPayloadImages = collectPeterpanzImageUrls(row.payload_json);

      const imageUrls = existingPayloadImages.length > 0
        ? existingPayloadImages
        : await fetchPeterpanzDetailImageUrls(ref).catch(() => []);

      if (imageUrls.length === 0) {
        failed += 1;
        console.log(`- ${ref}: no images found`);
        continue;
      }

      fetched += 1;
      const nextPayload = mergePayloadWithImages(row.payload_json, imageUrls);
      await updateRawPayload(client, { rawId, payloadJson: nextPayload, dryRun });
      await upsertListingImages(client, { listingId, rawId, imageUrls, dryRun });
      updated += 1;
      console.log(`- ${ref}: restored ${imageUrls.length} images${dryRun ? " (dry-run)" : ""}`);
    }

    console.log("");
    console.log(`restored=${updated} fetched=${fetched} failed=${failed}`);
  });
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
