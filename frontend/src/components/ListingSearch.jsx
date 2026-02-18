import { useCallback, useEffect, useRef, useState } from "react";
import { toMoney, toArea, toIdText, PLATFORM_OPTIONS, FLOOR_FILTER_OPTIONS } from "../utils/format.js";
import { fetchJson } from "../hooks/useApi.js";
import { resolveExternalListingUrl } from "../utils/listing-url.js";
import ListingCard from "./ListingCard.jsx";
import DetailModal from "./DetailModal.jsx";

export default function ListingSearch({ apiBase, runId, isFavorite, toggleFavorite }) {
  const [platformCode, setPlatformCode] = useState("");
  const [address, setAddress] = useState("");
  const [minRent, setMinRent] = useState("0");
  const [maxRent, setMaxRent] = useState("80");
  const [minArea, setMinArea] = useState("");
  const [maxArea, setMaxArea] = useState("");
  const [minFloor, setMinFloor] = useState("");
  const [limit, setLimit] = useState(40);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingDetailId, setLoadingDetailId] = useState(null);
  const [error, setError] = useState("");

  // Track filter values to auto-reset page when filters change
  const filterKey = `${platformCode}|${address}|${minRent}|${maxRent}|${minArea}|${maxArea}|${minFloor}|${runId}`;
  const prevFilterKeyRef = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKeyRef.current !== filterKey) {
      prevFilterKeyRef.current = filterKey;
      if (page !== 1) {
        setPage(1);
        return; // page change will trigger loadListings via its own effect
      }
    }
  }, [filterKey, page]);

  const buildQuery = useCallback((targetPage = page) => {
    const safePage = Math.max(1, Number(targetPage) || 1);
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("offset", String((safePage - 1) * limit));
    if (runId.trim()) params.set("run_id", runId.trim());
    if (platformCode) params.set("platform_code", platformCode);
    if (address.trim()) params.set("address", address.trim());
    if (minRent.trim()) params.set("min_rent", minRent);
    if (maxRent.trim()) params.set("max_rent", maxRent);
    if (minArea.trim()) params.set("min_area", minArea);
    if (maxArea.trim()) params.set("max_area", maxArea);
    if (minFloor) params.set("min_floor", minFloor);
    return params.toString();
  }, [address, limit, maxArea, maxRent, minArea, minFloor, minRent, page, platformCode, runId]);

  const loadListings = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const query = buildQuery(page);
      const payload = await fetchJson(`${apiBase}/api/listings?${query}`);
      if (payload?.error) {
        throw new Error(`API 오류(${payload.error}): ${payload.message || "요청 처리 실패"}`);
      }
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setTotalCount(typeof payload?.total === "number" ? payload.total : 0);
    } catch (err) {
      setError(`매물 정보를 불러오지 못했습니다. (${String(err?.message || err)})`);
      setItems([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [apiBase, buildQuery, page]);

  const loadDetail = useCallback(async (listingId) => {
    const normalizedId = toIdText(listingId);
    if (!normalizedId) {
      setError("상세 조회 대상 ID가 비어 있습니다.");
      setDetail(null);
      setLoadingDetailId(null);
      return;
    }

    try {
      setError("");
      setDetail(null);
      setLoadingDetail(true);
      setLoadingDetailId(normalizedId);
      const payload = await fetchJson(`${apiBase}/api/listings/${encodeURIComponent(normalizedId)}`);
      if (payload?.error) {
        throw new Error(`API 오류(${payload.error}): ${payload.message || "요청 처리 실패"}`);
      }
      setDetail(payload?.listing || null);
    } catch (err) {
      setError(`상세 조회 실패: ${String(err?.message || err)}`);
    } finally {
      setLoadingDetail(false);
      setLoadingDetailId(null);
    }
  }, [apiBase]);

  const openExternalUrl = useCallback((listing) => {
    const urlToOpen = resolveExternalListingUrl(listing);
    if (!urlToOpen) {
      setError("이동할 외부 링크가 비어 있거나 형식이 잘못되었습니다.");
      return;
    }
    window.open(urlToOpen, "_blank", "noopener,noreferrer");
  }, []);

  const closeDetail = useCallback(() => {
    setDetail(null);
    setLoadingDetail(false);
    setLoadingDetailId(null);
  }, []);

  const handleSearch = useCallback(() => {
    if (page === 1) {
      loadListings();
      return;
    }
    setPage(1);
  }, [loadListings, page]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  const modalOpen = detail !== null || loadingDetail;
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / limit) : 0;

  return (
    <section className="view-shell">
      <header className="section-head">
        <h2>매물 검색</h2>
        <div className="filter-grid">
          <label className="filter-group">
            <span className="filter-label">플랫폼</span>
            <select value={platformCode} onChange={(event) => setPlatformCode(event.target.value)}>
              {PLATFORM_OPTIONS.map((option) => (
                <option key={option.value || "__all__"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-group">
            <span className="filter-label">주소/동</span>
            <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="예: 마포구" />
          </label>
          <label className="filter-group filter-group--pair">
            <span className="filter-label">월세 (만원)</span>
            <div className="filter-pair">
              <input value={minRent} onChange={(event) => setMinRent(event.target.value)} placeholder="최소" />
              <span className="filter-separator">~</span>
              <input value={maxRent} onChange={(event) => setMaxRent(event.target.value)} placeholder="최대" />
            </div>
          </label>
          <label className="filter-group filter-group--pair">
            <span className="filter-label">면적 (㎡)</span>
            <div className="filter-pair">
              <input value={minArea} onChange={(event) => setMinArea(event.target.value)} placeholder="최소" />
              <span className="filter-separator">~</span>
              <input value={maxArea} onChange={(event) => setMaxArea(event.target.value)} placeholder="최대" />
            </div>
          </label>
          <label className="filter-group">
            <span className="filter-label">층수</span>
            <select value={minFloor} onChange={(event) => setMinFloor(event.target.value)}>
              {FLOOR_FILTER_OPTIONS.map((option) => (
                <option key={option.value || "__all__"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-group">
            <span className="filter-label">표시 건수</span>
            <select value={limit} onChange={(event) => setLimit(Math.max(1, Number(event.target.value) || 40))}>
              <option value={20}>20건</option>
              <option value={40}>40건</option>
              <option value={80}>80건</option>
            </select>
          </label>
          <div className="filter-actions">
            <button type="button" onClick={handleSearch}>조회</button>
            <button
              type="button"
              className="filter-reset"
              onClick={() => {
                setPlatformCode("");
                setAddress("");
                setMinRent("0");
                setMaxRent("80");
                setMinArea("");
                setMaxArea("");
                setMinFloor("");
                setError("");
                setDetail(null);
                setPage(1);
              }}
            >
              초기화
            </button>
          </div>
        </div>
      </header>

      {error ? <p className="error-box">{error}</p> : null}

      <section className="card">
        <div className="pager">
          <span className="pager-info">
            페이지 {page}{totalPages > 0 ? ` / ${totalPages}` : ""}
          </span>
          <div className="pager-actions">
            <button
              type="button"
              className="pager-button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1 || loading}
            >
              이전
            </button>
            <button
              type="button"
              className="pager-button"
              onClick={() => setPage((prev) => prev + 1)}
              disabled={loading || items.length < limit || page >= totalPages}
            >
              다음
            </button>
          </div>
          <span className="pager-note">
            {loading ? "조회 중..." : `${totalCount.toLocaleString("ko-KR")}건 중 ${items.length}건 표시`}
          </span>
        </div>

        <div className="listing-grid">
          {items.length === 0 && !loading && (
            <div className="listing-empty">
              <div className="listing-empty-icon">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none">
                  <path d="M10 3a7 7 0 105.2 11.8l4.5 4.5a1 1 0 001.4-1.4l-4.5-4.5A7 7 0 0010 3zm-5 7a5 5 0 1110 0 5 5 0 01-10 0z" fill="#ccc" />
                </svg>
              </div>
              <p>검색 결과가 없습니다.</p>
              <span className="muted">필터 조건을 변경해보세요.</span>
            </div>
          )}
          {items.length === 0 && loading && (
            <div className="listing-empty">
              <div className="mdl-spinner" />
              <p style={{ marginTop: 16 }}>조회 중...</p>
            </div>
          )}
          {items.map((item) => (
            <ListingCard
              key={item.listing_id}
              item={item}
              onClick={() => item.listing_id && loadDetail(item.listing_id)}
              isFavorite={isFavorite ? isFavorite(item.listing_id) : false}
              onToggleFavorite={toggleFavorite ? () => toggleFavorite(item.listing_id) : null}
            />
          ))}
        </div>
      </section>

      {modalOpen && (
        <DetailModal
          detail={detail}
          loading={loadingDetail}
          onClose={closeDetail}
          onOpenExternal={openExternalUrl}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
        />
      )}
    </section>
  );
}
