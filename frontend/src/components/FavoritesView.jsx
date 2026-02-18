import { useState, useEffect, useCallback } from "react";
import { fetchJson } from "../hooks/useApi.js";
import { resolveExternalListingUrl } from "../utils/listing-url.js";
import ListingCard from "./ListingCard.jsx";
import DetailModal from "./DetailModal.jsx";

export default function FavoritesView({ apiBase, favoriteIds, toggleFavorite }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const normalizedApiBase = (typeof apiBase === "string" ? apiBase.trim() : "").replace(/\/$/, "");

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${normalizedApiBase}/api/favorites`)
      .then((r) => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then((data) => setItems(data.items || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [normalizedApiBase, favoriteIds.size]);

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

  if (loading && items.length === 0) {
    return <div className="fav-view"><div className="fav-loading">불러오는 중...</div></div>;
  }

  const modalOpen = detail !== null || detailLoading;

  return (
    <div className="fav-view">
      <div className="fav-header">
        <h2>즐겨찾기</h2>
        <span className="fav-count">{items.length}건</span>
      </div>

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
        {items.map((item) => (
          <ListingCard
            key={item.listing_id}
            item={item}
            onClick={() => loadDetail(item.listing_id)}
            isFavorite={isFavorite(item.listing_id)}
            onToggleFavorite={() => toggleFavorite(item.listing_id)}
          />
        ))}
      </div>

      {modalOpen && (
        <DetailModal
          detail={detail}
          loading={detailLoading}
          onClose={() => { setDetail(null); setDetailLoading(false); }}
          onOpenExternal={openExternalUrl}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
        />
      )}
    </div>
  );
}
