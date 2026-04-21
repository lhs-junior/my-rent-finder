#!/usr/bin/env node
/**
 * 기존 피터팬 매물 중 description_text 등 상세 필드가 누락된 것들을
 * 상세 페이지(aptInfo)를 fetch해서 일괄 업데이트한다.
 *
 * 사용법:
 *   node scripts/backfill_peterpanz_details.mjs
 *   node scripts/backfill_peterpanz_details.mjs --dry-run   # DB 업데이트 없이 확인만
 *   node scripts/backfill_peterpanz_details.mjs --limit=50  # 최대 50건만 처리
 */

import { withDbClient } from "./lib/db_client.mjs";
import { extractPeterpanzDetailDataFromHtml } from "./peterpanz_auto_collector.mjs";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

const API_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(msg) { console.log(`[backfill-peterpanz] ${msg}`); }

async function fetchDetailData(hidx) {
  const res = await fetch(`https://www.peterpanz.com/house/${encodeURIComponent(hidx)}`, {
    headers: { "User-Agent": API_USER_AGENT, Accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return extractPeterpanzDetailDataFromHtml(html);
}

async function run() {
  log(`mode: ${isDryRun ? "dry-run" : "update"}, limit: ${Number.isFinite(limit) ? limit : "unlimited"}`);

  const listings = await withDbClient(async (client) => {
    const result = await client.query(`
      SELECT listing_id, external_id
      FROM normalized_listings
      WHERE platform_code = 'peterpanz'
        AND deleted_at IS NULL
        AND description_text IS NULL
      ORDER BY created_at DESC
      ${Number.isFinite(limit) ? `LIMIT ${limit}` : ""}
    `);
    return result.rows;
  });

  log(`대상 매물: ${listings.length}건`);
  if (listings.length === 0) { log("완료 (업데이트 없음)"); return; }

  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const { listing_id, external_id } of listings) {
    try {
      const detail = await fetchDetailData(external_id);

      const hasAnyField = detail.description_text || detail.bathroom_count != null ||
        detail.building_year != null || detail.available_date ||
        detail.jibun_address || detail.agent_name || detail.direction;

      if (!hasAnyField) {
        skipped++;
        continue;
      }

      if (!isDryRun) {
        await withDbClient(async (client) => {
          await client.query(`
            UPDATE normalized_listings SET
              description_text  = COALESCE($2, description_text),
              bathroom_count    = COALESCE($3, bathroom_count),
              building_year     = COALESCE($4, building_year),
              available_date    = COALESCE($5, available_date),
              jibun_address     = COALESCE($6, jibun_address),
              agent_name        = COALESCE($7, agent_name),
              direction         = COALESCE($8, direction),
              updated_at        = NOW()
            WHERE listing_id = $1
          `, [
            listing_id,
            detail.description_text || null,
            detail.bathroom_count != null ? Number(detail.bathroom_count) : null,
            detail.building_year != null ? Number(detail.building_year) : null,
            detail.available_date || null,
            detail.jibun_address || null,
            detail.agent_name || null,
            detail.direction || null,
          ]);
        });
      } else {
        log(`  [dry-run] ${external_id} → desc:${!!detail.description_text} bath:${detail.bathroom_count} year:${detail.building_year} addr:${!!detail.jibun_address}`);
      }

      updated++;
      if (updated % 20 === 0) log(`진행: ${updated}/${listings.length}`);
      await sleep(150);
    } catch (err) {
      failed++;
      log(`  실패 ${external_id}: ${err.message}`);
    }
  }

  log(`완료 — 업데이트: ${updated}, 스킵(데이터없음): ${skipped}, 실패: ${failed}`);
}

run().catch((err) => {
  console.error("[backfill-peterpanz] Fatal:", err.message);
  process.exit(1);
});
