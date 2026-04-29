import { useState, useEffect, useCallback } from "react";
import { toPlatformLabel, PLATFORM_COLORS, toMoney } from "../utils/format.js";
import DetailModal from "./DetailModal.jsx";

const DARK_TEXT_PLATFORMS = new Set(["naver", "daangn"]);

const SORT_OPTIONS = [
  { v: "newest", l: "최신순" },
  { v: "rent",   l: "월세순" },
  { v: "score",  l: "점수순" },
];

function platformBadgeStyle(platform) {
  return {
    background: PLATFORM_COLORS[platform] || "#6B7280",
    color: DARK_TEXT_PLATFORMS.has(platform) ? "#111110" : "#fff",
  };
}

function MyPickCard({ item, onOpenDetail }) {
  const platform = item.platform_code || "";
  const subwayBadge =
    item.nearest_subway_station && item.subway_distance_m != null
      ? `${item.nearest_subway_station}${item.nearest_subway_line ? `(${item.nearest_subway_line})` : ""} ${item.subway_walk_min ? `도보 ${item.subway_walk_min}분` : `${item.subway_distance_m}m`}`
      : null;

  return (
    <div className="score-card">
      <button
        type="button"
        className="listing-card-main"
        style={{ width: "100%", textAlign: "left" }}
        aria-label={`${item.address_text || "매물"} 상세 보기`}
        onClick={() => onOpenDetail(item.listing_id)}
      >
        <div className="listing-card-thumb">
          {item.first_image_url ? (
            <img src={item.first_image_url} alt="" loading="lazy" />
          ) : (
            <div className="listing-card-thumb-empty">
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="8.5" cy="10.5" r="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M21 17l-5-4-3 2.5L9 12l-6 5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </div>
          )}
          <span className="listing-card-badge" style={platformBadgeStyle(platform)}>
            {toPlatformLabel(platform)}
          </span>
        </div>

        <div className="listing-card-body">
          <div className="score-card-header" style={{ marginBottom: 4 }}>
            {item.is_new && (
              <span className="listing-card-signal listing-card-signal--new" title="7일 이내 수집">
                신규
              </span>
            )}
            {item.lien_warning && (
              <span
                className="listing-card-signal listing-card-signal--warn"
                title="설명에 융자/근저당 언급 있음"
              >
                융자경고
              </span>
            )}
            {item.room_count_unknown && (
              <span className="listing-card-signal" title="방수 정보 미확인">
                방수미확인
              </span>
            )}
          </div>

          <div className="listing-card-rent">
            {item.rent_amount != null ? `${item.rent_amount}만원` : "가격 미정"}
          </div>
          <div className="listing-card-deposit">보증금 {toMoney(item.deposit_amount)}</div>

          <div className="listing-card-address">{item.address_text || "-"}</div>

          <div className="listing-card-meta">
            {item.area_m2 != null && (
              <span className="listing-card-tag">{item.area_m2.toFixed(1)}㎡</span>
            )}
            {item.floor != null && (
              <span className="listing-card-tag">{item.floor}층</span>
            )}
            {item.room_count != null && (
              <span className="listing-card-tag">{item.room_count}룸</span>
            )}
            {item.building_use && (
              <span className="listing-card-tag">{item.building_use}</span>
            )}
            {item.building_year != null && (
              <span className="listing-card-tag">{item.building_year}년</span>
            )}
          </div>

          {subwayBadge && (
            <div className="listing-card-subway">
              🚇 {subwayBadge}
            </div>
          )}
        </div>
      </button>
    </div>
  );
}

export default function MyPickView({ apiBase }) {
  const [listings, setListings] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [sort, setSort] = useState("newest");

  const normalizedApiBase = (typeof apiBase === "string" ? apiBase.trim() : "").replace(/\/$/, "");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`${normalizedApiBase}/api/listings/my-pick?sort=${sort}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setListings(data.listings || []);
        setTotal(data.total || 0);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [normalizedApiBase, sort]);

  const openDetail = useCallback((listingId) => {
    if (!listingId) return;
    setDetailId(String(listingId));
  }, []);

  if (loading && listings.length === 0) {
    return (
      <div className="fav-view">
        <div className="fav-loading">내 조건 매물 불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="fav-view">
      <div className="fav-header">
        <h2>내 조건</h2>
        <span className="fav-count">{total}건</span>
        <div className="mypick-sort-row">
          {SORT_OPTIONS.map(o => (
            <button
              key={o.v}
              type="button"
              className={`ls-chip${sort === o.v ? " ls-chip--active" : ""}`}
              onClick={() => setSort(o.v)}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>

      <div className="fav-grade-filter" style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)" }}>
        월세 90만↓ · 방3개↑ · 14개역 1km이내 · 근린/업무시설 제외
      </div>

      {error && <div className="error-box">{error}</div>}

      {listings.length === 0 && !loading && (
        <div className="fav-empty">
          <p>조건에 맞는 매물이 없습니다.</p>
          <span className="muted">수집 후 다시 확인해 주세요.</span>
        </div>
      )}

      <div className="listing-grid">
        {listings.map((item, idx) => (
          <MyPickCard
            key={item.listing_id ?? `mypick-${idx}`}
            item={item}
            onOpenDetail={openDetail}
          />
        ))}
      </div>

      {detailId !== null && (
        <DetailModal
          detailId={detailId}
          onClose={() => setDetailId(null)}
          onOpenExternal={() => {}}
          apiBase={apiBase}
        />
      )}
    </div>
  );
}
