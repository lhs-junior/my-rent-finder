import { withDbClient } from "./db_client.mjs";

/**
 * Mark listings as stale if not seen in recent N collection runs.
 * A listing is stale if it wasn't collected in the last `threshold` runs
 * for its platform.
 * 또한 `hardDeleteThreshold` 이상 누락된 매물은 deleted_at 을 세팅해 프론트에서 숨긴다.
 * @param {Object} options - { threshold?: 3, hardDeleteThreshold?: 6 }
 */
export async function detectStaleListings(options = {}) {
  const threshold = options.threshold || 3;
  const hardDeleteThreshold = options.hardDeleteThreshold || Math.max(threshold * 2, 6);

  const results = { checked: 0, marked_stale: 0, cleared: 0, hard_deleted: 0 };

  await withDbClient(async (client) => {
    // Get latest N run_ids per platform
    const platformRuns = await client.query(
      `SELECT platform_code, array_agg(run_id ORDER BY started_at DESC) as recent_runs
       FROM (
         SELECT platform_code, run_id, started_at,
                ROW_NUMBER() OVER (PARTITION BY platform_code ORDER BY started_at DESC) as rn
         FROM collection_runs
         WHERE status IN ('DONE', 'PARTIAL')
       ) sub
       WHERE rn <= $1
       GROUP BY platform_code`,
      [threshold]
    );

    for (const row of platformRuns.rows) {
      const { platform_code, recent_runs } = row;

      // Find listings for this platform that are NOT in any of the recent raw_listings
      const staleResult = await client.query(
        `SELECT nl.listing_id, nl.quality_flags
         FROM normalized_listings nl
         WHERE nl.platform_code = $1
           AND NOT EXISTS (
             SELECT 1 FROM raw_listings rl
             WHERE rl.platform_code = nl.platform_code
               AND rl.external_id = nl.external_id
               AND rl.run_id = ANY($2)
           )`,
        [platform_code, recent_runs]
      );

      results.checked += staleResult.rows.length;

      const toMark = staleResult.rows
        .filter((l) => {
          const flags = Array.isArray(l.quality_flags) ? l.quality_flags : [];
          return !flags.includes("STALE_SUSPECT");
        })
        .map((l) => l.listing_id);

      if (toMark.length > 0) {
        const markResult = await client.query(
          `UPDATE normalized_listings
              SET quality_flags = COALESCE(quality_flags, '[]'::jsonb) || '["STALE_SUSPECT"]'::jsonb,
                  updated_at = NOW()
            WHERE listing_id = ANY($1::bigint[])
              AND NOT (quality_flags::text LIKE '%STALE_SUSPECT%')`,
          [toMark],
        );
        results.marked_stale += markResult.rowCount || 0;
      }

      // Clear stale flag for listings that WERE seen recently
      const clearResult = await client.query(
        `UPDATE normalized_listings
         SET quality_flags = COALESCE(
           (SELECT jsonb_agg(elem)
            FROM jsonb_array_elements(quality_flags) as elem
            WHERE elem::text != '"STALE_SUSPECT"'),
           '[]'::jsonb
         ),
         updated_at = NOW()
         WHERE platform_code = $1
           AND quality_flags::text LIKE '%STALE_SUSPECT%'
           AND EXISTS (
             SELECT 1 FROM raw_listings rl
             WHERE rl.platform_code = normalized_listings.platform_code
               AND rl.external_id = normalized_listings.external_id
               AND rl.run_id = ANY($2)
           )`,
        [platform_code, recent_runs]
      );

      results.cleared += clearResult.rowCount || 0;
    }

    // Hard-delete: 최근 hardDeleteThreshold 회 수집에 한 번도 안 잡힌 매물은 deleted_at 세팅
    const hardRuns = await client.query(
      `SELECT platform_code, array_agg(run_id ORDER BY started_at DESC) as recent_runs
       FROM (
         SELECT platform_code, run_id, started_at,
                ROW_NUMBER() OVER (PARTITION BY platform_code ORDER BY started_at DESC) as rn
         FROM collection_runs
         WHERE status IN ('DONE', 'PARTIAL')
       ) sub
       WHERE rn <= $1
       GROUP BY platform_code`,
      [hardDeleteThreshold]
    );

    for (const row of hardRuns.rows) {
      const { platform_code, recent_runs } = row;
      // 수집 run 수가 hardDeleteThreshold 미만이면 건너뜀 (신규 플랫폼 보호)
      if (!Array.isArray(recent_runs) || recent_runs.length < hardDeleteThreshold) continue;

      const del = await client.query(
        `UPDATE normalized_listings nl
           SET deleted_at = NOW(), updated_at = NOW()
         WHERE nl.platform_code = $1
           AND nl.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM raw_listings rl
             WHERE rl.platform_code = nl.platform_code
               AND rl.external_id = nl.external_id
               AND rl.run_id = ANY($2)
           )
         RETURNING listing_id`,
        [platform_code, recent_runs]
      );
      results.hard_deleted += del.rowCount || 0;
    }
  });

  return results;
}
