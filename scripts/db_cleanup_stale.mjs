#!/usr/bin/env node

/**
 * 소프트 딜리트된 매물 하드 삭제 스크립트
 *
 * deleted_at이 설정된 지 --days 일 이상 지난 normalized_listings 행을
 * 연관 테이블과 함께 완전 삭제합니다.
 *
 * 사용법:
 *   node scripts/db_cleanup_stale.mjs               # dry-run (기본 30일)
 *   node scripts/db_cleanup_stale.mjs --apply        # 실제 삭제
 *   node scripts/db_cleanup_stale.mjs --days=14      # 14일 기준
 *   node scripts/db_cleanup_stale.mjs --apply --days=14
 */

import { withDbClient } from "./lib/db_client.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const daysArg = args.find((a) => a.startsWith("--days="));
const retentionDays = daysArg ? Number(daysArg.split("=")[1]) : 30;

if (Number.isNaN(retentionDays) || retentionDays < 1) {
  console.error("--days 값이 올바르지 않습니다.");
  process.exit(1);
}

console.log(`[cleanup] 보존 기간: ${retentionDays}일 / 모드: ${apply ? "실제 삭제" : "dry-run"}`);

await withDbClient(async (client) => {
  const cutoff = `NOW() - INTERVAL '${retentionDays} days'`;

  // 삭제 대상 listing_id 목록 조회
  const targetResult = await client.query(`
    SELECT listing_id, platform_code, external_id, deleted_at
    FROM normalized_listings
    WHERE deleted_at IS NOT NULL
      AND deleted_at < ${cutoff}
    ORDER BY deleted_at ASC
  `);

  const targets = targetResult.rows;

  if (targets.length === 0) {
    console.log(`[cleanup] ${retentionDays}일 초과 소프트 딜리트 매물 없음. 완료.`);
    return;
  }

  const ids = targets.map((r) => r.listing_id);

  console.log(`[cleanup] 삭제 대상: ${ids.length}건`);
  console.log(`  최고령: ${targets[0].deleted_at.toISOString()} (${targets[0].platform_code}/${targets[0].external_id})`);
  console.log(`  최신:   ${targets[targets.length - 1].deleted_at.toISOString()}`);

  // 플랫폼별 분포
  const byPlatform = {};
  for (const r of targets) {
    byPlatform[r.platform_code] = (byPlatform[r.platform_code] ?? 0) + 1;
  }
  console.log("  플랫폼별:", byPlatform);

  if (!apply) {
    console.log("[cleanup] dry-run 완료. 실제 삭제하려면 --apply 플래그를 추가하세요.");
    return;
  }

  // pin_favorites가 걸린 listing_id는 하드 삭제 대상에서 제외 (찜 목록 보호)
  const pinnedRes = await client.query(`
    SELECT DISTINCT listing_id FROM pin_favorites WHERE listing_id = ANY($1::int[])
  `, [ids]);
  const pinnedSet = new Set(pinnedRes.rows.map((r) => String(r.listing_id)));
  const safeIds = ids.filter((id) => !pinnedSet.has(String(id)));
  if (pinnedSet.size > 0) {
    console.log(`[cleanup] 찜 걸린 매물 하드 삭제 제외: ${pinnedSet.size}건 (소프트 딜리트 상태 유지)`);
  }

  if (!safeIds.length) {
    console.log("[cleanup] 하드 삭제 대상 없음 (전부 찜 걸린 매물). 완료.");
    return;
  }

  // NO ACTION FK 테이블 먼저 삭제
  // listing_matches: source 또는 target이 대상인 행 삭제
  const matchDel = await client.query(`
    DELETE FROM listing_matches
    WHERE source_listing_id = ANY($1::int[])
       OR target_listing_id = ANY($1::int[])
  `, [safeIds]);
  console.log(`[cleanup] listing_matches 삭제: ${matchDel.rowCount}건`);

  // match_group_members
  const groupDel = await client.query(`
    DELETE FROM match_group_members
    WHERE listing_id = ANY($1::int[])
  `, [safeIds]);
  console.log(`[cleanup] match_group_members 삭제: ${groupDel.rowCount}건`);

  // contract_violations
  const cvDel = await client.query(`
    DELETE FROM contract_violations
    WHERE listing_id = ANY($1::int[])
  `, [safeIds]);
  console.log(`[cleanup] contract_violations 삭제: ${cvDel.rowCount}건`);

  // normalized_listings 하드 삭제 (CASCADE: listing_images, scored_listings 자동 삭제)
  const mainDel = await client.query(`
    DELETE FROM normalized_listings
    WHERE listing_id = ANY($1::int[])
  `, [safeIds]);
  console.log(`[cleanup] normalized_listings 하드 삭제: ${mainDel.rowCount}건`);

  // 정리 후 DB 크기 확인
  const sizeResult = await client.query(`
    SELECT pg_size_pretty(pg_database_size(current_database())) as db_size
  `);
  console.log(`[cleanup] 현재 DB 크기: ${sizeResult.rows[0].db_size}`);
  console.log("[cleanup] 완료.");
});
