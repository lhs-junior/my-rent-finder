import FavoriteButton from "../FavoriteButton.jsx";
import { toPlatformLabel, PLATFORM_COLORS } from "../../utils/format.js";

const MONEY_SWAP_PLATFORMS = new Set(["dabang", "daangn"]);
const MONEY_SWAP_RENT_MIN = 500;
const MONEY_SWAP_DEPOSIT_MAX = 200;
const DARK_TEXT_PLATFORMS = new Set(["naver", "daangn"]);

function toMoney(v) {
  if (v == null) return "-";
  return v >= 10000 ? `${(v / 10000).toFixed(1)}억` : `${v}만`;
}

function normalizeDisplayMoney(item) {
  const rentAmount = Number(item?.rent_amount);
  const depositAmount = Number(item?.deposit_amount);
  if (!Number.isFinite(rentAmount) || !Number.isFinite(depositAmount)) {
    return {
      rent: Number.isFinite(rentAmount) ? rentAmount : null,
      deposit: Number.isFinite(depositAmount) ? depositAmount : null,
    };
  }

  const platform = String(item?.platform_code || "").toLowerCase();
  const leaseType = String(item?.lease_type || "").trim();
  if (!MONEY_SWAP_PLATFORMS.has(platform) || leaseType !== "월세") {
    return {
      rent: rentAmount,
      deposit: depositAmount,
    };
  }

  if (depositAmount > 0 && rentAmount > MONEY_SWAP_RENT_MIN && depositAmount <= MONEY_SWAP_DEPOSIT_MAX) {
    return {
      rent: depositAmount,
      deposit: rentAmount,
    };
  }

  return {
    rent: rentAmount,
    deposit: depositAmount,
  };
}

function platformBadgeStyle(platform) {
  const normalized = String(platform || "").toLowerCase();
  return {
    background: PLATFORM_COLORS[platform] || "#6B7280",
    color: DARK_TEXT_PLATFORMS.has(normalized) ? "#111110" : "#fff",
  };
}

export default function MapListingCard({ marker, isSelected, onClick, isFavorite, onToggleFavorite }) {
  const m = marker;
  const details = [
    m.area_m2 ? `${m.area_m2}m²` : null,
    m.room_count ? `${m.room_count}룸` : null,
    m.floor ? `${m.floor}층` : null,
  ].filter(Boolean).join(" · ");
  const price = normalizeDisplayMoney(m);

  return (
    <div className={`map-card${isSelected ? " map-card--selected" : ""}`}>
      <button
        type="button"
        className="map-card-main"
        aria-label={`${m.address_text || "매물"} 상세 보기`}
        onClick={onClick}
      >
        <div className="map-card-top">
          <span
            className="map-card-platform"
            style={platformBadgeStyle(m.platform_code)}
          >
            {toPlatformLabel(m.platform_code)}
          </span>
          <span className="map-card-address">{m.address_text || "-"}</span>
        </div>
        <div className="map-card-price">
          보증금 {price.deposit != null ? `${toMoney(price.deposit)}` : "-"} / 월세 {price.rent != null ? `${price.rent}만` : "-"}
        </div>
        {details && <div className="map-card-detail">{details}</div>}
      </button>
      {onToggleFavorite && (
        <div className="map-card-fav">
          <FavoriteButton active={isFavorite} onClick={onToggleFavorite} size="sm" />
        </div>
      )}
    </div>
  );
}
