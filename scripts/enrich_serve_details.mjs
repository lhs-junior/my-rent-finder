#!/usr/bin/env node

/**
 * 부동산써브 매물 상세 보강 스크립트
 *
 * serve 활성 매물에 getAtclDetail API를 호출해서
 * description_text(dtlDesc)와 building_use(bldUsageCd)를 DB에 업데이트합니다.
 *
 * 사용법:
 *   node scripts/enrich_serve_details.mjs           # dry-run (변경 없음)
 *   node scripts/enrich_serve_details.mjs --apply   # 실제 DB 업데이트
 *   node scripts/enrich_serve_details.mjs --apply --limit=50  # 최대 50건만
 */

import { withDbClient } from "./lib/db_client.mjs";

// ============================================================================
// CLI Arguments
// ============================================================================

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}

const hasFlag = (name) => args.includes(name);

const applyMode = hasFlag("--apply");
const verbose = hasFlag("--verbose");
const limitArg = getArg("--limit", null);
const limit = limitArg !== null ? Math.max(1, Math.floor(Number(limitArg))) : null;

// ============================================================================
// Constants
// ============================================================================

const COMMON_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const API_BASE = "https://www.serve.co.kr";
const DETAIL_DELAY_MS = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[enrich-serve] ${msg}`);
const vlog = (msg) => { if (verbose) process.stderr.write(`[enrich-serve]   ${msg}\n`); };

// ============================================================================
// API
// ============================================================================

async function fetchServeDetail(externalId) {
  const url = `${API_BASE}/good/v1/map/getAtclDetail?atclNo=${encodeURIComponent(externalId)}&tabNo=2`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": COMMON_UA,
      Accept: "application/json",
      Referer: "https://www.serve.co.kr/good/map",
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json = await res.json();
  const resultList = json?.data?.resultList;
  if (!resultList || resultList.length === 0) {
    return null; // 매물 삭제/종료
  }

  return resultList[0];
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  log(`모드: ${applyMode ? "APPLY" : "DRY-RUN"}${limit !== null ? ` (최대 ${limit}건)` : ""}`);
  log("");

  const rows = await withDbClient(async (client) => {
    const sql = `
      SELECT listing_id, external_id
      FROM normalized_listings
      WHERE platform_code = 'serve'
        AND deleted_at IS NULL
      ORDER BY listed_at DESC
      ${limit !== null ? `LIMIT ${limit}` : ""}
    `;
    const result = await client.query(sql);
    return result.rows;
  });

  log(`대상 매물: ${rows.length}건`);

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const { listing_id, external_id } = rows[i];

    vlog(`[${i + 1}/${rows.length}] ${external_id} 조회 중...`);

    let detail;
    try {
      detail = await fetchServeDetail(external_id);
    } catch (err) {
      vlog(`  오류: ${err.message}`);
      failCount++;
      await sleep(DETAIL_DELAY_MS);
      continue;
    }

    if (!detail) {
      vlog(`  스킵 (resultList 없음 — 매물 종료 가능성)`);
      skipCount++;
      await sleep(DETAIL_DELAY_MS);
      continue;
    }

    const rawDesc = typeof detail.dtlDesc === "string" ? detail.dtlDesc.trim() : null;
    const descriptionText = rawDesc && rawDesc.length > 0 ? rawDesc : null;

    const rawUse = typeof detail.bldUsageCd === "string" ? detail.bldUsageCd.trim() : null;
    const buildingUse = rawUse && rawUse.length > 0 ? rawUse : null;

    vlog(`  dtlDesc=${JSON.stringify(descriptionText)} bldUsageCd=${JSON.stringify(buildingUse)}`);

    if (applyMode) {
      try {
        await withDbClient(async (client) => {
          await client.query(
            `UPDATE normalized_listings
             SET description_text = $1,
                 building_use = COALESCE($2, building_use),
                 updated_at = NOW()
             WHERE listing_id = $3`,
            [descriptionText, buildingUse, listing_id],
          );
        });
        successCount++;
      } catch (err) {
        vlog(`  DB 업데이트 오류: ${err.message}`);
        failCount++;
      }
    } else {
      successCount++;
    }

    await sleep(DETAIL_DELAY_MS);
  }

  log("");
  log(`완료: ${successCount}건 업데이트, ${failCount}건 실패, ${skipCount}건 스킵`);
  if (!applyMode) {
    log("(dry-run 모드 — DB 변경 없음. 실제 적용은 --apply 플래그 사용)");
  }
}

main().catch((err) => {
  console.error(`[enrich-serve] Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
