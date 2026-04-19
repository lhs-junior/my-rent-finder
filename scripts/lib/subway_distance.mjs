// 매물 좌표 → 최근접 지하철역까지의 도보 거리/시간 추정.
// 접근: 위경도 Haversine 직선거리 × 도보 보정계수(1.25) ≈ 실제 도보 거리.
//  - 서울 도심 기준 Haversine 대비 실측 도보거리의 평균 1.2~1.3배 (격자/건물 우회)
//  - 보행 평속 67m/min (4km/h) 기준으로 분 단위 환산
//
// API 기반 정밀 도보 경로(OpenRouteService 등)는 후속 업그레이드 가능.

const WALK_DETOUR_FACTOR = 1.25;
const WALK_SPEED_M_PER_MIN = 67;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Haversine 직선거리 (m)
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 도보 거리 추정 (m)
export function estimateWalkMeters(lat1, lng1, lat2, lng2) {
  return Math.round(haversineMeters(lat1, lng1, lat2, lng2) * WALK_DETOUR_FACTOR);
}

// 도보 시간 추정 (분, 반올림)
export function estimateWalkMinutes(distanceM) {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return 0;
  return Math.max(1, Math.round(distanceM / WALK_SPEED_M_PER_MIN));
}

// 매물 좌표에 대해 후보 stations 에서 가장 가까운 역 1개 반환
// stations: [{name, lines, lat, lng}, ...]
export function findNearestStation(listingLat, listingLng, stations) {
  if (!Number.isFinite(listingLat) || !Number.isFinite(listingLng)) return null;
  let best = null;
  let bestDistStraight = Infinity;
  for (const s of stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const d = haversineMeters(listingLat, listingLng, s.lat, s.lng);
    if (d < bestDistStraight) {
      bestDistStraight = d;
      best = s;
    }
  }
  if (!best) return null;
  const walkM = Math.round(bestDistStraight * WALK_DETOUR_FACTOR);
  return {
    station: best,
    straight_m: Math.round(bestDistStraight),
    walk_m: walkM,
    walk_min: estimateWalkMinutes(walkM),
  };
}
