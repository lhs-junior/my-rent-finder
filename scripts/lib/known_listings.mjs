import { withDbClient } from "./db_client.mjs";

export async function getExistingWithImages(platformCode, externalIds, client = null) {
  if (!Array.isArray(externalIds) || externalIds.length === 0) return new Set();

  const ids = externalIds.map(String);

  const query = `
    SELECT DISTINCT nl.external_id
    FROM normalized_listings nl
    JOIN listing_images li ON li.listing_id = nl.listing_id
    WHERE nl.platform_code = $1
      AND nl.external_id = ANY($2)
      AND nl.deleted_at IS NULL
  `;

  const run = async (c) => {
    const result = await c.query(query, [platformCode, ids]);
    return new Set(result.rows.map((r) => String(r.external_id)));
  };

  if (client) return run(client);
  return withDbClient(run);
}
