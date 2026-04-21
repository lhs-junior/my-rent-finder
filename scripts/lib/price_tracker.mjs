/**
 * Record price changes for listings that were updated in this run.
 * Must be called AFTER upsert with items derived from a pre-upsert price snapshot.
 *
 * @param {import('pg').Client} client - active DB client (NOT withDbClient — called from inside existing transaction)
 * @param {Array<{listing_id: number, old_rent: number|null, old_deposit: number|null, rent_amount: number|null, deposit_amount: number|null}>} changedItems
 * @param {string} runId
 */
import { isTransientDbError } from "./db_client.mjs";

export async function recordPriceChanges(client, changedItems, runId) {
  if (!changedItems?.length) return { changed: 0 };

  const params = [];
  const placeholders = changedItems.map((item, i) => {
    const b = i * 6;
    params.push(item.listing_id, item.rent_amount, item.deposit_amount, item.old_rent, item.old_deposit, runId);
    return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6})`;
  }).join(",");

  try {
    await client.query(
      `INSERT INTO listing_price_history (listing_id, rent_amount, deposit_amount, previous_rent, previous_deposit, run_id)
       VALUES ${placeholders}`,
      params,
    );
    return { changed: changedItems.length };
  } catch (err) {
    if (isTransientDbError(err)) throw err;
    // Non-fatal: skip if listing was deleted concurrently
    return { changed: 0 };
  }
}

// Keep the old export for backward compatibility (now a no-op stub)
export async function trackPriceChanges(normalizedItems, runId) {
  return { tracked: 0, changed: 0 };
}
