import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import KakaoMap from "./KakaoMap.jsx";
import MapLeftPanel from "./MapLeftPanel.jsx";
import MapBottomSheet from "./MapBottomSheet.jsx";
import MapControls from "./MapControls.jsx";
import DetailModal from "../DetailModal.jsx";
import { useMapListings } from "../../hooks/useMapListings.js";

const MY_PICK_LAST_SEEN_KEY = "myPickLastSeenAt";
const MY_PICK_SEEN_IDS_KEY = "myPickSeenIds";

function readMyPickLastSeenAt() {
  try {
    const raw = localStorage.getItem(MY_PICK_LAST_SEEN_KEY);
    if (!raw) return 0;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function writeMyPickLastSeenAt(ts) {
  try { localStorage.setItem(MY_PICK_LAST_SEEN_KEY, String(ts)); } catch { /* ignore */ }
}

function readMyPickSeenIds() {
  try {
    const raw = localStorage.getItem(MY_PICK_SEEN_IDS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeMyPickSeenIds(set) {
  try { localStorage.setItem(MY_PICK_SEEN_IDS_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

const MY_PICK_SEEN_HASHES_KEY = "myPickSeenHashes";

function makeListingHash(item) {
  if (!item) return null;
  const addr = (item.address_text || "").trim();
  if (!addr) return null;
  const rent = item.rent_amount ?? "";
  const deposit = item.deposit_amount ?? "";
  const area = item.area_exclusive_m2 ?? item.area_m2 ?? "";
  return `${addr}|${rent}|${deposit}|${area}`;
}

function readMyPickSeenHashes() {
  try {
    const raw = localStorage.getItem(MY_PICK_SEEN_HASHES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeMyPickSeenHashes(set) {
  try { localStorage.setItem(MY_PICK_SEEN_HASHES_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

function formatRelativeKr(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "방금";
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}주 전`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}개월 전`;
  return `${Math.floor(day / 365)}년 전`;
}

const INITIAL_CENTER = { lat: 37.5665, lng: 126.978 };
const INITIAL_ZOOM = 13;
const MAP_CARD_FOCUS_ZOOM = 4;

const SEOUL_WIDE_BOUNDS = {
  sw: { lat: 37.40, lng: 126.75 },
  ne: { lat: 37.72, lng: 127.25 },
};

function hasNonModeFilters(f) {
  return !!(
    f.lease_type || f.platform_code ||
    f.min_rent || f.max_rent ||
    f.min_deposit || f.max_deposit ||
    f.min_area || f.max_area ||
    f.min_floor || f.has_image ||
    f.max_subway_m
  );
}

function toFiniteCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export default function MapView({ apiBase, isFavorite, toggleFavorite, getFavoriteGrade, authenticated, pin, focusListing, onFocusConsumed }) {
  const { markers: geoMarkers, totalInBounds, loading: geoLoading, error, fetchMarkers } = useMapListings(apiBase);
  const [favMarkers, setFavMarkers] = useState([]);
  const [favLoading, setFavLoading] = useState(false);
  const [aiMarkers, setAiMarkers] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [myPickMarkers, setMyPickMarkers] = useState([]);
  const [myPickLoading, setMyPickLoading] = useState(false);
  const [myPickLastSeenAt, setMyPickLastSeenAt] = useState(() => readMyPickLastSeenAt());
  const [myPickSeenIds, setMyPickSeenIds] = useState(() => readMyPickSeenIds());
  const [myPickSeenHashes, setMyPickSeenHashes] = useState(() => readMyPickSeenHashes());
  const [myPickUnseenOnly, setMyPickUnseenOnly] = useState(false);
  const [filters, setFilters] = useState({});

  // 찜만 보기 활성화 시 favorites API에서 직접 마커 로드
  useEffect(() => {
    if (!filters.only_favorites) {
      setFavMarkers([]);
      return;
    }
    setFavLoading(true);
    const sortParam = filters.sort || "";
    const fetchFav = authenticated && pin
      ? fetch(`${apiBase}/api/profile/favorites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin, sort: sortParam }),
        })
      : fetch(`${apiBase}/api/favorites${sortParam ? `?sort=${sortParam}` : ""}`);

    fetchFav
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then(data => {
        const items = data.items || [];
        setFavMarkers(
          items
            .filter(it => it.lat != null && it.lng != null && !it.is_expired)
            .map(it => ({
              listing_id: it.listing_id,
              lat: it.lat,
              lng: it.lng,
              rent_amount: it.rent_amount,
              deposit_amount: it.deposit_amount,
              address_text: it.address_text,
              area_exclusive_m2: it.area_exclusive_m2,
              floor: it.floor,
              room_count: it.room_count,
              lease_type: it.lease_type,
              platform_code: it.platform_code || null,
              grade: it.grade || null,
              listed_at: it.listed_at || null,
              nearest_subway_station: it.nearest_subway_station || null,
              nearest_subway_line: it.nearest_subway_line || null,
              subway_distance_m: it.subway_distance_m ?? null,
              subway_walk_min: it.subway_walk_min ?? null,
            }))
        );
      })
      .catch(() => setFavMarkers([]))
      .finally(() => setFavLoading(false));
  }, [filters.only_favorites, authenticated, pin, apiBase, filters.sort]);

  // AI 추천만 보기 활성화 시 scores API에서 마커 로드
  useEffect(() => {
    if (!filters.only_ai) {
      setAiMarkers([]);
      return;
    }
    setAiLoading(true);
    const sortQs = filters.sort ? `&sort=${filters.sort}` : "";
    fetch(`${apiBase}/api/scores?grade=SS,S,A&limit=500${sortQs}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then(data => {
        const items = data.items || [];
        setAiMarkers(
          items
            .filter(it => it.lat != null && it.lng != null)
            .map(it => ({
              listing_id: it.listing_id,
              lat: it.lat,
              lng: it.lng,
              rent_amount: it.rent_amount,
              deposit_amount: it.deposit_amount,
              address_text: it.address_text,
              area_exclusive_m2: it.area_exclusive_m2,
              floor: it.floor,
              room_count: it.room_count,
              lease_type: it.lease_type,
              platform_code: it.platform_code || null,
              grade: it.grade || null,
              total_score: it.total_score || null,
              listed_at: it.listed_at || null,
              nearest_subway_station: it.nearest_subway_station || null,
              nearest_subway_line: it.nearest_subway_line || null,
              subway_distance_m: it.subway_distance_m ?? null,
              subway_walk_min: it.subway_walk_min ?? null,
            }))
        );
      })
      .catch(() => setAiMarkers([]))
      .finally(() => setAiLoading(false));
  }, [filters.only_ai, apiBase, filters.sort]);

  // 내 조건 보기 활성화 시 my-pick API에서 마커 로드
  useEffect(() => {
    if (!filters.only_my_pick) {
      setMyPickMarkers([]);
      return;
    }
    setMyPickLoading(true);
    const sortQs = filters.sort ? `?sort=${encodeURIComponent(filters.sort)}` : "";
    fetch(`${apiBase}/api/listings/my-pick${sortQs}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then(data => {
        const items = data.listings || [];
        setMyPickMarkers(
          items
            .filter(it => it.lat != null && it.lng != null)
            .map(it => ({
              listing_id: it.listing_id,
              lat: it.lat,
              lng: it.lng,
              rent_amount: it.rent_amount,
              deposit_amount: it.deposit_amount,
              address_text: it.address_text,
              area_exclusive_m2: it.area_exclusive_m2,
              floor: it.floor,
              room_count: it.room_count,
              lease_type: it.lease_type,
              platform_code: it.platform_code || null,
              grade: it.grade || null,
              total_score: it.total_score || null,
              listed_at: it.listed_at || null,
              created_at: it.created_at || null,
              nearest_subway_station: it.nearest_subway_station || null,
              nearest_subway_line: it.nearest_subway_line || null,
              subway_distance_m: it.subway_distance_m ?? null,
              subway_walk_min: it.subway_walk_min ?? null,
            }))
        );
      })
      .catch(() => setMyPickMarkers([]))
      .finally(() => setMyPickLoading(false));
  }, [filters.only_my_pick, apiBase, filters.sort]);

  const hasActiveFilters = hasNonModeFilters(filters);
  const isLocalMode = filters.only_favorites || filters.only_ai || filters.only_my_pick || hasActiveFilters;

  const markers = filters.only_my_pick ? myPickMarkers : filters.only_ai ? aiMarkers : filters.only_favorites ? favMarkers : geoMarkers;
  const loading = filters.only_my_pick ? myPickLoading : filters.only_ai ? aiLoading : filters.only_favorites ? favLoading : geoLoading;

  const displayedMarkers = (() => {
    let result = markers;
    if (filters.only_favorites || filters.only_ai || filters.only_my_pick) {
      // AI/찜 모드: 서버 필터링 없이 로컬에서 모든 조건 적용
      if (filters.grade) {
        result = result.filter(m => {
          const grade = m.grade || (getFavoriteGrade ? getFavoriteGrade(m.listing_id) : null);
          return grade === filters.grade;
        });
      }
      if (filters.min_rent) {
        const minR = Number(filters.min_rent);
        result = result.filter(m => m.rent_amount != null && m.rent_amount >= minR);
      }
      if (filters.max_rent) {
        const maxR = Number(filters.max_rent);
        result = result.filter(m => m.rent_amount != null && m.rent_amount <= maxR);
      }
      if (filters.min_area) {
        const minA = Number(filters.min_area);
        result = result.filter(m => {
          const a = m.area_exclusive_m2 ?? m.area_m2;
          return a != null && a >= minA;
        });
      }
      if (filters.max_area) {
        const maxA = Number(filters.max_area);
        result = result.filter(m => {
          const a = m.area_exclusive_m2 ?? m.area_m2;
          return a != null && a <= maxA;
        });
      }
      if (filters.platform_code) {
        result = result.filter(m => m.platform_code === filters.platform_code);
      }
      if (filters.lease_type) {
        result = result.filter(m => m.lease_type === filters.lease_type);
      }
      if (filters.min_floor) {
        const minF = Number(filters.min_floor);
        result = result.filter(m => m.floor != null && m.floor >= minF);
      }
      if (filters.max_subway_m) {
        const maxSw = Number(filters.max_subway_m);
        result = result.filter(m => m.subway_distance_m != null && m.subway_distance_m <= maxSw);
      }
    }
    // 내 조건 모드: 미열람(_unseen) 플래그 부여 + 신규만 필터
    // 정렬 순서는 서버 응답(filters.sort)을 그대로 따름. NEW는 시각 표시로만 강조.
    if (filters.only_my_pick) {
      result = result.map(m => {
        const t = m.created_at ? new Date(m.created_at).getTime() : 0;
        const fresh = Number.isFinite(t) && t > myPickLastSeenAt;
        const seenById = myPickSeenIds.has(String(m.listing_id));
        const hash = makeListingHash(m);
        const seenByHash = hash && myPickSeenHashes.has(hash);
        const isUnseen = fresh && !seenById && !seenByHash;
        return isUnseen === !!m._unseen ? m : { ...m, _unseen: isUnseen };
      });
      if (myPickUnseenOnly) result = result.filter(m => m._unseen);
    }
    return result;
  })();

  const myPickUnseenCount = useMemo(() => {
    if (!filters.only_my_pick) return 0;
    return myPickMarkers.reduce((acc, m) => {
      const t = m.created_at ? new Date(m.created_at).getTime() : 0;
      const fresh = Number.isFinite(t) && t > myPickLastSeenAt;
      if (!fresh) return acc;
      if (myPickSeenIds.has(String(m.listing_id))) return acc;
      const hash = makeListingHash(m);
      if (hash && myPickSeenHashes.has(hash)) return acc;
      return acc + 1;
    }, 0);
  }, [filters.only_my_pick, myPickMarkers, myPickLastSeenAt, myPickSeenIds, myPickSeenHashes]);

  const markAllMyPickSeen = useCallback(() => {
    const now = Date.now();
    writeMyPickLastSeenAt(now);
    setMyPickLastSeenAt(now);
    writeMyPickSeenIds(new Set());
    setMyPickSeenIds(new Set());
    writeMyPickSeenHashes(new Set());
    setMyPickSeenHashes(new Set());
    setMyPickUnseenOnly(false);
  }, []);

  const resetMyPickSeen = useCallback(() => {
    writeMyPickLastSeenAt(0);
    setMyPickLastSeenAt(0);
    writeMyPickSeenIds(new Set());
    setMyPickSeenIds(new Set());
    writeMyPickSeenHashes(new Set());
    setMyPickSeenHashes(new Set());
  }, []);

  const markListingAsSeen = useCallback((listingId) => {
    if (!filters.only_my_pick || listingId == null) return;
    const id = String(listingId);
    const item = myPickMarkers.find((m) => String(m.listing_id) === id);
    setMyPickSeenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      writeMyPickSeenIds(next);
      return next;
    });
    const hash = makeListingHash(item);
    if (hash) {
      setMyPickSeenHashes((prev) => {
        if (prev.has(hash)) return prev;
        const next = new Set(prev);
        next.add(hash);
        writeMyPickSeenHashes(next);
        return next;
      });
    }
  }, [filters.only_my_pick, myPickMarkers]);

  // '신규만' 켜진 채로 모두 클릭하면 unseen=0이 되어 빈 화면 + 토글 사라짐 → 자동 해제
  useEffect(() => {
    if (filters.only_my_pick && myPickUnseenOnly && myPickUnseenCount === 0) {
      setMyPickUnseenOnly(false);
    }
  }, [filters.only_my_pick, myPickUnseenOnly, myPickUnseenCount]);

  const myPickUnseenInfo = filters.only_my_pick ? {
    active: true,
    count: myPickUnseenCount,
    onlyUnseen: myPickUnseenOnly,
    onToggleOnlyUnseen: () => setMyPickUnseenOnly(v => !v),
    onMarkAllSeen: markAllMyPickSeen,
    onReset: resetMyPickSeen,
    lastSeenLabel: myPickLastSeenAt
      ? (formatRelativeKr(myPickLastSeenAt) ? `마지막 확인: ${formatRelativeKr(myPickLastSeenAt)}` : "마지막 확인: -")
      : "마지막 확인: 없음",
    lastSeenAt: myPickLastSeenAt,
  } : null;
  const [selectedId, setSelectedId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [heatmapOn, setHeatmapOn] = useState(false);
  const mapRef = useRef(null);
  const boundsRef = useRef(null);

  const handleBoundsChange = useCallback((bounds) => {
    boundsRef.current = bounds;
    const localMode = filters.only_favorites || filters.only_ai || filters.only_my_pick || hasNonModeFilters(filters);
    if (!localMode) fetchMarkers(bounds, filters);
  }, [fetchMarkers, filters]);

  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
    if (newFilters.only_favorites || newFilters.only_ai || newFilters.only_my_pick) return;
    // 필터 활성 시 지도 뷰포트 제한 없이 서울 전체에서 조회
    const bounds = hasNonModeFilters(newFilters) ? SEOUL_WIDE_BOUNDS : boundsRef.current;
    if (bounds) fetchMarkers(bounds, newFilters);
  }, [fetchMarkers]);

  const handleMarkerClick = useCallback((marker) => {
    const id = marker?.listing_id ?? marker;
    const normalizedId = id != null ? String(id) : null;
    if (!normalizedId) return;
    mapRef.current?.clearSelection?.();
    setSelectedId(normalizedId);
    setDetailId(normalizedId);
    markListingAsSeen(normalizedId);
  }, [markListingAsSeen]);

  const handleCardClick = useCallback((listingOrId) => {
    const item = typeof listingOrId === "object" && listingOrId != null
      ? listingOrId
      : displayedMarkers.find(m => String(m.listing_id) === String(listingOrId)) || null;
    const id = item?.listing_id != null ? String(item.listing_id) : listingOrId != null ? String(listingOrId) : null;
    if (!id || !item) return;
    setSelectedId(id);
    setDetailId(id);
    mapRef.current?.clearSelection?.();
    markListingAsSeen(id);
    const lat = toFiniteCoordinate(item.lat);
    const lng = toFiniteCoordinate(item.lng);
    if (lat != null && lng != null) {
      mapRef.current?.focusAt?.({ lat, lng, zoom: MAP_CARD_FOCUS_ZOOM });
    }
  }, [displayedMarkers, markListingAsSeen]);

  const handleCloseDetail = useCallback(() => {
    setDetailId(null);
    setSelectedId(null);
    mapRef.current?.clearSelection?.();
  }, []);

  // 다른 탭에서 "지도에서 보기" 클릭 시 자동 센터링 + 상세 열기
  useEffect(() => {
    if (!focusListing) return;
    const { listing_id, lat, lng } = focusListing;
    if (lat != null && lng != null) {
      mapRef.current?.focusAt?.({ lat, lng, zoom: MAP_CARD_FOCUS_ZOOM });
    }
    if (listing_id) {
      setSelectedId(String(listing_id));
      setDetailId(String(listing_id));
    }
    onFocusConsumed?.();
  }, [focusListing, onFocusConsumed]);

  useEffect(() => {
    if (!selectedId) return;
    if (!displayedMarkers.some(m => String(m.listing_id) === selectedId)) {
      setSelectedId(null);
      mapRef.current?.clearSelection?.();
    }
  }, [displayedMarkers, selectedId]);

  return (
    <div className="map-view-3panel">
      {/* 데스크탑: 좌측 패널 */}
      <div className="map-3panel-left">
        <MapLeftPanel
          filters={filters}
          onFilterChange={handleFilterChange}
          markers={displayedMarkers}
          totalInBounds={isLocalMode ? displayedMarkers.length : totalInBounds}
          isFiltered={isLocalMode}
          loading={loading}
          selectedId={selectedId}
          onCardClick={handleCardClick}
          getFavoriteGrade={getFavoriteGrade}
          myPickUnseen={myPickUnseenInfo}
        />
      </div>

      {/* 중앙: 지도 */}
      <div className="map-3panel-center">
        <KakaoMap
          ref={mapRef}
          center={INITIAL_CENTER}
          zoom={INITIAL_ZOOM}
          markers={displayedMarkers}
          selectedId={selectedId}
          favoriteIds={isFavorite}
          heatmapOn={heatmapOn}
          onBoundsChange={handleBoundsChange}
          onMarkerClick={handleMarkerClick}
          onOpenDetail={handleMarkerClick}
        />
        <MapControls
          heatmapOn={heatmapOn}
          onToggleHeatmap={() => setHeatmapOn(v => !v)}
          onZoomIn={() => mapRef.current?.zoomIn?.()}
          onZoomOut={() => mapRef.current?.zoomOut?.()}
          detailOpen={Boolean(detailId)}
        />
        {loading && <div className="map-loading-bar" />}
      </div>

      {/* 상세: 공용 DetailModal (데스크탑 centered modal / 모바일 bottom sheet) */}
      {detailId && (
        <DetailModal
          detailId={detailId}
          apiBase={apiBase}
          onClose={handleCloseDetail}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
        />
      )}

      {/* 모바일: 하단 시트 */}
      <MapBottomSheet
        markers={displayedMarkers}
        totalInBounds={isLocalMode ? displayedMarkers.length : totalInBounds}
        loading={loading}
        selectedId={selectedId}
        detailOpen={Boolean(detailId)}
        onCardClick={handleCardClick}
        filters={filters}
        onFilterChange={handleFilterChange}
        onZoomOut={() => mapRef.current?.zoomOut?.()}
        myPickUnseen={myPickUnseenInfo}
      />
    </div>
  );
}
