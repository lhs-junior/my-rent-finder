#!/usr/bin/env node

// 수집 직후 정규화 JSON에서 image_urls를 읽어 listing_images에 백필.
// persistence 다중 구 처리 중 이미지가 누락되는 케이스를 후처리로 복구.
//
// 사용법:
//   node scripts/backfill_images_from_run.mjs              # 최신 run 자동 탐지
//   node scripts/backfill_images_from_run.mjs <runDir>     # 특정 run 디렉토리 지정
//   node scripts/backfill_images_from_run.mjs --dry-run    # 변경 없이 미리보기

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withDbClient } from "./lib/db_client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runsDir = path.join(__dirname, "parallel_collect_runs");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targetArg = args.find((a) => !a.startsWith("--"));

function findLatestRunDir() {
  const entries = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}/.test(d.name))
    .map((d) => d.name)
    .sort();
  if (entries.length === 0) throw new Error("No run directory found");
  return path.join(runsDir, entries[entries.length - 1]);
}

const runDir = targetArg ? path.resolve(targetArg) : findLatestRunDir();
console.log(`[backfill-images] run directory: ${runDir}`);

// 각 플랫폼 normalized JSON에서 (external_id, image_urls) 매핑 추출
function collectImageUrlsByExtId() {
  const platformMap = new Map(); // platform -> Map(external_id -> string[])
  const files = fs.readdirSync(runDir).filter((f) => f.endsWith(".json") && f.includes("_normalized_"));
  for (const f of files) {
    const platform = f.split("_")[0];
    const data = JSON.parse(fs.readFileSync(path.join(runDir, f), "utf8"));
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!platformMap.has(platform)) platformMap.set(platform, new Map());
    const m = platformMap.get(platform);
    for (const item of items) {
      const extId = item?.external_id || item?.externalId || item?.source_ref;
      const imgs = Array.isArray(item?.image_urls) ? item.image_urls.filter((u) => typeof u === "string" && u.startsWith("http")) : [];
      if (!extId || imgs.length === 0) continue;
      const key = String(extId);
      const existing = m.get(key) || [];
      // 가장 많은 URL을 가진 쪽으로 머지 (구가 다른 곳에서 더 많이 잡혔을 수 있음)
      if (imgs.length > existing.length) m.set(key, imgs);
    }
  }
  return platformMap;
}

const platformMap = collectImageUrlsByExtId();
for (const [plat, m] of platformMap) {
  console.log(`[backfill-images]   ${plat}: ${m.size}건 (image_urls 보유)`);
}

await withDbClient(async (client) => {
  let totalInserted = 0;
  let totalListingsFixed = 0;
  for (const [platform, extIdToUrls] of platformMap) {
    const extIds = Array.from(extIdToUrls.keys());
    if (extIds.length === 0) continue;

    // 활성 + 이미지 없는 매물의 (listing_id, raw_id, external_id) 조회
    const r = await client.query(
      `
        SELECT nl.listing_id, nl.raw_id, nl.external_id
        FROM normalized_listings nl
        WHERE nl.platform_code = $1
          AND nl.deleted_at IS NULL
          AND nl.external_id = ANY($2::text[])
          AND NOT EXISTS (SELECT 1 FROM listing_images li WHERE li.listing_id = nl.listing_id)
      `,
      [platform, extIds],
    );
    if (r.rows.length === 0) {
      console.log(`[backfill-images] ${platform}: 백필 대상 없음`);
      continue;
    }

    let platformInserted = 0;
    let platformListings = 0;
    for (const row of r.rows) {
      const urls = extIdToUrls.get(String(row.external_id)) || [];
      if (urls.length === 0) continue;

      if (dryRun) {
        platformInserted += urls.length;
        platformListings += 1;
        continue;
      }

      // ON CONFLICT로 안전하게 INSERT
      try {
        for (let i = 0; i < urls.length; i += 1) {
          await client.query(
            `
              INSERT INTO listing_images (listing_id, raw_id, source_url, status, is_primary)
              VALUES ($1, $2, $3, 'queued', $4)
              ON CONFLICT (listing_id, source_url) DO UPDATE
              SET raw_id = EXCLUDED.raw_id,
                  is_primary = listing_images.is_primary OR EXCLUDED.is_primary
            `,
            [row.listing_id, row.raw_id, urls[i], i === 0],
          );
        }
        platformInserted += urls.length;
        platformListings += 1;
      } catch (e) {
        console.warn(`[backfill-images] ${platform} listing_id=${row.listing_id} 실패: ${e.message}`);
      }
    }
    console.log(
      `[backfill-images] ${platform}: ${platformListings}개 매물에 ${platformInserted}건 이미지 ${dryRun ? "(dry-run)" : "백필"} 완료`,
    );
    totalInserted += platformInserted;
    totalListingsFixed += platformListings;
  }
  console.log(
    `\n[backfill-images] ✅ 전체: ${totalListingsFixed}개 매물 / ${totalInserted}건 이미지 ${dryRun ? "(dry-run)" : "백필"} 완료`,
  );
});
process.exit(0);
