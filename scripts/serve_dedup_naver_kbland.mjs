#!/usr/bin/env node
/**
 * serve_dedup_naver_kbland.mjs
 *
 * 부동산써브(serve) 매물과 동일한 naver/kbland 매물을 찾아 deleted_at으로 마킹.
 *
 * 매칭 기준:
 *   - naver  : serve.raw.naverAtclNo === naver.external_id  (정확 매칭)
 *   - kbland : kbland bascInfo API → 매물유입명='부동산써브'
 *              + 제휴매물식별자내용 === serve.external_id    (정확 매칭)
 *
 * 실행:
 *   node scripts/serve_dedup_naver_kbland.mjs           # dry-run (기본)
 *   node scripts/serve_dedup_naver_kbland.mjs --apply   # 실제 적용
 */

import { withDbClient } from './lib/db_client.mjs';

const DRY_RUN = !process.argv.includes('--apply');
const CONCURRENCY = 8; // bascInfo API 동시 요청 수

const KB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  Accept: 'application/json',
  Referer: 'https://kbland.kr/',
};

async function fetchBascInfo(externalId) {
  try {
    const url = `https://api.kbland.kr/land-property/property/bascInfo?${encodeURIComponent('매물일련번호')}=${externalId}&${encodeURIComponent('매물노출요청')}=Y`;
    const res = await fetch(url, { headers: KB_HEADERS });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.dataBody?.data?.bascInfo || null;
  } catch {
    return null;
  }
}

async function runWithConcurrency(tasks, limit) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  await withDbClient(async (client) => {

    // ── 1. naver 매칭: naverAtclNo 정확 매칭 ─────────────────────────────────
    const naverRes = await client.query(`
      SELECT
        nl_serve.listing_id  AS serve_id,
        nl_naver.listing_id  AS target_id,
        nl_naver.address_text,
        nl_naver.rent_amount,
        nl_naver.deposit_amount,
        rl.payload_json->>'naverAtclNo' AS naver_ref
      FROM normalized_listings nl_serve
      JOIN raw_listings rl ON nl_serve.raw_id = rl.raw_id
      JOIN normalized_listings nl_naver
        ON nl_naver.external_id = rl.payload_json->>'naverAtclNo'
        AND nl_naver.platform_code = 'naver'
        AND nl_naver.deleted_at IS NULL
      WHERE nl_serve.platform_code = 'serve'
        AND nl_serve.deleted_at IS NULL
        AND rl.payload_json->>'naverAtclNo' IS NOT NULL
    `);

    // ── 2. kbland 매칭: bascInfo API → serve 출처 확인 ───────────────────────
    const kbRows = await client.query(`
      SELECT listing_id, external_id, address_text, rent_amount, deposit_amount
      FROM normalized_listings
      WHERE platform_code = 'kbland' AND deleted_at IS NULL
    `);

    // serve external_id 셋 (빠른 룩업)
    const serveRes = await client.query(`
      SELECT external_id FROM normalized_listings
      WHERE platform_code = 'serve' AND deleted_at IS NULL
    `);
    const serveExternalIds = new Set(serveRes.rows.map(r => r.external_id));

    console.log(`\n[serve dedup]`);
    console.log(`  kbland ${kbRows.rows.length}건에 대해 bascInfo API 조회 중...`);

    const kblandMatches = [];
    const tasks = kbRows.rows.map(row => async () => {
      const info = await fetchBascInfo(row.external_id);
      if (!info) return;
      const isServe = String(info['매물유입명'] || '').includes('써브') ||
                      String(info['매물유입명'] || '').toLowerCase().includes('serve');
      if (!isServe) return;
      const partnerAtclNo = info['제휴매물식별자내용']
        ? String(info['제휴매물식별자내용'])
        : null;
      if (partnerAtclNo && serveExternalIds.has(partnerAtclNo)) {
        kblandMatches.push({
          target_id: row.listing_id,
          serve_atcl_no: partnerAtclNo,
          address_text: row.address_text,
          rent_amount: row.rent_amount,
        });
      }
    });

    await runWithConcurrency(tasks, CONCURRENCY);

    const naverIds  = [...new Set(naverRes.rows.map(r => r.target_id))];
    const kblandIds = [...new Set(kblandMatches.map(r => r.target_id))];

    console.log(`  naver 매칭: ${naverRes.rows.length}건 → 중복제거 대상 ${naverIds.length}건`);
    console.log(`  kbland 매칭 (bascInfo): ${kblandMatches.length}건 → 중복제거 대상 ${kblandIds.length}건`);

    if (DRY_RUN) {
      console.log('\n[dry-run] 실제 변경 없음. --apply 옵션으로 적용하세요.\n');

      console.log('--- naver 삭제 대상 샘플 (최대 5건) ---');
      naverRes.rows.slice(0, 5).forEach(r =>
        console.log(`  serve ${r.serve_id} → naver ${r.target_id}  ${r.address_text}  월세${r.rent_amount}/보증${r.deposit_amount}`)
      );

      console.log('\n--- kbland 삭제 대상 샘플 (최대 5건) ---');
      kblandMatches.slice(0, 5).forEach(r =>
        console.log(`  kbland ${r.target_id}  ${r.address_text}  월세${r.rent_amount}  serve:${r.serve_atcl_no}`)
      );
      return;
    }

    // ── 실제 적용 ────────────────────────────────────────────────────────────
    const now = new Date().toISOString();

    if (naverIds.length > 0) {
      const res = await client.query(
        `UPDATE normalized_listings
         SET deleted_at = $1, updated_at = $1
         WHERE listing_id = ANY($2::bigint[])
           AND deleted_at IS NULL
           AND listing_id NOT IN (SELECT listing_id FROM pin_favorites)`,
        [now, naverIds]
      );
      console.log(`  naver ${res.rowCount}건 deleted_at 마킹 완료`);
    }

    if (kblandIds.length > 0) {
      const res = await client.query(
        `UPDATE normalized_listings
         SET deleted_at = $1, updated_at = $1
         WHERE listing_id = ANY($2::bigint[])
           AND deleted_at IS NULL
           AND listing_id NOT IN (SELECT listing_id FROM pin_favorites)`,
        [now, kblandIds]
      );
      console.log(`  kbland ${res.rowCount}건 deleted_at 마킹 완료`);
    }

    // scored_listings에서도 제거 (재채점 필요)
    const allDeletedIds = [...naverIds, ...kblandIds];
    if (allDeletedIds.length > 0) {
      const res = await client.query(
        `DELETE FROM scored_listings WHERE listing_id = ANY($1::bigint[])`,
        [allDeletedIds]
      );
      console.log(`  scored_listings에서 ${res.rowCount}건 제거 (재채점 필요)`);
    }

    console.log('\n완료. serve 매물이 우선으로 적용됩니다.');
    console.log('재채점: node scripts/score_listings.mjs\n');
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
