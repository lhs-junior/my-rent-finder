#!/usr/bin/env node
/**
 * 기존 normalized_listings의 jibun_address 백필
 * - kbland: raw_listings.payload_json.address 에서 번지수 추출
 * - naver: raw_listings.payload_json.articleList[*]._detail.articleDetail.exposureAddress 에서 추출
 */

import { withDbClient } from './lib/db_client.mjs';

function extractJibunKey(address) {
  if (!address) return null;
  const parts = String(address).trim().split(/\s+/);
  if (parts.length < 2) return null;
  const lot = parts[parts.length - 1];
  const dong = parts[parts.length - 2];
  if (!/^\d+(?:-\d+)*$/.test(lot)) return null;
  if (!/(?:동|가|리)\d*$/.test(dong)) return null;
  return `${dong} ${lot}`;
}

await withDbClient(async (client) => {
  let updated = 0;

  // ── kbland: raw address 필드에서 번지 추출 ──
  console.log('kbland 백필 중...');
  const kbResult = await client.query(`
    SELECT nl.listing_id, rl.payload_json->>'address' AS raw_address
    FROM normalized_listings nl
    JOIN raw_listings rl ON nl.raw_id = rl.raw_id
    WHERE nl.platform_code = 'kbland'
      AND nl.jibun_address IS NULL
      AND nl.deleted_at IS NULL
      AND rl.payload_json->>'address' IS NOT NULL
    LIMIT 5000
  `);

  for (const row of kbResult.rows) {
    const jibun = extractJibunKey(row.raw_address);
    if (!jibun) continue;
    await client.query(
      `UPDATE normalized_listings SET jibun_address = $1, updated_at = NOW() WHERE listing_id = $2`,
      [jibun, row.listing_id]
    );
    updated++;
  }
  console.log(`  kbland: ${updated}건 업데이트`);

  // ── naver: articleList 내 _detail.articleDetail.exposureAddress 추출 ──
  console.log('naver 백필 중...');
  let naverUpdated = 0;
  const naverResult = await client.query(`
    SELECT nl.listing_id, nl.external_id,
           rl.payload_json->'articleList' AS article_list
    FROM normalized_listings nl
    JOIN raw_listings rl ON nl.raw_id = rl.raw_id
    WHERE nl.platform_code = 'naver'
      AND nl.jibun_address IS NULL
      AND nl.deleted_at IS NULL
      AND rl.payload_json->'articleList' IS NOT NULL
    LIMIT 5000
  `);

  for (const row of naverResult.rows) {
    const articleList = Array.isArray(row.article_list) ? row.article_list : [];
    const article = articleList.find(a => String(a.articleNo || a.atclNo || '') === String(row.external_id));
    const exposureAddr = article?._detail?.articleDetail?.exposureAddress;
    const jibun = extractJibunKey(exposureAddr);
    if (!jibun) continue;
    await client.query(
      `UPDATE normalized_listings SET jibun_address = $1, updated_at = NOW() WHERE listing_id = $2`,
      [jibun, row.listing_id]
    );
    naverUpdated++;
  }
  console.log(`  naver: ${naverUpdated}건 업데이트`);

  const total = updated + naverUpdated;
  console.log(`\n총 ${total}건 jibun_address 백필 완료`);

  // 결과 확인
  const check = await client.query(`
    SELECT platform_code, COUNT(*) as total,
           COUNT(jibun_address) as with_jibun
    FROM normalized_listings WHERE deleted_at IS NULL
    GROUP BY platform_code ORDER BY platform_code
  `);
  console.log('\n=== jibun_address 보유 현황 ===');
  check.rows.forEach(r => console.log(`  ${r.platform_code}: ${r.with_jibun}/${r.total}건`));
});
