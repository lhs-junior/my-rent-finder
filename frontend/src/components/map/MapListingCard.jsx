import FavoriteButton from "../FavoriteButton.jsx";

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

const MONEY_SWAP_PLATFORMS = new Set(["dabang", "daangn"]);
const MONEY_SWAP_RENT_MIN = 500;
const MONEY_SWAP_DEPOSIT_MAX = 200;

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

export default function MapListingCard({ marker, isSelected, onClick, isFavorite, onToggleFavorite }) {
  const m = marker;
  const details = [
    m.area_m2 ? `${m.area_m2}m²` : null,
    m.room_count ? `${m.room_count}룸` : null,
    m.floor ? `${m.floor}층` : null,
  ].filter(Boolean).join(" · ");
  const price = normalizeDisplayMoney(m);

  return (
    <div
      className={`map-card${isSelected ? " map-card--selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <div className="map-card-top">
        <span
          className="map-card-platform"
          style={{ background: PLATFORM_COLORS[m.platform_code] || "#6B7280" }}
        >
          {PLATFORM_LABELS[m.platform_code] || m.platform_code}
        </span>
        <span className="map-card-address">{m.address_text || "-"}</span>
        {onToggleFavorite && (
          <FavoriteButton active={isFavorite} onClick={onToggleFavorite} size="sm" />
        )}
      </div>
      <div className="map-card-price">
        보증금 {price.deposit != null ? `${toMoney(price.deposit)}` : "-"} / 월세 {price.rent != null ? `${price.rent}만` : "-"}
      </div>
      {details && <div className="map-card-detail">{details}</div>}
    </div>
  );
}
