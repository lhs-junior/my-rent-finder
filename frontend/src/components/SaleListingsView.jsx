// frontend/src/components/SaleListingsView.jsx
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "../hooks/useApi.js";
import ListingCard from "./ListingCard.jsx";
import DetailModal from "./DetailModal.jsx";
import { AffordabilityBadge } from "./AffordabilityBadge.jsx";

const DEFAULT_FILTERS = {
  address: "",
  maxSalePrice: "",
  minArea: "",
  buildingUse: "",
  onlyFeasible: false,
};

const BUILDING_USE_OPTIONS = [
  { value: "", label: "전체" },
  { value: "아파트", label: "아파트" },
  { value: "빌라", label: "빌라/연립" },
  { value: "단독", label: "단독/다가구" },
];

function toTrimmedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function SaleListingsView({ apiBase = "", isFavorite, toggleFavorite }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingDetailId, setLoadingDetailId] = useState(null);

  const [feasibleIds, setFeasibleIds] = useState(new Set());

  const searchToken = useRef(0);

  const buildParams = useCallback((f) => {
    const params = new URLSearchParams({ lease_type: "매매", limit: "80" });
    if (toTrimmedText(f.address)) params.set("address", toTrimmedText(f.address));
    if (toTrimmedText(f.maxSalePrice)) params.set("max_sale_price", toTrimmedText(f.maxSalePrice));
    if (toTrimmedText(f.minArea)) params.set("min_area", toTrimmedText(f.minArea));
    if (toTrimmedText(f.buildingUse)) params.set("building_use", toTrimmedText(f.buildingUse));
    return params;
  }, []);

  useEffect(() => {
    const token = ++searchToken.current;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = buildParams(filters);
      fetchJson(`${apiBase}/api/listings?${params}`)
      .then((data) => {
        if (token !== searchToken.current) return;
        setItems(data.items || []);
        setTotal(data.total || 0);
        setLoadedAt(new Date().toISOString());
      })
      .catch((err) => {
        if (token !== searchToken.current) return;
        setError(err.message || "데이터를 불러올 수 없습니다");
        setItems([]);
      })
      .finally(() => {
        if (token === searchToken.current) setLoading(false);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [filters, apiBase, buildParams]);

  const handleCardClick = useCallback(async (item) => {
    const id = item.listing_id;
    setSelectedId(id);
    setDetail(null);
    setLoadingDetail(true);
    setLoadingDetailId(id);
    try {
      const data = await fetchJson(`${apiBase}/api/listings/${id}`);
      setDetail(data.listing || data);
    } catch {
      setDetail(null);
    } finally {
      setLoadingDetail(false);
      setLoadingDetailId(null);
    }
  }, [apiBase]);

  const handleClose = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
  }, []);

  const handleAffordabilityResult = useCallback((listingId, result) => {
    if (result?.feasible) {
      setFeasibleIds((prev) => {
        if (prev.has(listingId)) return prev;
        const next = new Set(prev);
        next.add(listingId);
        return next;
      });
    }
  }, []);

  const displayed = filters.onlyFeasible
    ? items.filter((item) => feasibleIds.has(item.listing_id))
    : items;

  const formatLoadedAt = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="listing-search">
      {/* Filter bar */}
      <div className="listing-search-filters">
        <div className="filter-row">
          <input
            className="filter-input"
            placeholder="구 입력 (예: 노원구)"
            value={filters.address}
            onChange={(e) => setFilters((f) => ({ ...f, address: e.target.value }))}
          />
          <input
            className="filter-input"
            placeholder="최대 매매가 (만원)"
            value={filters.maxSalePrice}
            inputMode="numeric"
            onChange={(e) => setFilters((f) => ({ ...f, maxSalePrice: e.target.value }))}
          />
          <input
            className="filter-input"
            placeholder="최소 면적 (m²)"
            value={filters.minArea}
            inputMode="numeric"
            onChange={(e) => setFilters((f) => ({ ...f, minArea: e.target.value }))}
          />
          <select
            className="filter-select"
            value={filters.buildingUse}
            onChange={(e) => setFilters((f) => ({ ...f, buildingUse: e.target.value }))}
          >
            {BUILDING_USE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <label className="filter-checkbox-label">
            <input
              type="checkbox"
              checked={filters.onlyFeasible}
              onChange={(e) => setFilters((f) => ({ ...f, onlyFeasible: e.target.checked }))}
            />
            내 자본으로 가능한 매물만
          </label>
        </div>
      </div>

      {/* Status bar */}
      <div className="listing-search-meta" aria-live="polite">
        {loading ? (
          <span className="muted">검색 중...</span>
        ) : error ? (
          <span className="error">오류: {error}</span>
        ) : (
          <span className="muted">
            매매 매물 {displayed.length}건{total !== displayed.length ? ` (전체 ${total}건)` : ""}
            {loadedAt ? ` · 수집 ${formatLoadedAt(loadedAt)}` : ""}
          </span>
        )}
      </div>

      {/* Listing grid */}
      <div className="listing-search-grid">
        {displayed.map((item) => (
          <div key={item.listing_id} className="sale-card-wrapper">
            <ListingCard
              item={item}
              onClick={() => handleCardClick(item)}
              isFavorite={typeof isFavorite === "function" ? isFavorite(item.listing_id) : false}
              onToggleFavorite={toggleFavorite ? () => toggleFavorite(item.listing_id) : undefined}
              variant="search"
              isLoadingDetail={loadingDetailId === item.listing_id}
            />
            <div className="sale-card-afford">
              <AffordabilityBadge
                salePrice={item.sale_price}
                onResult={(r) => handleAffordabilityResult(item.listing_id, r)}
              />
            </div>
          </div>
        ))}
        {!loading && displayed.length === 0 && (
          <p className="muted" style={{ gridColumn: "1 / -1", textAlign: "center", padding: "2rem" }}>
            {error ? "데이터를 불러올 수 없습니다." : "매매 매물이 없습니다. 수집 후 다시 확인하세요."}
          </p>
        )}
      </div>

      {/* Detail modal */}
      {(selectedId || loadingDetail) && (
        <DetailModal
          detail={detail}
          loading={loadingDetail}
          onClose={handleClose}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
          apiBase={apiBase}
        />
      )}
    </div>
  );
}
