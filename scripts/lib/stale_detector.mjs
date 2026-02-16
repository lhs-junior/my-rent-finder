import { withDbClient } from "./db_client.mjs";

/**
 * Mark listings as stale if not seen in recent N collection runs.
 * A listing is stale if it wasn't collected in the last `threshold` runs
 * for its platform.
 * @param {Object} options - { threshold: number of missed runs, default 3 }
 */
export async function detectStaleListings(options = {}) {
  const threshold = options.threshold || 3;

  const results = { checked: 0, marked_stale: 0, cleared: 0 };

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

      for (const listing of staleResult.rows) {
        const flags = Array.isArray(listing.quality_flags) ? listing.quality_flags : [];
        if (!flags.includes("STALE_SUSPECT")) {
          const updatedFlags = [...flags, "STALE_SUSPECT"];
          await client.query(
            `UPDATE normalized_listings SET quality_flags = $1::jsonb, updated_at = NOW() WHERE listing_id = $2`,
            [JSON.stringify(updatedFlags), listing.listing_id]
          );
          results.marked_stale++;
        }
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
  });

  return results;
}
