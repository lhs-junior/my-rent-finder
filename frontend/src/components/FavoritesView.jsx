import { useState, useEffect, useCallback } from "react";
import { fetchJson } from "../hooks/useApi.js";
import { resolveExternalListingUrl } from "../utils/listing-url.js";
import ListingCard from "./ListingCard.jsx";
import DetailModal from "./DetailModal.jsx";

export default function FavoritesView({ apiBase, favoriteIds, toggleFavorite, authenticated, pin, getFavoriteGrade, onViewOnMap }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [gradeFilter, setGradeFilter] = useState("");

  const normalizedApiBase = (typeof apiBase === "string" ? apiBase.trim() : "").replace(/\/$/, "");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const fetchFavorites = authenticated && pin
      ? fetch(`${normalizedApiBase}/api/profile/favorites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
          signal: controller.signal,
        })
      : fetch(`${normalizedApiBase}/api/favorites`, { signal: controller.signal });
    fetchFavorites
      .then((r) => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then((data) => setItems(data.items || []))
      .catch((err) => { if (err.name !== "AbortError") setError(err.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [normalizedApiBase, favoriteIds.size, authenticated, pin]);

  const loadDetail = useCallback(async (listingId) => {
    if (!listingId) return;
    try {
      setDetailLoading(true);
      setDetail(null);
      const payload = await fetchJson(`${normalizedApiBase}/api/listings/${encodeURIComponent(listingId)}`);
      setDetail(payload?.listing || null);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [normalizedApiBase]);

  const openExternalUrl = useCallback((listing) => {
    const url = resolveExternalListingUrl(listing);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const isFavorite = useCallback((id) => favoriteIds.has(id), [favoriteIds]);

  const activeItems = items.filter(item => !item.is_expired);
  const expiredItems = items.filter(item => item.is_expired);
  const expiredCount = expiredItems.length;

  const hasGrades = activeItems.some(item => item.grade);
  // 등급 필터는 활성 매물에만 적용, 종료 매물은 뒤에 별도 표시
  const filteredActive = gradeFilter
    ? activeItems.filter(item => (item.grade || getFavoriteGrade?.(item.listing_id)) === gradeFilter)
    : activeItems;
  const filteredItems = gradeFilter ? filteredActive : [...filteredActive, ...expiredItems];

  const gradeCounts = hasGrades
    ? activeItems.reduce((acc, item) => {
        const g = item.grade || getFavoriteGrade?.(item.listing_id);
        if (g && g in acc) acc[g]++;
        return acc;
      }, { SS: 0, S: 0, A: 0 })
    : null;

  if (loading && items.length === 0) {
    return <div className="fav-view"><div className="fav-loading">불러오는 중...</div></div>;
  }

  const modalOpen = detail !== null || detailLoading;

  return (
    <div className="fav-view">
      <div className="fav-header">
        <h2>즐겨찾기</h2>
        <span className="fav-count">
          {gradeFilter ? filteredActive.length : activeItems.length}건
          {hasGrades && gradeFilter === "" && activeItems.length !== (gradeCounts.SS + gradeCounts.S + gradeCounts.A) && (
            <span className="fav-count-graded"> (등급 {gradeCounts.SS + gradeCounts.S + gradeCounts.A}건)</span>
          )}
          {expiredCount > 0 && gradeFilter === "" && (
            <span className="fav-count-graded"> · 종료 {expiredCount}건</span>
          )}
        </span>
      </div>
      {hasGrades && (
        <div className="fav-grade-filter">
          {[{ v: "", l: "전체" }, { v: "SS", l: "SS" }, { v: "S", l: "S" }, { v: "A", l: "A" }].map(opt => (
            <button
              key={opt.v}
              type="button"
              className={`fav-grade-btn fav-grade-btn--${opt.v || "all"}${gradeFilter === opt.v ? " fav-grade-btn--active" : ""}`}
              onClick={() => setGradeFilter(opt.v)}
            >
              {opt.v ? `${opt.l}(${gradeCounts[opt.v]})` : `전체(${activeItems.length})`}
            </button>
          ))}
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      {items.length === 0 && !loading && (
        <div className="fav-empty">
          <div className="fav-empty-icon">
            <svg viewBox="0 0 24 24" width="48" height="48">
              <path
                d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"
                fill="#9CA3AF"
              />
            </svg>
          </div>
          <p>저장한 매물이 없습니다.</p>
          <span className="muted">매물 검색이나 지도에서 하트를 눌러 즐겨찾기에 추가하세요.</span>
        </div>
      )}

      <div className="listing-grid">
        {filteredItems.filter((item) => item.listing_id != null).map((item, idx) => {
          const grade = item.grade || getFavoriteGrade?.(item.listing_id) || null;
          const expired = item.is_expired === true;
          return (
            <div key={item.listing_id ?? `fav-${idx}`} className={`fav-card${expired ? " fav-card--expired" : ""}`}>
              {(grade || item.platform_code || expired) && (
                <div className="fav-card-header">
                  {grade && <span className={`fav-card-grade fav-card-grade--${grade}`}>{grade}</span>}
                  {item.platform_code && <span className="fav-card-platform">{({naver:"네이버",dabang:"다방",daangn:"당근",peterpanz:"피터팬",zigbang:"직방",kbland:"KB"})[item.platform_code] || item.platform_code}</span>}
                  {expired && <span className="fav-card-expired">종료됨</span>}
                </div>
              )}
              <ListingCard
                item={item}
                onClick={() => loadDetail(item.listing_id)}
                isFavorite={isFavorite(item.listing_id)}
                onToggleFavorite={() => toggleFavorite(item.listing_id)}
                onViewOnMap={onViewOnMap}
              />
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <DetailModal
          detail={detail}
          loading={detailLoading}
          onClose={() => { setDetail(null); setDetailLoading(false); }}
          onOpenExternal={openExternalUrl}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
          apiBase={apiBase}
        />
      )}
    </div>
  );
}
