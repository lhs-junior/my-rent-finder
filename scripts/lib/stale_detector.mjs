import { withDbClient } from "./db_client.mjs";

// 매물별 `raw_listings.collected_at` 의 MAX 로 "마지막 수집 시각" 을 구하고,
// 이 시각이 임계일 이상 경과한 매물을 stale/expired 로 판정한다.
//
// 이전 구현(최근 N runs 에 포함 여부)은 빈 collection_run 이 섞이면
// 대량 오삭제를 유발해서 기각 — 매물 기준 "마지막 수집" 시각이 가장 정확하다.
//
// @param options.staleThresholdDays     기본 3  → STALE_SUSPECT 플래그
// @param options.hardDeleteThresholdDays 기본 14 → deleted_at 세팅
// @param options.minRunsForHardDelete   기본 2  → 해당 기간 내 실질 수집 run 이 최소 이만큼 있어야 hard-delete (과잉 삭제 방지)
export async function detectStaleListings(options = {}) {
  const staleThresholdDays = options.staleThresholdDays ?? 3;
  const hardDeleteThresholdDays = options.hardDeleteThresholdDays ?? 14;
  const minRunsForHardDelete = options.minRunsForHardDelete ?? 2;

  const results = { checked: 0, marked_stale: 0, cleared: 0, hard_deleted: 0 };

  await withDbClient(async (client) => {
    // 1) STALE_SUSPECT 마킹: 마지막 수집 후 staleThresholdDays 이상 경과한 활성 매물
    const markRes = await client.query(
      `UPDATE normalized_listings nl
          SET quality_flags = COALESCE(nl.quality_flags, '[]'::jsonb) || '["STALE_SUSPECT"]'::jsonb,
              updated_at = NOW()
         FROM (
           SELECT n.listing_id,
                  COALESCE(MAX(r.collected_at), n.created_at) AS last_seen
             FROM normalized_listings n
             LEFT JOIN raw_listings r
               ON r.platform_code = n.platform_code AND r.external_id = n.external_id
            WHERE n.deleted_at IS NULL
            GROUP BY n.listing_id, n.created_at
         ) ls
        WHERE nl.listing_id = ls.listing_id
          AND nl.deleted_at IS NULL
          AND ls.last_seen < NOW() - ($1::int || ' days')::interval
          AND NOT (nl.quality_flags::text LIKE '%STALE_SUSPECT%')`,
      [staleThresholdDays],
    );
    results.marked_stale = markRes.rowCount || 0;

    // 2) STALE_SUSPECT 해제: 최근 다시 수집된 매물
    const clearRes = await client.query(
      `UPDATE normalized_listings nl
          SET quality_flags = COALESCE(
                (SELECT jsonb_agg(elem) FROM jsonb_array_elements(nl.quality_flags) AS elem
                  WHERE elem::text != '"STALE_SUSPECT"'),
                '[]'::jsonb
              ),
              updated_at = NOW()
         FROM (
           SELECT n.listing_id,
                  COALESCE(MAX(r.collected_at), n.created_at) AS last_seen
             FROM normalized_listings n
             LEFT JOIN raw_listings r
               ON r.platform_code = n.platform_code AND r.external_id = n.external_id
            WHERE n.deleted_at IS NULL
            GROUP BY n.listing_id, n.created_at
         ) ls
        WHERE nl.listing_id = ls.listing_id
          AND nl.deleted_at IS NULL
          AND ls.last_seen >= NOW() - ($1::int || ' days')::interval
          AND nl.quality_flags::text LIKE '%STALE_SUSPECT%'`,
      [staleThresholdDays],
    );
    results.cleared = clearRes.rowCount || 0;

    // 3) Hard delete 안전장치:
    //    기간(hardDeleteThresholdDays) 동안 플랫폼별 실질 수집 run 이 minRunsForHardDelete 이상 있는 경우에만
    //    그 플랫폼 매물을 hard-delete 대상에 포함
    const platformStats = await client.query(
      `SELECT cr.platform_code,
              COUNT(DISTINCT cr.run_id) FILTER (WHERE rl_count.cnt > 0) AS substantive_runs
         FROM collection_runs cr
         LEFT JOIN (
           SELECT run_id, COUNT(*) AS cnt FROM raw_listings
            WHERE collected_at >= NOW() - ($1::int || ' days')::interval
            GROUP BY run_id
         ) rl_count ON rl_count.run_id = cr.run_id
        WHERE cr.started_at >= NOW() - ($1::int || ' days')::interval
          AND cr.status IN ('DONE', 'PARTIAL')
        GROUP BY cr.platform_code`,
      [hardDeleteThresholdDays],
    );
    const eligiblePlatforms = platformStats.rows
      .filter((r) => Number(r.substantive_runs) >= minRunsForHardDelete)
      .map((r) => r.platform_code);

    if (eligiblePlatforms.length > 0) {
      const delRes = await client.query(
        `UPDATE normalized_listings nl
            SET deleted_at = NOW(), updated_at = NOW()
           FROM (
             SELECT n.listing_id,
                    COALESCE(MAX(r.collected_at), n.created_at) AS last_seen
               FROM normalized_listings n
               LEFT JOIN raw_listings r
                 ON r.platform_code = n.platform_code AND r.external_id = n.external_id
              WHERE n.deleted_at IS NULL AND n.platform_code = ANY($2::text[])
              GROUP BY n.listing_id, n.created_at
           ) ls
          WHERE nl.listing_id = ls.listing_id
            AND nl.deleted_at IS NULL
            AND ls.last_seen < NOW() - ($1::int || ' days')::interval`,
        [hardDeleteThresholdDays, eligiblePlatforms],
      );
      results.hard_deleted = delRes.rowCount || 0;
    }

    results.checked = results.marked_stale + results.cleared + results.hard_deleted;
  });

  return results;
}
