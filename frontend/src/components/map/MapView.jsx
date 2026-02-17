import { useState, useCallback, useRef, useEffect } from "react";
import KakaoMap from "./KakaoMap.jsx";
import MapSidePanel from "./MapSidePanel.jsx";
import MapFilters from "./MapFilters.jsx";
import MapControls from "./MapControls.jsx";
import { useMapListings } from "../../hooks/useMapListings.js";

const INITIAL_CENTER = { lat: 37.5665, lng: 126.978 }; // Seoul center
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
  const [drawingMode, setDrawingMode] = useState(false);
  const mapRef = useRef(null);
  const boundsRef = useRef(null);

  const handleBoundsChange = useCallback((bounds) => {
    boundsRef.current = bounds;
    fetchMarkers(bounds, filters);
  }, [fetchMarkers, filters]);

  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
    if (boundsRef.current) {
      fetchMarkers(boundsRef.current, newFilters);
    }
  }, [fetchMarkers]);

  /* Marker click = select only (highlight + InfoWindow tooltip), NO modal.
     InfoWindow is opened directly inside KakaoMap's click handler to avoid
     the round-trip through React state which would close it immediately. */
  const handleMarkerClick = useCallback((marker) => {
    const listingId = marker?.listing_id ?? marker;
    const normalizedListingId = listingId != null ? String(listingId) : null;
    if (!normalizedListingId) return;
    mapRef.current?.clearSelection?.();
    setSelectedId(normalizedListingId);
  }, []);

  /* InfoWindow "상세보기" or double-click marker = open detail modal */
  const handleOpenDetail = useCallback((listingId) => {
    const normalizedListingId = listingId != null ? String(listingId) : null;
    if (!normalizedListingId) return;
    setSelectedId(normalizedListingId);
    setDetailId(normalizedListingId);
  }, []);

  /* Card click in sidebar = select + open detail modal */
  const handleCardClick = useCallback((listingOrId) => {
    const markerItem = typeof listingOrId === "object" && listingOrId != null
      ? listingOrId
      : markers.find((item) => String(item?.listing_id) === String(listingOrId)) || null;
    const normalizedListingId = markerItem?.listing_id != null
      ? String(markerItem.listing_id)
      : listingOrId != null ? String(listingOrId) : null;
    if (!normalizedListingId) return;
    if (!markerItem) {
      return;
    }

    setSelectedId(normalizedListingId);
    setDetailId(normalizedListingId);
    mapRef.current?.clearSelection?.();

    const lat = toFiniteCoordinate(markerItem.lat);
    const lng = toFiniteCoordinate(markerItem.lng);
    if (lat == null || lng == null) {
      mapRef.current?.focusListing?.(normalizedListingId, {
        openInfoWindow: false,
        panTo: true,
        zoom: MAP_CARD_FOCUS_ZOOM,
        fallbackListing: markerItem,
      });
      return;
    }

    const focusByPosition = mapRef.current?.focusAt?.({ lat, lng, zoom: MAP_CARD_FOCUS_ZOOM });
    if (!focusByPosition) {
      mapRef.current?.focusListing?.(normalizedListingId, {
        openInfoWindow: false,
        panTo: true,
        zoom: MAP_CARD_FOCUS_ZOOM,
        fallbackListing: markerItem,
      });
    }
  }, [markers]);

  useEffect(() => {
    if (!selectedId) return;
    const stillExists = markers.some((m) => String(m.listing_id) === selectedId);
    if (!stillExists && String(detailId) === String(selectedId)) {
      return;
    }
    if (!stillExists) {
      setSelectedId(null);
      mapRef.current?.clearSelection?.();
    }
  }, [markers, selectedId, detailId]);

  return (
    <div className="map-view">
      <MapFilters filters={filters} onChange={handleFilterChange} />
      <div className="map-layout">
        <div className="map-container">
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
            onOpenDetail={handleOpenDetail}
          />
          <MapControls
            heatmapOn={heatmapOn}
            onToggleHeatmap={() => setHeatmapOn(v => !v)}
            drawingMode={drawingMode}
            onToggleDrawing={() => setDrawingMode(v => !v)}
            onZoomIn={() => mapRef.current?.zoomIn?.()}
            onZoomOut={() => mapRef.current?.zoomOut?.()}
          />
        </div>
        <MapSidePanel
          markers={markers}
          totalInBounds={totalInBounds}
          loading={loading}
          error={error}
          selectedId={selectedId}
          detailId={detailId}
          onCardClick={handleCardClick}
          onCloseDetail={() => setDetailId(null)}
          apiBase={apiBase}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
        />
      </div>
      {loading && <div className="map-loading-bar" />}
      </div>
  );
}
