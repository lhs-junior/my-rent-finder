import { useState, useEffect } from "react";
import FavoriteButton from "./FavoriteButton.jsx";

const PLATFORM_LABELS = {
  naver: "네이버",
  zigbang: "직방",
  dabang: "다방",
  kbland: "KB",
  peterpanz: "피터팬",
  daangn: "당근",
};

const PLATFORM_COLORS = {
  naver: "#03C75A",
  zigbang: "#3B82F6",
  dabang: "#8B5CF6",
  kbland: "#EF4444",
  peterpanz: "#F97316",
  daangn: "#FBBF24",
};

function toMoney(v) {
  if (v == null) return "-";
  return v >= 10000 ? `${(v / 10000).toFixed(1)}억` : `${v}만`;
}

export default function FavoritesView({ apiBase, favoriteIds, toggleFavorite }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  const handleRemove = async (listingId) => {
    await toggleFavorite(listingId);
  };

  if (loading && items.length === 0) {
    return <div className="fav-view"><div className="fav-loading">불러오는 중...</div></div>;
  }

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

      <div className="fav-grid">
        {items.map((item) => {
          const details = [
            item.area_exclusive_m2 ? `${item.area_exclusive_m2}m²` : null,
            item.room_count ? `${item.room_count}룸` : null,
            item.floor ? `${item.floor}층` : null,
            item.building_use,
          ].filter(Boolean).join(" · ");

          return (
            <div key={item.listing_id} className="fav-card">
              <div className="fav-card-top">
                <span
                  className="fav-card-platform"
                  style={{ background: PLATFORM_COLORS[item.platform_code] || "#6B7280" }}
                >
                  {PLATFORM_LABELS[item.platform_code] || item.platform_code}
                </span>
                <FavoriteButton
                  active={true}
                  onClick={() => handleRemove(item.listing_id)}
                  size="sm"
                />
              </div>

              <div className="fav-card-address">{item.address_text || "-"}</div>

              <div className="fav-card-price">
                보증금 {toMoney(item.deposit_amount)} / 월세 {item.rent_amount ? `${item.rent_amount}만` : "-"}
              </div>

              {details && <div className="fav-card-detail">{details}</div>}

              {item.favorited_at && (
                <div className="fav-card-date">
                  {new Date(item.favorited_at).toLocaleDateString("ko-KR")} 저장
                </div>
              )}

              <div className="fav-card-actions">
                {item.source_url && (
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fav-card-link"
                  >
                    원본 보기
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
