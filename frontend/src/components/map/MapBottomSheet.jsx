// frontend/src/components/map/MapBottomSheet.jsx
import { useRef, useState, useEffect } from "react";
import { PLATFORM_OPTIONS, FLOOR_FILTER_OPTIONS, toMoney, toRelativeListedAt } from "../../utils/format.js";

const STAGES = { peek: 64, half: 0.45, full: 0.92 };

export default function MapBottomSheet({
  markers,
  totalInBounds,
  loading,
  selectedId,
  detailOpen,
  onCardClick,
  filters = {},
  onFilterChange,
  onZoomOut,
  myPickUnseen,
}) {
  const [stage, setStage] = useState("peek");
  const [showFilter, setShowFilter] = useState(false);
  const startY = useRef(null);

  const set = (key, val) => onFilterChange?.({ ...filters, [key]: val });

  const activeFilterCount = Object.entries(filters).filter(([k, v]) =>
    v !== "" && v != null && v !== false && k !== "grade"
  ).length;

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

  // 핀 선택 시 시트가 전체를 덮고 있으면 half로 내려서 상세 모달이 보이도록 하고,
  // peek/half 였으면 그대로 둔다 (사용자가 수동으로 올려놓은 상태를 강제 리셋하지 않음).
  useEffect(() => {
    if (selectedId) setStage((s) => (s === "full" ? "half" : s));
  }, [selectedId]);

  return (
    <>
      {/* 필터 오버레이 (모바일) */}
      {showFilter && (
        <div className="map-mobile-filter-overlay" onClick={() => setShowFilter(false)}>
          <div className="map-mobile-filter-panel" onClick={e => e.stopPropagation()}>
            <div className="map-mobile-filter-header">
              <span className="map-mobile-filter-title">필터</span>
              <button
                type="button"
                className="map-mobile-filter-close"
                onClick={() => setShowFilter(false)}
                aria-label="닫기"
              >✕</button>
            </div>
            <div className="map-mobile-filter-body">
              <select
                aria-label="거래 유형"
                value={filters.lease_type || ""}
                onChange={e => set("lease_type", e.target.value)}
              >
                <option value="">전체 거래유형</option>
                <option value="월세">월세</option>
                <option value="전세">전세</option>
                <option value="매매">매매</option>
              </select>
              <select
                aria-label="플랫폼"
                value={filters.platform_code || ""}
                onChange={e => set("platform_code", e.target.value)}
              >
                {PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="map-filter-row">
                <input
                  type="number" placeholder="최소 월세" aria-label="최소 월세"
                  value={filters.min_rent || ""}
                  onChange={e => set("min_rent", e.target.value)}
                />
                <span>~</span>
                <input
                  type="number" placeholder="최대 월세" aria-label="최대 월세"
                  value={filters.max_rent || ""}
                  onChange={e => set("max_rent", e.target.value)}
                />
                <span className="map-filter-unit">만원</span>
              </div>
              <div className="map-filter-row">
                <input
                  type="number" placeholder="최소 면적" aria-label="최소 면적"
                  value={filters.min_area || ""}
                  onChange={e => set("min_area", e.target.value)}
                />
                <span>~</span>
                <input
                  type="number" placeholder="최대 면적" aria-label="최대 면적"
                  value={filters.max_area || ""}
                  onChange={e => set("max_area", e.target.value)}
                />
                <span className="map-filter-unit">㎡</span>
              </div>
              <div className="map-left-filter-row2">
                <select
                  aria-label="층 필터"
                  value={filters.min_floor || ""}
                  onChange={e => set("min_floor", e.target.value)}
                >
                  {FLOOR_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <div className="map-image-filter">
                  {[{ v: "", l: "전체" }, { v: "true", l: "사진" }, { v: "false", l: "사진X" }].map(opt => (
                    <button
                      key={opt.v}
                      type="button"
                      className={`map-img-btn${(filters.has_image || "") === opt.v ? " map-img-btn--active" : ""}`}
                      onClick={() => set("has_image", opt.v)}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="map-left-filter-row2">
                <button
                  type="button"
                  className={`map-favorites-only-btn${filters.only_favorites ? " map-favorites-only-btn--active" : ""}`}
                  onClick={() => onFilterChange?.({ ...filters, only_favorites: !filters.only_favorites, only_ai: false, only_my_pick: false, grade: "" })}
                >
                  ♥ 찜만 보기
                </button>
                <button
                  type="button"
                  className={`map-favorites-only-btn map-ai-only-btn${filters.only_ai ? " map-favorites-only-btn--active map-ai-only-btn--active" : ""}`}
                  onClick={() => onFilterChange?.({ ...filters, only_ai: !filters.only_ai, only_favorites: false, only_my_pick: false, grade: "" })}
                >
                  ★ AI 추천
                </button>
                <button
                  type="button"
                  className={`map-favorites-only-btn map-my-pick-btn${filters.only_my_pick ? " map-favorites-only-btn--active map-my-pick-btn--active" : ""}`}
                  onClick={() => onFilterChange?.({ ...filters, only_my_pick: !filters.only_my_pick, only_favorites: false, only_ai: false, grade: "" })}
                >
                  ✓ 내 조건
                </button>
              </div>
              {(filters.only_favorites || filters.only_ai || filters.only_my_pick) && (
                <div className="map-grade-filter">
                  {[{ v: "", l: "전체" }, { v: "SS", l: "SS" }, { v: "S", l: "S" }, { v: "A", l: "A" }].map(opt => (
                    <button
                      key={opt.v}
                      type="button"
                      className={`map-grade-btn map-grade-btn--${opt.v || "all"}${(filters.grade || "") === opt.v ? " map-grade-btn--active" : ""}`}
                      onClick={() => onFilterChange?.({ ...filters, grade: opt.v })}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              )}
              <div className="map-mobile-filter-section-label">역세권</div>
              <div className="map-grade-filter">
                {[{ v: "", l: "전체" }, { v: "500", l: "500m" }, { v: "1000", l: "1km" }, { v: "2000", l: "2km" }].map(opt => (
                  <button
                    key={opt.v}
                    type="button"
                    className={`map-grade-btn${(filters.max_subway_m || "") === opt.v ? " map-grade-btn--active" : ""}`}
                    onClick={() => set("max_subway_m", opt.v)}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
              <div className="map-mobile-filter-section-label">정렬</div>
              <div className="map-grade-filter">
                {(filters.only_my_pick
                  ? [{ v: "newest", l: "최신순" }, { v: "rent", l: "월세 낮은순" }, { v: "score", l: "점수 높은순" }]
                  : [{ v: "", l: "수집순" }, { v: "newest", l: "최신순" }]
                ).map(opt => {
                  const cur = filters.sort || (filters.only_my_pick ? "newest" : "");
                  return (
                    <button
                      key={opt.v}
                      type="button"
                      className={`map-grade-btn${cur === opt.v ? " map-grade-btn--active" : ""}`}
                      onClick={() => set("sort", opt.v)}
                    >
                      {opt.l}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="map-mobile-filter-footer">
              <button
                type="button"
                className="map-mobile-filter-reset"
                onClick={() => { onFilterChange?.({}); }}
              >
                초기화
              </button>
              <button
                type="button"
                className="map-mobile-filter-apply"
                onClick={() => setShowFilter(false)}
              >
                적용
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`map-bottom-sheet${detailOpen ? " map-bottom-sheet--hidden" : ""}`}
        style={{ height: getHeight() }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="map-bottom-handle">
          <div
            className="map-bottom-handle-drag"
            onClick={() => setStage(s => s === "peek" ? "half" : s === "half" ? "full" : "peek")}
          >
            <div className="map-bottom-handle-bar" />
            <span className="map-bottom-count">{loading ? "..." : `${totalInBounds ?? markers.length}건`}</span>
            {myPickUnseen?.active && myPickUnseen.count > 0 && (
              <span className="map-bottom-newcount" title="마지막 확인 이후 새 매물">
                NEW {myPickUnseen.count}
              </span>
            )}
          </div>
          {onZoomOut && (
            <button
              type="button"
              className="map-bottom-zoom-btn"
              onClick={onZoomOut}
              aria-label="지도 축소"
              title="지도 축소"
            >－</button>
          )}
          <button
            type="button"
            className={`map-bottom-filter-btn${activeFilterCount > 0 ? " map-bottom-filter-btn--active" : ""}`}
            onClick={() => setShowFilter(true)}
            aria-label="필터"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            필터{activeFilterCount > 0 && <span className="map-bottom-filter-badge">{activeFilterCount}</span>}
          </button>
        </div>
        <div className="map-bottom-list">
          {myPickUnseen?.active && (
            <div className="mypick-unseen-bar mypick-unseen-bar--map mypick-unseen-bar--bottom" role="status">
              {myPickUnseen.count > 0 ? (
                <>
                  <span className="mypick-unseen-bar-icon" aria-hidden>🆕</span>
                  <span className="mypick-unseen-bar-text">새 매물 <strong>{myPickUnseen.count}건</strong></span>
                  <button
                    type="button"
                    className={`mypick-unseen-toggle-mini${myPickUnseen.onlyUnseen ? " mypick-unseen-toggle-mini--active" : ""}`}
                    onClick={myPickUnseen.onToggleOnlyUnseen}
                  >{myPickUnseen.onlyUnseen ? "전체" : "신규만"}</button>
                  <button
                    type="button"
                    className="mypick-mark-seen mypick-mark-seen--mini"
                    onClick={myPickUnseen.onMarkAllSeen}
                  >모두 확인</button>
                </>
              ) : (
                <>
                  <span className="mypick-unseen-bar-icon mypick-unseen-bar-icon--muted" aria-hidden>✓</span>
                  <span className="mypick-unseen-bar-text mypick-unseen-bar-text--muted">{myPickUnseen.lastSeenLabel}</span>
                  {myPickUnseen.lastSeenAt > 0 && (
                    <button
                      type="button"
                      className="mypick-mark-seen mypick-mark-seen--reset mypick-mark-seen--mini"
                      onClick={myPickUnseen.onReset}
                    >초기화</button>
                  )}
                </>
              )}
            </div>
          )}
          {markers.map(m => (
            <div
              key={m.listing_id}
              className={`map-left-card${String(selectedId) === String(m.listing_id) ? " map-left-card--selected" : ""}${m._unseen ? " map-left-card--unseen" : ""}`}
              onClick={() => { onCardClick(m); setStage((s) => (s === "full" ? "half" : s)); }}
            >
              {m._unseen && <span className="map-left-card-newtag">NEW</span>}
              <div className="map-left-card-price">{m.rent_amount != null ? `월 ${toMoney(m.rent_amount)}` : "가격미정"}</div>
              <div className="map-left-card-deposit">보증 {m.deposit_amount != null ? toMoney(m.deposit_amount) : "-"}</div>
              <div className="map-left-card-addr">{m.address_text || "-"}</div>
              <div className="map-left-card-tags">
                {m.area_exclusive_m2 && <span>{m.area_exclusive_m2}㎡</span>}
                {m.floor != null && <span>{m.floor}층</span>}
                {!!m.room_count && <span>{m.room_count}룸</span>}
                {m.lease_type && m.lease_type !== "월세" && (
                  <span className="map-left-card-tag--lease">{m.lease_type}</span>
                )}
                {(() => { const rel = toRelativeListedAt(m.listed_at); return rel ? <span className="map-left-card-tag--listed">{rel}</span> : null; })()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
