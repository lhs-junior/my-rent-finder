// frontend/src/components/map/MapBottomSheet.jsx
import { useRef, useState, useEffect } from "react";

const STAGES = { peek: 64, half: 0.45, full: 0.92 };

export default function MapBottomSheet({
  markers,
  totalInBounds,
  loading,
  selectedId,
  detailOpen,
  onCardClick,
}) {
  const [stage, setStage] = useState("peek");
  const startY = useRef(null);

  const getHeight = () => {
    if (stage === "peek") return STAGES.peek;
    if (stage === "half") return window.innerHeight * STAGES.half;
    return window.innerHeight * STAGES.full;
  };

  const onTouchStart = (e) => { startY.current = e.touches[0].clientY; };
  const onTouchEnd = (e) => {
    if (startY.current === null) return;
    const dy = startY.current - e.changedTouches[0].clientY;
    if (dy > 40) setStage(s => s === "peek" ? "half" : "full");
    else if (dy < -40) setStage(s => s === "full" ? "half" : "peek");
  };

  // 핀 선택 시 peek로
  useEffect(() => { if (selectedId) setStage("peek"); }, [selectedId]);

  return (
    <div
      className={`map-bottom-sheet${detailOpen ? " map-bottom-sheet--hidden" : ""}`}
      style={{ height: getHeight() }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="map-bottom-handle"
        onClick={() => setStage(s => s === "peek" ? "half" : s === "half" ? "full" : "peek")}
      >
        <div className="map-bottom-handle-bar" />
        <span className="map-bottom-count">{loading ? "..." : `${totalInBounds ?? markers.length}건`}</span>
      </div>
      <div className="map-bottom-list">
        {markers.map(m => (
          <div
            key={m.listing_id}
            className={`map-left-card${String(selectedId) === String(m.listing_id) ? " map-left-card--selected" : ""}`}
            onClick={() => { onCardClick(m); setStage("peek"); }}
          >
            <div className="map-left-card-price">{m.rent_amount != null ? `월 ${m.rent_amount}만` : "가격미정"}</div>
            <div className="map-left-card-deposit">보증 {m.deposit_amount != null ? `${m.deposit_amount}만` : "-"}</div>
            <div className="map-left-card-addr">{m.address_text || "-"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
