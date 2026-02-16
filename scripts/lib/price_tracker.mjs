import { withDbClient } from "./db_client.mjs";

/**
 * Compare current listing prices with stored values.
 * If price changed, insert into listing_price_history.
 * @param {Array} normalizedItems - array of { listing_id, platform_code, external_id, rent_amount, deposit_amount }
 * @param {string} runId
 */
export async function trackPriceChanges(normalizedItems, runId) {
  if (!normalizedItems?.length) return { tracked: 0, changed: 0 };

  let tracked = 0;
  let changed = 0;

  await withDbClient(async (client) => {
    for (const item of normalizedItems) {
      if (!item.listing_id) continue;
      tracked++;

      // Get current stored price
      const current = await client.query(
        `SELECT rent_amount, deposit_amount FROM normalized_listings WHERE listing_id = $1`,
        [item.listing_id]
      );

      if (current.rows.length === 0) continue;

      const stored = current.rows[0];
      const rentChanged = stored.rent_amount !== null && item.rent_amount !== null
        && Math.abs(stored.rent_amount - item.rent_amount) > 0.01;
      const depositChanged = stored.deposit_amount !== null && item.deposit_amount !== null
        && Math.abs(stored.deposit_amount - item.deposit_amount) > 0.01;

      if (rentChanged || depositChanged) {
        changed++;
        await client.query(
          `INSERT INTO listing_price_history (listing_id, rent_amount, deposit_amount, previous_rent, previous_deposit, run_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [item.listing_id, item.rent_amount, item.deposit_amount, stored.rent_amount, stored.deposit_amount, runId]
        );
      }
    }
  });

  return { tracked, changed };
}
