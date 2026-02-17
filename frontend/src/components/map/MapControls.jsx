export default function MapControls({
  heatmapOn,
  onToggleHeatmap,
  drawingMode,
  onToggleDrawing,
  onZoomIn,
  onZoomOut,
}) {
  return (
    <div className="map-controls">
      <button
        className="map-ctrl-btn"
        type="button"
        onClick={onZoomIn}
        title="지도 확대"
        aria-label="지도 확대"
      >
        <span aria-hidden="true">＋</span>
      </button>
      <button
        className="map-ctrl-btn"
        type="button"
        onClick={onZoomOut}
        title="지도 축소"
        aria-label="지도 축소"
      >
        <span aria-hidden="true">－</span>
      </button>
      <button
        className={`map-ctrl-btn${heatmapOn ? " map-ctrl-btn--active" : ""}`}
        type="button"
        onClick={onToggleHeatmap}
        title="히트맵"
        aria-pressed={heatmapOn}
        aria-label="히트맵 토글"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" opacity="0.5" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      </button>
      <button
        className={`map-ctrl-btn${drawingMode ? " map-ctrl-btn--active" : ""}`}
        type="button"
        onClick={onToggleDrawing}
        title="영역 선택"
        aria-pressed={drawingMode}
        aria-label="영역 선택 토글"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 2" />
        </svg>
      </button>
    </div>
  );
}
