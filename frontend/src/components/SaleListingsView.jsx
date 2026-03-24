// frontend/src/components/SaleListingsView.jsx
import { useState, useEffect } from "react";
import { AffordabilityBadge } from "./AffordabilityBadge.jsx";

export function SaleListingsView({ apiBase = "" }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    sigungu: "",
    salePriceMax: "",
    onlyFeasible: false,
  });
  const [feasibleIds, setFeasibleIds] = useState(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ lease_type: "매매" });
    if (filters.sigungu) params.set("address", filters.sigungu);

    fetch(`${apiBase}/api/listings?${params}`)
      .then((r) => r.json())
      .then((data) => setListings(data.listings || []))
      .catch((err) => {
        setError(err.message || "데이터를 불러올 수 없습니다");
        setListings([]);
      })
      .finally(() => setLoading(false));
  }, [filters.sigungu, filters.salePriceMax, apiBase]);

  const displayed = filters.onlyFeasible
    ? listings.filter((l) => feasibleIds.has(l.listing_id))
    : listings;

  return (
    <div className="sale-listings">
      <div className="filter-bar">
        <input
          placeholder="구 입력 (예: 노원구)"
          value={filters.sigungu}
          onChange={(e) => setFilters((f) => ({ ...f, sigungu: e.target.value }))}
        />
        <input
          placeholder="최대 매매가 (만원)"
          value={filters.salePriceMax}
          onChange={(e) => setFilters((f) => ({ ...f, salePriceMax: e.target.value }))}
        />
        <label>
          <input
            type="checkbox"
            checked={filters.onlyFeasible}
            onChange={(e) => setFilters((f) => ({ ...f, onlyFeasible: e.target.checked }))}
          />
          내 자본으로 가능한 매물만
        </label>
      </div>

      {loading && <p>로딩 중...</p>}
      {error && <p className="error">오류: {error}</p>}
      <div className="listing-grid">
        {displayed.map((listing) => (
          <div key={listing.listing_id} className="listing-card">
            <div className="listing-card-header">
              <span className="property-type">{listing.building_use}</span>
              <AffordabilityBadge
                salePrice={listing.sale_price}
                onResult={(r) => {
                  if (r?.feasible) setFeasibleIds((s) => new Set([...s, listing.listing_id]));
                }}
              />
            </div>
            <p className="address">{listing.address_text}</p>
            <p className="price">매매가 {listing.sale_price?.toLocaleString() ?? "미정"}만원</p>
            <p className="area">
              {listing.area_exclusive_m2 ?? listing.area_gross_m2}㎡
              {listing.floor != null && ` · ${listing.floor}층`}
              {listing.building_year != null && ` · ${listing.building_year}년`}
            </p>
          </div>
        ))}
        {!loading && displayed.length === 0 && (
          <p className="muted">매매 매물이 없습니다. 수집 후 다시 확인하세요.</p>
        )}
      </div>
    </div>
  );
}
