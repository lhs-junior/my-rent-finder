// frontend/src/components/map/MapLeftPanel.jsx
import { useRef, useEffect } from "react";
import { PLATFORM_OPTIONS, FLOOR_FILTER_OPTIONS, toMoney, toRelativeListedAt } from "../../utils/format.js";

export default function MapLeftPanel({
  filters,
  onFilterChange,
  markers,
  totalInBounds,
  isFiltered,
  loading,
  selectedId,
  onCardClick,
  getFavoriteGrade,
  myPickUnseen,
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
            onClick={() => onFilterChange({ ...filters, only_favorites: !filters.only_favorites, only_ai: false, only_my_pick: false, grade: "" })}
          >
            ♥ 찜만 보기
          </button>
          <button
            type="button"
            className={`map-favorites-only-btn map-ai-only-btn${filters.only_ai ? " map-favorites-only-btn--active map-ai-only-btn--active" : ""}`}
            aria-pressed={!!filters.only_ai}
            onClick={() => onFilterChange({ ...filters, only_ai: !filters.only_ai, only_favorites: false, only_my_pick: false, grade: "" })}
          >
            ★ AI 추천
          </button>
          <button
            type="button"
            className={`map-favorites-only-btn map-my-pick-btn${filters.only_my_pick ? " map-favorites-only-btn--active map-my-pick-btn--active" : ""}`}
            aria-pressed={!!filters.only_my_pick}
            onClick={() => onFilterChange({ ...filters, only_my_pick: !filters.only_my_pick, only_favorites: false, only_ai: false, grade: "" })}
          >
            ✓ 내 조건
          </button>
          <button
            type="button"
            className="map-filter-reset"
            onClick={() => onFilterChange({})}
          >
            초기화
          </button>
        </div>
        {(filters.only_favorites || filters.only_ai || filters.only_my_pick) && (
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
        <div className="map-sort-filter">
          {[{ v: "", l: "수집순" }, { v: "newest", l: "최신순" }].map(opt => (
            <button
              key={opt.v}
              type="button"
              className={`map-grade-btn${(filters.sort || "") === opt.v ? " map-grade-btn--active" : ""}`}
              onClick={() => onFilterChange({ ...filters, sort: opt.v })}
            >
              {opt.l}
            </button>
          ))}
        </div>
        <div className="map-sort-filter">
          <span className="map-subway-label">🚇 역세권</span>
          {[{v:"",l:"전체"},{v:"500",l:"500m"},{v:"1000",l:"1km"},{v:"2000",l:"2km"}].map(opt => (
            <button
              key={opt.v}
              type="button"
              className={`map-grade-btn${(filters.max_subway_m || "") === opt.v ? " map-grade-btn--active" : ""}`}
              onClick={() => onFilterChange({ ...filters, max_subway_m: opt.v })}
            >
              {opt.l}
            </button>
          ))}
        </div>
      </div>

      {/* 내 조건: 미열람 신규 알림 바 */}
      {myPickUnseen?.active && (
        <div className="mypick-unseen-bar mypick-unseen-bar--map" role="status">
          {myPickUnseen.count > 0 ? (
            <>
              <span className="mypick-unseen-bar-icon" aria-hidden>🆕</span>
              <span className="mypick-unseen-bar-text">
                새 매물 <strong>{myPickUnseen.count}건</strong>
              </span>
              <button
                type="button"
                className={`mypick-unseen-toggle-mini${myPickUnseen.onlyUnseen ? " mypick-unseen-toggle-mini--active" : ""}`}
                onClick={myPickUnseen.onToggleOnlyUnseen}
              >
                {myPickUnseen.onlyUnseen ? "전체" : "신규만"}
              </button>
              <button
                type="button"
                className="mypick-mark-seen mypick-mark-seen--mini"
                onClick={myPickUnseen.onMarkAllSeen}
                title="현재 시점을 마지막 확인 시간으로 기록합니다"
              >
                모두 확인
              </button>
            </>
          ) : (
            <>
              <span className="mypick-unseen-bar-icon mypick-unseen-bar-icon--muted" aria-hidden>✓</span>
              <span className="mypick-unseen-bar-text mypick-unseen-bar-text--muted">
                {myPickUnseen.lastSeenLabel}
              </span>
              {myPickUnseen.lastSeenAt > 0 && (
                <button
                  type="button"
                  className="mypick-mark-seen mypick-mark-seen--reset mypick-mark-seen--mini"
                  onClick={myPickUnseen.onReset}
                  title="마지막 확인 기록을 지워 다시 신규 표시를 봅니다"
                >
                  초기화
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* 목록 */}
      <div className="map-left-count">
        {loading ? "조회 중..." : isFiltered ? `${totalInBounds ?? markers.length}건` : `지도 내 ${totalInBounds ?? markers.length}건`}
      </div>
      <div className="map-left-list" ref={listRef}>
        {markers.length === 0 && !loading && (
          <p className="map-left-empty">해당 지역에 매물이 없습니다</p>
        )}
        {markers.map(m => {
          const grade = m.grade || (getFavoriteGrade ? getFavoriteGrade(m.listing_id) : null);
          return (
            <div
              key={m.listing_id}
              data-listing-id={String(m.listing_id)}
              className={`map-left-card${String(selectedId) === String(m.listing_id) ? " map-left-card--selected" : ""}${m._unseen ? " map-left-card--unseen" : ""}`}
              onClick={() => onCardClick(m)}
            >
              {m._unseen && <span className="map-left-card-newtag">NEW</span>}
              <div className="map-left-card-price">
                {grade && <span className={`map-left-grade-badge map-left-grade-badge--${grade}`}>{grade}{m.total_score != null ? ` ${m.total_score}` : ""}</span>}
                {m.platform_code && <span className="map-left-platform-badge">{({naver:"네이버",dabang:"다방",daangn:"당근",peterpanz:"피터팬",zigbang:"직방",kbland:"KB",serve:"써브"})[m.platform_code] || m.platform_code}</span>}
                {m.rent_amount != null ? `월 ${toMoney(m.rent_amount)}` : "가격미정"}
              </div>
              <div className="map-left-card-deposit">
                보증 {m.deposit_amount != null ? toMoney(m.deposit_amount) : "-"}
              </div>
              <div className="map-left-card-addr">{m.address_text || "-"}</div>
              <div className="map-left-card-tags">
                {(m.area_exclusive_m2 || m.area_m2) && <span>{m.area_exclusive_m2 || m.area_m2}㎡</span>}
                {m.floor != null && <span>{m.floor}층</span>}
                {!!m.room_count && <span>{m.room_count}룸</span>}
                {m.lease_type && m.lease_type !== "월세" && (
                  <span className="map-left-card-tag--lease">{m.lease_type}</span>
                )}
                {(() => { const rel = toRelativeListedAt(m.listed_at); return rel ? <span className="map-left-card-tag--listed">{rel}</span> : null; })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
