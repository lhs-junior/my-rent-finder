import { useState, useCallback, useRef, useEffect } from "react";
import KakaoMap from "./KakaoMap.jsx";
import MapLeftPanel from "./MapLeftPanel.jsx";
import MapRightPanel from "./MapRightPanel.jsx";
import MapBottomSheet from "./MapBottomSheet.jsx";
import MapControls from "./MapControls.jsx";
import { useMapListings } from "../../hooks/useMapListings.js";

const INITIAL_CENTER = { lat: 37.5665, lng: 126.978 };
const INITIAL_ZOOM = 13;
const MAP_CARD_FOCUS_ZOOM = 4;

function toFiniteCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export default function MapView({ apiBase, isFavorite, toggleFavorite, getFavoriteGrade, authenticated, pin, focusListing, onFocusConsumed }) {
  const { markers: geoMarkers, totalInBounds, loading: geoLoading, error, fetchMarkers } = useMapListings(apiBase);
  const [favMarkers, setFavMarkers] = useState([]);
  const [favLoading, setFavLoading] = useState(false);
  const [filters, setFilters] = useState({});

  // 찜만 보기 활성화 시 favorites API에서 직접 마커 로드
  useEffect(() => {
    if (!filters.only_favorites) {
      setFavMarkers([]);
      return;
    }
    setFavLoading(true);
    const fetchFav = authenticated && pin
      ? fetch(`${apiBase}/api/profile/favorites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
        })
      : fetch(`${apiBase}/api/favorites`);

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
            }))
        );
      })
      .catch(() => setFavMarkers([]))
      .finally(() => setFavLoading(false));
  }, [filters.only_favorites, authenticated, pin, apiBase]);

  const markers = filters.only_favorites ? favMarkers : geoMarkers;
  const loading = filters.only_favorites ? favLoading : geoLoading;

  const displayedMarkers = (() => {
    let result = markers;
    if (filters.only_favorites && filters.grade) {
      result = result.filter(m => {
        const grade = m.grade || (getFavoriteGrade ? getFavoriteGrade(m.listing_id) : null);
        return grade === filters.grade;
      });
    }
    return result;
  })();
  const [selectedId, setSelectedId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [heatmapOn, setHeatmapOn] = useState(false);
  const mapRef = useRef(null);
  const boundsRef = useRef(null);

  const handleBoundsChange = useCallback((bounds) => {
    boundsRef.current = bounds;
    if (!filters.only_favorites) fetchMarkers(bounds, filters);
  }, [fetchMarkers, filters]);

  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
    if (!newFilters.only_favorites && boundsRef.current) fetchMarkers(boundsRef.current, newFilters);
  }, [fetchMarkers]);

  const handleMarkerClick = useCallback((marker) => {
    const id = marker?.listing_id ?? marker;
    const normalizedId = id != null ? String(id) : null;
    if (!normalizedId) return;
    mapRef.current?.clearSelection?.();
    setSelectedId(normalizedId);
    setDetailId(normalizedId);
  }, []);

  const handleCardClick = useCallback((listingOrId) => {
    const item = typeof listingOrId === "object" && listingOrId != null
      ? listingOrId
      : displayedMarkers.find(m => String(m.listing_id) === String(listingOrId)) || null;
    const id = item?.listing_id != null ? String(item.listing_id) : listingOrId != null ? String(listingOrId) : null;
    if (!id || !item) return;
    setSelectedId(id);
    setDetailId(id);
    mapRef.current?.clearSelection?.();
    const lat = toFiniteCoordinate(item.lat);
    const lng = toFiniteCoordinate(item.lng);
    if (lat != null && lng != null) {
      mapRef.current?.focusAt?.({ lat, lng, zoom: MAP_CARD_FOCUS_ZOOM });
    }
  }, [displayedMarkers]);

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
          totalInBounds={filters.only_favorites ? displayedMarkers.length : totalInBounds}
          loading={loading}
          selectedId={selectedId}
          onCardClick={handleCardClick}
          getFavoriteGrade={getFavoriteGrade}
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
        />
        {loading && <div className="map-loading-bar" />}
      </div>

      {/* 데스크탑: 우측 패널 / 모바일: 풀스크린 모달 */}
      <div
        className={`map-3panel-right${detailId ? " map-3panel-right--open" : ""}`}
        onClick={(e) => { if (e.target === e.currentTarget) handleCloseDetail(); }}
      >
        <MapRightPanel
          detailId={detailId}
          apiBase={apiBase}
          onClose={handleCloseDetail}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
        />
      </div>

      {/* 모바일: 하단 시트 */}
      <MapBottomSheet
        markers={displayedMarkers}
        totalInBounds={totalInBounds}
        loading={loading}
        selectedId={selectedId}
        detailOpen={Boolean(detailId)}
        onCardClick={handleCardClick}
        filters={filters}
        onFilterChange={handleFilterChange}
      />
    </div>
  );
}
