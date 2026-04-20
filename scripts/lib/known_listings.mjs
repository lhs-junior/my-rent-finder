import { withDbClient } from "./db_client.mjs";

/**
 * DB에 이미 존재하고 이미지도 있는 매물의 external_id Set을 반환.
 * collector에서 상세 API 호출 전 중복 체크에 사용.
 *
 * @param {string} platformCode - 플랫폼 코드 (e.g. 'zigbang', 'dabang')
 * @param {string[]} externalIds - 확인할 external_id 배열
 * @param {object|null} client - 테스트용 DB client (null이면 pool에서 자동 획득)
 * @returns {Promise<Set<string>>} 이미 DB에 있고 이미지도 있는 external_id Set
 */
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
