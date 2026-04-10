// frontend/src/components/map/MapLeftPanel.jsx
import { useRef, useEffect } from "react";
import { PLATFORM_OPTIONS, FLOOR_FILTER_OPTIONS } from "../../utils/format.js";

export default function MapLeftPanel({
  filters,
  onFilterChange,
  markers,
  totalInBounds,
  loading,
  selectedId,
  onCardClick,
  getFavoriteGrade,
}) {
  const listRef = useRef(null);

  // 선택된 카드로 자동 스크롤
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-listing-id="${selectedId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  const set = (key, val) => onFilterChange({ ...filters, [key]: val });

  return (
    <div className="map-left-panel">
      {/* 필터 */}
      <div className="map-left-filters">
        <select
          aria-label="거래 유형"
          value={filters.lease_type || ""}
          onChange={e => set("lease_type", e.target.value)}
        >
          <option value="">전체</option>
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
                aria-pressed={(filters.has_image || "") === opt.v}
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
            aria-pressed={!!filters.only_favorites}
            onClick={() => onFilterChange({ ...filters, only_favorites: !filters.only_favorites, grade: "" })}
          >
            ♥ 찜만 보기
          </button>
          <button
            type="button"
            className="map-filter-reset"
            onClick={() => onFilterChange({})}
          >
            초기화
          </button>
        </div>
        {filters.only_favorites && getFavoriteGrade && (
          <div className="map-grade-filter">
            {[{ v: "", l: "전체" }, { v: "SS", l: "SS" }, { v: "S", l: "S" }, { v: "A", l: "A" }].map(opt => (
              <button
                key={opt.v}
                type="button"
                className={`map-grade-btn map-grade-btn--${opt.v || "all"}${(filters.grade || "") === opt.v ? " map-grade-btn--active" : ""}`}
                onClick={() => onFilterChange({ ...filters, grade: opt.v })}
              >
                {opt.l}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 목록 */}
      <div className="map-left-count">
        {loading ? "조회 중..." : `지도 내 ${totalInBounds ?? markers.length}건`}
      </div>
      <div className="map-left-list" ref={listRef}>
        {markers.length === 0 && !loading && (
          <p className="map-left-empty">해당 지역에 매물이 없습니다</p>
        )}
        {markers.map(m => {
          const grade = getFavoriteGrade ? getFavoriteGrade(m.listing_id) : null;
          return (
            <div
              key={m.listing_id}
              data-listing-id={String(m.listing_id)}
              className={`map-left-card${String(selectedId) === String(m.listing_id) ? " map-left-card--selected" : ""}`}
              onClick={() => onCardClick(m)}
            >
              <div className="map-left-card-price">
                {grade && <span className={`map-left-grade-badge map-left-grade-badge--${grade}`}>{grade}</span>}
                {m.platform_code && <span className="map-left-platform-badge">{({naver:"네이버",dabang:"다방",daangn:"당근",peterpanz:"피터팬",zigbang:"직방",kbland:"KB"})[m.platform_code] || m.platform_code}</span>}
                {m.rent_amount != null ? `월 ${m.rent_amount}만` : "가격미정"}
              </div>
              <div className="map-left-card-deposit">
                보증 {m.deposit_amount != null ? `${m.deposit_amount}만` : "-"}
              </div>
              <div className="map-left-card-addr">{m.address_text || "-"}</div>
              <div className="map-left-card-tags">
                {(m.area_exclusive_m2 || m.area_m2) && <span>{m.area_exclusive_m2 || m.area_m2}㎡</span>}
                {m.floor != null && <span>{m.floor}층</span>}
                {!!m.room_count && <span>{m.room_count}룸</span>}
                {m.lease_type && m.lease_type !== "월세" && (
                  <span className="map-left-card-tag--lease">{m.lease_type}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
