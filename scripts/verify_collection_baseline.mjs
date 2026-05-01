#!/usr/bin/env node

/**
 * 수집 베이스라인 메트릭 스냅샷.
 * 풀스윕(full) 대비 incremental 모드로 전환했을 때 매물/이미지/상세필드 누락이
 * 발생했는지 비교하기 위한 기준선을 캡처한다.
 *
 * 출력: JSON. 파일로 저장하려면 --out=path 지정.
 *
 * 사용 예:
 *   node scripts/verify_collection_baseline.mjs > reports/baseline-pre.json
 *   node scripts/verify_collection_baseline.mjs --out=reports/baseline-post.json
 */

import fs from "node:fs";
import path from "node:path";
import { withDbClient } from "./lib/db_client.mjs";
import { getArg } from "./lib/cli_utils.mjs";

const args = process.argv.slice(2);
const outPath = getArg(args, "--out", "");

async function fetchPlatformStats(client) {
  const { rows } = await client.query(`
    SELECT
      nl.platform_code AS platform,
      COUNT(*)::int AS active_listings,
      COUNT(*) FILTER (WHERE nl.description_text IS NOT NULL)::int AS with_description,
      COUNT(*) FILTER (WHERE nl.bathroom_count IS NOT NULL)::int AS with_bathroom,
      COUNT(*) FILTER (WHERE nl.direction IS NOT NULL)::int AS with_direction,
      COUNT(*) FILTER (WHERE nl.building_year IS NOT NULL)::int AS with_building_year,
      COUNT(*) FILTER (WHERE nl.jibun_address IS NOT NULL)::int AS with_jibun,
      MIN(nl.updated_at) AS oldest_updated_at,
      MAX(nl.updated_at) AS newest_updated_at,
      ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - nl.updated_at)) / 3600)::numeric, 1)::float AS avg_age_hours
    FROM normalized_listings nl
    WHERE nl.deleted_at IS NULL
    GROUP BY nl.platform_code
    ORDER BY nl.platform_code
  `);
  return rows;
}

async function fetchImageStats(client) {
  const { rows } = await client.query(`
    SELECT
      nl.platform_code AS platform,
      COUNT(DISTINCT nl.listing_id)::int AS active_listings,
      COUNT(DISTINCT nl.listing_id) FILTER (WHERE li.image_id IS NOT NULL)::int AS with_image,
      COALESCE(ROUND(AVG(image_count)::numeric, 2)::float, 0) AS avg_image_count
    FROM normalized_listings nl
    LEFT JOIN listing_images li ON li.listing_id = nl.listing_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS image_count
      FROM listing_images li2
      WHERE li2.listing_id = nl.listing_id
    ) ic ON true
    WHERE nl.deleted_at IS NULL
    GROUP BY nl.platform_code
    ORDER BY nl.platform_code
  `);
  return rows;
}

async function fetchRecentRunStats(client) {
  const { rows } = await client.query(`
    SELECT
      cr.platform_code AS platform,
      cr.run_mode,
      COUNT(*)::int AS run_count,
      MAX(cr.started_at) AS last_started_at
    FROM collection_runs cr
    WHERE cr.started_at > NOW() - INTERVAL '7 days'
    GROUP BY cr.platform_code, cr.run_mode
    ORDER BY cr.platform_code, cr.run_mode
  `);
  return rows;
}

async function fetchStaleStats(client) {
  const { rows } = await client.query(`
    SELECT
      platform_code AS platform,
      COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '3 days')::int AS stale_3d,
      COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '7 days')::int AS stale_7d,
      COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '14 days')::int AS stale_14d_will_be_deleted
    FROM normalized_listings
    WHERE deleted_at IS NULL
    GROUP BY platform_code
    ORDER BY platform_code
  `);
  return rows;
}

function rate(num, den) {
  if (!den || den === 0) return 0;
  return Math.round((num / den) * 1000) / 1000;
}

function decoratePlatformStats(platformRows, imageRows) {
  const imageByPlatform = new Map(imageRows.map((r) => [r.platform, r]));
  return platformRows.map((row) => {
    const img = imageByPlatform.get(row.platform) || {};
    const total = row.active_listings;
    return {
      platform: row.platform,
      active_listings: total,
      with_image: img.with_image ?? null,
      image_rate: rate(img.with_image ?? 0, total),
      avg_image_count: img.avg_image_count ?? null,
      description_rate: rate(row.with_description, total),
      bathroom_rate: rate(row.with_bathroom, total),
      direction_rate: rate(row.with_direction, total),
      building_year_rate: rate(row.with_building_year, total),
      jibun_rate: rate(row.with_jibun, total),
      avg_age_hours: row.avg_age_hours,
      oldest_updated_at: row.oldest_updated_at,
      newest_updated_at: row.newest_updated_at,
    };
  });
}

async function main() {
  const result = await withDbClient(async (client) => {
    const [platformRows, imageRows, runRows, staleRows] = await Promise.all([
      fetchPlatformStats(client),
      fetchImageStats(client),
      fetchRecentRunStats(client),
      fetchStaleStats(client),
    ]);
    return {
      captured_at: new Date().toISOString(),
      platforms: decoratePlatformStats(platformRows, imageRows),
      recent_runs_7d: runRows,
      stale_distribution: staleRows,
    };
  });

  const json = JSON.stringify(result, null, 2);
  if (outPath) {
    const abs = path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, json + "\n");
    console.error(`[baseline] wrote ${abs}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error("[baseline] failed:", err.message);
  process.exit(1);
});
