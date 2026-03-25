/**
 * Record price changes for listings that were updated in this run.
 * Must be called AFTER upsert with items derived from a pre-upsert price snapshot.
 *
 * @param {import('pg').Client} client - active DB client (NOT withDbClient — called from inside existing transaction)
 * @param {Array<{listing_id: number, old_rent: number|null, old_deposit: number|null, rent_amount: number|null, deposit_amount: number|null}>} changedItems
 * @param {string} runId
 */
export async function recordPriceChanges(client, changedItems, runId) {
  if (!changedItems?.length) return { changed: 0 };

  let changed = 0;
  for (const item of changedItems) {
    try {
      await client.query(
        `INSERT INTO listing_price_history (listing_id, rent_amount, deposit_amount, previous_rent, previous_deposit, run_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [item.listing_id, item.rent_amount, item.deposit_amount, item.old_rent, item.old_deposit, runId]
      );
      changed++;
    } catch (err) {
      // Non-fatal: skip if listing was deleted concurrently
    }
  }
  return { changed };
}

// Keep the old export for backward compatibility (now a no-op stub)
export async function trackPriceChanges(normalizedItems, runId) {
  return { tracked: 0, changed: 0 };
}
