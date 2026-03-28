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

export default function MapView({ apiBase, isFavorite, toggleFavorite }) {
  const { markers, totalInBounds, loading, error, fetchMarkers } = useMapListings(apiBase);
  const [filters, setFilters] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [heatmapOn, setHeatmapOn] = useState(false);
  const mapRef = useRef(null);
  const boundsRef = useRef(null);

  const handleBoundsChange = useCallback((bounds) => {
    boundsRef.current = bounds;
    fetchMarkers(bounds, filters);
  }, [fetchMarkers, filters]);

  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
    if (boundsRef.current) fetchMarkers(boundsRef.current, newFilters);
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
      : markers.find(m => String(m.listing_id) === String(listingOrId)) || null;
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
  }, [markers]);

  const handleCloseDetail = useCallback(() => {
    setDetailId(null);
    setSelectedId(null);
    mapRef.current?.clearSelection?.();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    if (!markers.some(m => String(m.listing_id) === selectedId)) {
      setSelectedId(null);
      mapRef.current?.clearSelection?.();
    }
  }, [markers, selectedId]);

  return (
    <div className="map-view-3panel">
      {/* 데스크탑: 좌측 패널 */}
      <div className="map-3panel-left">
        <MapLeftPanel
          filters={filters}
          onFilterChange={handleFilterChange}
          markers={markers}
          totalInBounds={totalInBounds}
          loading={loading}
          selectedId={selectedId}
          onCardClick={handleCardClick}
        />
      </div>

      {/* 중앙: 지도 */}
      <div className="map-3panel-center">
        <KakaoMap
          ref={mapRef}
          center={INITIAL_CENTER}
          zoom={INITIAL_ZOOM}
          markers={markers}
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
        markers={markers}
        totalInBounds={totalInBounds}
        loading={loading}
        selectedId={selectedId}
        detailOpen={Boolean(detailId)}
        onCardClick={handleCardClick}
      />
    </div>
  );
}
