import { toPlatformLabel, PLATFORM_COLORS, normalizeImageUrl } from "../utils/format.js";
import FavoriteButton from "./FavoriteButton.jsx";

const MONEY_SWAP_PLATFORMS = new Set(["dabang", "daangn"]);
const MONEY_SWAP_RENT_MIN = 500;
const MONEY_SWAP_DEPOSIT_MAX = 200;
const DARK_TEXT_PLATFORMS = new Set(["naver", "daangn"]);

function displayMoney(v) {
  if (v == null) return "-";
  return v >= 10000 ? `${(v / 10000).toFixed(1)}억` : `${v}만`;
}

function normalizePrice(item) {
  const rent = Number(item?.rent_amount);
  const deposit = Number(item?.deposit_amount);
  if (!Number.isFinite(rent) || !Number.isFinite(deposit)) {
    return {
      rent: Number.isFinite(rent) ? rent : null,
      deposit: Number.isFinite(deposit) ? deposit : null,
    };
  }
  const platform = String(item?.platform_code || "").toLowerCase();
  const lease = String(item?.lease_type || "").trim();
  if (MONEY_SWAP_PLATFORMS.has(platform) && lease === "월세" &&
      deposit > 0 && rent > MONEY_SWAP_RENT_MIN && deposit <= MONEY_SWAP_DEPOSIT_MAX) {
    return { rent: deposit, deposit: rent };
  }
  return { rent, deposit };
}

function formatCollectedAt(value) {
  if (!value) return "시각 미상";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시각 미상";
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function summarizeSignals(item) {
  const signals = [];
  if (item?.lease_type) signals.push(item.lease_type);
  if (Number.isFinite(Number(item?.image_count))) {
    signals.push(`사진 ${Number(item.image_count)}장`);
  }
  if (item?.is_stale) signals.push("업데이트 확인 필요");
  return signals;
}

function platformBadgeStyle(platform) {
  const normalized = String(platform || "").toLowerCase();
  return {
    background: PLATFORM_COLORS[platform] || "#6B7280",
    color: DARK_TEXT_PLATFORMS.has(normalized) ? "#111110" : "#fff",
  };
}

export default function ListingCard({
  item,
  onClick,
  isFavorite,
  onToggleFavorite,
  compact,
  variant,
  isLoadingDetail,
}) {
  const price = normalizePrice(item);
  const platform = item.platform_code || item.platform || "";
  const area = item.area_exclusive_m2 || item.area_gross_m2 || item.area_m2;
  const searchVariant = variant === "search";
  const tags = [
    area ? `${area}m²` : null,
    item.room_count ? `${item.room_count}룸` : null,
    item.floor != null ? `${item.floor}층` : null,
    item.building_use || null,
    item.lease_type === "매매" && item.building_year ? `${item.building_year}년` : null,
  ].filter(Boolean);
  const signals = summarizeSignals(item);

  const firstImage = normalizeImageUrl(
    item.first_image_url
    || (Array.isArray(item.images) && item.images.length > 0
      ? item.images[0]?.source_url || item.images[0]?.thumbnail_url
      : null),
  );

  if (compact) {
    return (
      <div className="listing-card listing-card--compact">
        <button
          type="button"
          className="listing-card-main listing-card-main--compact"
          aria-label={`${item.title || item.address_text || "매물"} 상세 보기`}
          onClick={onClick}
        >
          <div className="listing-card-thumb">
            {firstImage ? (
              <img src={firstImage} alt="" loading="lazy" />
            ) : (
              <div className="listing-card-thumb-empty">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="8.5" cy="10.5" r="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M21 17l-5-4-3 2.5L9 12l-6 5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </div>
            )}
            <span
              className="listing-card-badge"
              style={platformBadgeStyle(platform)}
            >
              {toPlatformLabel(platform)}
            </span>
          </div>
          <div className="listing-card-body">
            {item.lease_type === "매매" ? (
              <div className="listing-card-rent">{item.sale_price != null ? displayMoney(item.sale_price) : "가격 미정"}</div>
            ) : (
              <>
                <div className="listing-card-rent">{price.rent != null ? `${price.rent}만원` : "가격 미정"}</div>
                <div className="listing-card-deposit">보증금 {displayMoney(price.deposit)}</div>
              </>
            )}
            <div className="listing-card-address">{item.address_text || "-"}</div>
            {tags.length > 0 && (
              <div className="listing-card-meta">
                {tags.map((t) => <span key={t} className="listing-card-tag">{t}</span>)}
              </div>
            )}
          </div>
        </button>
        {onToggleFavorite && (
          <div className="listing-card-fav" style={{ position: "static", padding: "8px 8px 8px 0", display: "flex", alignItems: "center" }}>
            <FavoriteButton active={isFavorite} onClick={() => onToggleFavorite()} size="sm" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`listing-card${searchVariant ? " listing-card--search" : ""}`}>
      <button
        type="button"
        className={`listing-card-main${searchVariant ? " listing-card-main--search" : ""}`}
        aria-label={`${item.title || item.address_text || "매물"} 상세 보기`}
        onClick={onClick}
      >
        <div className="listing-card-thumb">
          {firstImage ? (
            <img src={firstImage} alt="" loading="lazy" />
          ) : (
            <div className="listing-card-thumb-empty">
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="8.5" cy="10.5" r="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M21 17l-5-4-3 2.5L9 12l-6 5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </div>
          )}
          <span
            className="listing-card-badge"
            style={platformBadgeStyle(platform)}
          >
            {toPlatformLabel(platform)}
          </span>
        </div>
        <div className="listing-card-body">
          {searchVariant && (
            <div className="listing-card-status-row">
              <div className="listing-card-status-chips">
                {signals.map((signal) => (
                  <span key={signal} className={`listing-card-signal${signal === "업데이트 확인 필요" ? " listing-card-signal--warn" : ""}`}>
                    {signal}
                  </span>
                ))}
              </div>
              {isLoadingDetail && <span className="listing-card-action-hint">상세 불러오는 중...</span>}
            </div>
          )}
          {item.lease_type === "매매" ? (
            <div className="listing-card-rent">{item.sale_price != null ? displayMoney(item.sale_price) : "가격 미정"}</div>
          ) : (
            <>
              <div className="listing-card-rent">{price.rent != null ? `${price.rent}만원` : "가격 미정"}</div>
              <div className="listing-card-deposit">보증금 {displayMoney(price.deposit)}</div>
            </>
          )}
          {searchVariant && item.title ? (
            <div className="listing-card-title">{item.title}</div>
          ) : null}
          <div className="listing-card-address">{item.address_text || "-"}</div>
          {tags.length > 0 && (
            <div className="listing-card-meta">
              {tags.map((t) => <span key={t} className="listing-card-tag">{t}</span>)}
            </div>
          )}
          {searchVariant && (
            <div className="listing-card-proof">
              <span>수집 {formatCollectedAt(item.created_at)}</span>
              <span>run {item.run_id || "latest"}</span>
            </div>
          )}
          {searchVariant && (
            <div className="listing-card-action-row">
              <span className="listing-card-action-hint">
                {isLoadingDetail ? "상세 불러오는 중..." : "상세 보기"}
              </span>
              <span className="listing-card-action-arrow" aria-hidden="true">+</span>
            </div>
          )}
        </div>
      </button>
      {onToggleFavorite && (
        <div className="listing-card-fav">
          <FavoriteButton active={isFavorite} onClick={() => onToggleFavorite()} size="sm" />
        </div>
      )}
    </div>
  );
}
