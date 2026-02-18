import { toPlatformLabel, PLATFORM_COLORS, normalizeImageUrl } from "../utils/format.js";
import FavoriteButton from "./FavoriteButton.jsx";

const MONEY_SWAP_PLATFORMS = new Set(["dabang", "daangn"]);
const MONEY_SWAP_RENT_MIN = 500;
const MONEY_SWAP_DEPOSIT_MAX = 200;

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

export default function ListingCard({ item, onClick, isFavorite, onToggleFavorite, compact }) {
  const price = normalizePrice(item);
  const platform = item.platform_code || item.platform || "";
  const area = item.area_exclusive_m2 || item.area_gross_m2 || item.area_m2;
  const tags = [
    area ? `${area}m²` : null,
    item.room_count ? `${item.room_count}룸` : null,
    item.floor != null ? `${item.floor}층` : null,
    item.building_use || null,
  ].filter(Boolean);

  const firstImage = normalizeImageUrl(
    item.first_image_url
    || (Array.isArray(item.images) && item.images.length > 0
      ? item.images[0]?.source_url || item.images[0]?.thumbnail_url
      : null),
  );

  const priceText = `보증금 ${displayMoney(price.deposit)} / 월세 ${price.rent != null ? `${price.rent}만` : "-"}`;

  if (compact) {
    return (
      <div
        className="listing-card listing-card--compact"
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick?.())}
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
            style={{ background: PLATFORM_COLORS[platform] || "#6B7280" }}
          >
            {toPlatformLabel(platform)}
          </span>
        </div>
        <div className="listing-card-body">
          <div className="listing-card-price">{priceText}</div>
          <div className="listing-card-address">{item.address_text || "-"}</div>
          {tags.length > 0 && (
            <div className="listing-card-meta">
              {tags.map((t) => <span key={t} className="listing-card-tag">{t}</span>)}
            </div>
          )}
        </div>
        {onToggleFavorite && (
          <div className="listing-card-fav" style={{ position: "static", padding: "8px 8px 8px 0", display: "flex", alignItems: "center" }}>
            <FavoriteButton active={isFavorite} onClick={() => onToggleFavorite()} size="sm" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="listing-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick?.())}
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
          style={{ background: PLATFORM_COLORS[platform] || "#6B7280" }}
        >
          {toPlatformLabel(platform)}
        </span>
        {onToggleFavorite && (
          <div className="listing-card-fav">
            <FavoriteButton active={isFavorite} onClick={() => onToggleFavorite()} size="sm" />
          </div>
        )}
      </div>
      <div className="listing-card-body">
        <div className="listing-card-price">{priceText}</div>
        <div className="listing-card-address">{item.address_text || "-"}</div>
        {tags.length > 0 && (
          <div className="listing-card-meta">
            {tags.map((t) => <span key={t} className="listing-card-tag">{t}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}
