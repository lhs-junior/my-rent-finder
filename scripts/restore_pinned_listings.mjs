#!/usr/bin/env node
/**
 * 찜된 매물 복구 스크립트
 *
 * 수집 파이프라인이 잘못 소프트 삭제한 pin_favorites 매물의 deleted_at을 NULL로 복구합니다.
 * check_listing_status.mjs가 실제 만료 판단을 담당하므로, 복구 후 상태 재확인이 가능합니다.
 *
 * 사용법:
 *   node scripts/restore_pinned_listings.mjs          # dry-run
 *   node scripts/restore_pinned_listings.mjs --apply  # 실제 복구
 */

import { withDbClient } from "./lib/db_client.mjs";

const apply = process.argv.includes("--apply");
console.log(`[restore] 모드: ${apply ? "실제 복구" : "dry-run"}`);

await withDbClient(async (client) => {
  // 모든 pin_hash에서 찜된 매물 중 deleted_at이 설정된 것 조회
  const target = await client.query(`
    SELECT DISTINCT ON (pf.listing_id)
           pf.listing_id, nl.deleted_at, nl.platform_code, nl.address_text,
           nl.rent_amount, nl.deposit_amount
    FROM pin_favorites pf
    JOIN normalized_listings nl ON nl.listing_id = pf.listing_id
    WHERE nl.deleted_at IS NOT NULL
    ORDER BY pf.listing_id, nl.deleted_at DESC
  `);

  if (target.rows.length === 0) {
    console.log("[restore] 복구 대상 없음. 모든 찜 매물이 정상 상태입니다.");
    return;
  }

  console.log(`[restore] 복구 대상 ${target.rows.length}건:`);
  for (const row of target.rows) {
    console.log(
      `  listing_id=${row.listing_id} platform=${row.platform_code} ` +
      `주소="${row.address_text}" 월세=${row.rent_amount}만 보증금=${row.deposit_amount}만 ` +
      `deleted_at=${row.deleted_at?.toISOString()}`
    );
  }

  if (!apply) {
    console.log("\n[restore] dry-run 완료. 실제 복구하려면 --apply 플래그를 추가하세요.");
    return;
  }

  const ids = target.rows.map((r) => r.listing_id);
  const result = await client.query(
    `UPDATE normalized_listings SET deleted_at = NULL WHERE listing_id = ANY($1::bigint[])`,
    [ids],
  );
  console.log(`\n[restore] ${result.rowCount}건 복구 완료 (deleted_at → NULL).`);
  console.log("[restore] 실제 만료 여부는 check_listing_status.mjs로 재확인하세요.");
});
