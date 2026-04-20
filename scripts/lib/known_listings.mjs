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

/**
 * 이미지를 minCount개 이상 가진 매물만 반환.
 * naver처럼 첫 수집 시 썸네일(1개)만 저장된 매물을
 * 재수집 대상에서 제외하지 않기 위해 사용.
 */
export async function getExistingWithSufficientImages(platformCode, externalIds, minCount = 3, client = null) {
  if (!Array.isArray(externalIds) || externalIds.length === 0) return new Set();

  const ids = externalIds.map(String);

  const query = `
    SELECT nl.external_id
    FROM normalized_listings nl
    JOIN listing_images li ON li.listing_id = nl.listing_id
    WHERE nl.platform_code = $1
      AND nl.external_id = ANY($2)
      AND nl.deleted_at IS NULL
    GROUP BY nl.external_id
    HAVING COUNT(li.image_id) >= $3
  `;

  const run = async (c) => {
    const result = await c.query(query, [platformCode, ids, minCount]);
    return new Set(result.rows.map((r) => String(r.external_id)));
  };

  if (client) return run(client);
  return withDbClient(run);
}
