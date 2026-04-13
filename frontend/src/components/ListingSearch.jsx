import { useCallback, useEffect, useRef, useState } from "react";
import { PLATFORM_OPTIONS, FLOOR_FILTER_OPTIONS, toIdText } from "../utils/format.js";
import { fetchJson } from "../hooks/useApi.js";
import { resolveExternalListingUrl } from "../utils/listing-url.js";
import ListingCard from "./ListingCard.jsx";
import DetailModal from "./DetailModal.jsx";

const DEFAULT_FILTERS = {
  platformCode: "",
  address: "",
  minRent: "0",
  maxRent: "100",
  minArea: "",
  maxArea: "",
  minFloor: "",
  hasImage: "",
  onlyFavorites: false,
  limit: "40",
};

function toTrimmedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseOptionalNumber(value) {
  const text = toTrimmedText(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validateFilters(filters) {
  const errors = {};
  const minRent = parseOptionalNumber(filters.minRent);
  const maxRent = parseOptionalNumber(filters.maxRent);
  const minArea = parseOptionalNumber(filters.minArea);
  const maxArea = parseOptionalNumber(filters.maxArea);

  if (Number.isNaN(minRent)) errors.minRent = "숫자만";
  if (Number.isNaN(maxRent)) errors.maxRent = "숫자만";
  if (Number.isNaN(minArea)) errors.minArea = "숫자만";
  if (Number.isNaN(maxArea)) errors.maxArea = "숫자만";

  if (!errors.minRent && !errors.maxRent && minRent !== null && maxRent !== null && minRent > maxRent) {
    errors.minRent = "최솟값이 최댓값보다 큼";
  }
  if (!errors.minArea && !errors.maxArea && minArea !== null && maxArea !== null && minArea > maxArea) {
    errors.minArea = "최솟값이 최댓값보다 큼";
  }

  return errors;
}

function formatTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ListingSearch({ apiBase, runId, isFavorite, toggleFavorite, favoriteIds, onViewOnMap }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [submittedFilters, setSubmittedFilters] = useState(DEFAULT_FILTERS);
  const [formErrors, setFormErrors] = useState({});
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingDetailId, setLoadingDetailId] = useState(null);
  const [error, setError] = useState("");
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState("");
  const [searchToken, setSearchToken] = useState(0);

  const buildQuery = useCallback((targetFilters = submittedFilters, targetPage = page) => {
    const safePage = Math.max(1, Number(targetPage) || 1);
    const safeLimit = Math.max(1, Number(targetFilters.limit) || 40);
    const params = new URLSearchParams();
    params.set("limit", String(safeLimit));
    params.set("offset", String((safePage - 1) * safeLimit));
    if (runId.trim()) params.set("run_id", runId.trim());
    if (targetFilters.platformCode) params.set("platform_code", targetFilters.platformCode);
    if (toTrimmedText(targetFilters.address)) params.set("address", toTrimmedText(targetFilters.address));
    if (toTrimmedText(targetFilters.minRent)) params.set("min_rent", targetFilters.minRent);
    if (toTrimmedText(targetFilters.maxRent)) params.set("max_rent", targetFilters.maxRent);
    if (toTrimmedText(targetFilters.minArea)) params.set("min_area", targetFilters.minArea);
    if (toTrimmedText(targetFilters.maxArea)) params.set("max_area", targetFilters.maxArea);
    if (targetFilters.minFloor) params.set("min_floor", targetFilters.minFloor);
    if (targetFilters.hasImage) params.set("has_image", targetFilters.hasImage);
    if (targetFilters.onlyFavorites && favoriteIds?.size > 0) {
      params.set("favorite_ids", Array.from(favoriteIds).join(","));
    }
    return params.toString();
  }, [page, runId, submittedFilters, favoriteIds]);

  const loadListings = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const query = buildQuery();
      const payload = await fetchJson(`${apiBase}/api/listings?${query}`);
      if (payload?.error) throw new Error(`API 오류: ${payload.message || "요청 실패"}`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setTotalCount(typeof payload?.total === "number" ? payload.total : 0);
      setHasLoadedOnce(true);
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(String(err?.message || err));
      setItems([]);
      setTotalCount(0);
      setHasLoadedOnce(true);
    } finally {
      setLoading(false);
    }
  }, [apiBase, buildQuery]);

  const loadDetail = useCallback(async (listingId) => {
    const normalizedId = toIdText(listingId);
    if (!normalizedId) return;
    try {
      setError("");
      setDetail(null);
      setLoadingDetail(true);
      setLoadingDetailId(normalizedId);
      const payload = await fetchJson(`${apiBase}/api/listings/${encodeURIComponent(normalizedId)}`);
      if (payload?.error) throw new Error(`상세 오류: ${payload.message || "실패"}`);
      setDetail(payload?.listing || null);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoadingDetail(false);
      setLoadingDetailId(null);
    }
  }, [apiBase]);

  const openExternalUrl = useCallback((listing) => {
    const url = resolveExternalListingUrl(listing);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const closeDetail = useCallback(() => {
    setDetail(null);
    setLoadingDetail(false);
    setLoadingDetailId(null);
  }, []);

  const runSearch = useCallback((nextFilters) => {
    const validation = validateFilters(nextFilters);
    setFormErrors(validation);
    if (Object.keys(validation).length > 0) return false;
    setSubmittedFilters(nextFilters);
    setPage(1);
    setSearchToken(t => t + 1);
    setDetail(null);
    return true;
  }, []);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    runSearch(filters);
  }, [filters, runSearch]);

  const set = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setFormErrors(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setSubmittedFilters(DEFAULT_FILTERS);
    setFormErrors({});
    setError("");
    setDetail(null);
    setPage(1);
    setSearchToken(t => t + 1);
  }, []);

  useEffect(() => { loadListings(); }, [loadListings, searchToken]);

  const modalOpen = detail !== null || loadingDetail;
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / Math.max(1, Number(submittedFilters.limit) || 40)) : 0;
  const favActive = submittedFilters.onlyFavorites;
  const favCount = favoriteIds?.size || 0;

  return (
    <section className="ls-page">
      {/* 헤더 */}
      <div className="ls-header">
        <div className="ls-header-left">
          <h2 className="ls-title">매물 검색</h2>
          {hasLoadedOnce && !error && (
            <span className="ls-count-badge">{totalCount.toLocaleString("ko-KR")}건</span>
          )}
          {lastLoadedAt && (
            <span className="ls-last-updated">· {formatTimestamp(lastLoadedAt)} 기준</span>
          )}
        </div>
        <div className="ls-header-actions">
          <button type="button" className="ls-btn-reset" onClick={handleReset}>초기화</button>
          <button type="submit" form="ls-form" className="ls-btn-search" disabled={loading}>
            {loading ? "조회 중..." : "검색"}
          </button>
        </div>
      </div>

      {/* 필터 폼 */}
      <form id="ls-form" className="ls-filters" onSubmit={handleSubmit} noValidate>
        {/* 플랫폼 */}
        <div className="ls-filter-row ls-filter-row--platform">
          {PLATFORM_OPTIONS.map(o => (
            <button
              key={o.value || "__all__"}
              type="button"
              className={`ls-chip${filters.platformCode === o.value ? " ls-chip--active" : ""}`}
              onClick={() => set("platformCode", o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* 주요 필터 */}
        <div className="ls-filter-row ls-filter-row--main">
          {/* 주소 */}
          <div className="ls-field">
            <span className="ls-field-label">주소</span>
            <input
              className="ls-input ls-input--addr"
              value={filters.address}
              onChange={e => set("address", e.target.value)}
              placeholder="동/구 이름"
            />
          </div>

          {/* 월세 */}
          <div className={`ls-field${formErrors.minRent ? " ls-field--err" : ""}`}>
            <span className="ls-field-label">월세(만원)</span>
            <div className="ls-range">
              <input
                className="ls-input ls-input--num"
                inputMode="numeric"
                value={filters.minRent}
                onChange={e => set("minRent", e.target.value)}
                placeholder="0"
              />
              <span className="ls-range-sep">~</span>
              <input
                className="ls-input ls-input--num"
                inputMode="numeric"
                value={filters.maxRent}
                onChange={e => set("maxRent", e.target.value)}
                placeholder="100"
              />
            </div>
            {formErrors.minRent && <p className="ls-field-err">{formErrors.minRent}</p>}
          </div>

          {/* 면적 */}
          <div className={`ls-field${formErrors.minArea ? " ls-field--err" : ""}`}>
            <span className="ls-field-label">면적(㎡)</span>
            <div className="ls-range">
              <input
                className="ls-input ls-input--num"
                inputMode="numeric"
                value={filters.minArea}
                onChange={e => set("minArea", e.target.value)}
                placeholder="최소"
              />
              <span className="ls-range-sep">~</span>
              <input
                className="ls-input ls-input--num"
                inputMode="numeric"
                value={filters.maxArea}
                onChange={e => set("maxArea", e.target.value)}
                placeholder="최대"
              />
            </div>
            {formErrors.minArea && <p className="ls-field-err">{formErrors.minArea}</p>}
          </div>

          {/* 층 */}
          <div className="ls-field">
            <span className="ls-field-label">층</span>
            <select
              className="ls-select"
              value={filters.minFloor}
              onChange={e => set("minFloor", e.target.value)}
            >
              {FLOOR_FILTER_OPTIONS.map(o => (
                <option key={o.value || "__all__"} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* 사진 */}
          <div className="ls-field">
            <span className="ls-field-label">사진</span>
            <div className="ls-chip-group">
              {[{ v: "", l: "전체" }, { v: "true", l: "있음" }, { v: "false", l: "없음" }].map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  className={`ls-chip${filters.hasImage === opt.v ? " ls-chip--active" : ""}`}
                  onClick={() => set("hasImage", opt.v)}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>

          {/* 찜만 보기 */}
          <div className="ls-field">
            <span className="ls-field-label">찜</span>
            <button
              type="button"
              className={`ls-chip ls-chip--fav${filters.onlyFavorites ? " ls-chip--active" : ""}${favCount === 0 ? " ls-chip--disabled" : ""}`}
              onClick={() => set("onlyFavorites", !filters.onlyFavorites)}
              disabled={favCount === 0}
              title={favCount === 0 ? "찜한 매물이 없습니다" : ""}
            >
              ♥ 찜만{favCount > 0 ? ` (${favCount})` : ""}
            </button>
          </div>

          {/* 표시 건수 */}
          <div className="ls-field">
            <span className="ls-field-label">표시</span>
            <select
              className="ls-select"
              value={filters.limit}
              onChange={e => set("limit", e.target.value)}
            >
              <option value="20">20건</option>
              <option value="40">40건</option>
              <option value="80">80건</option>
            </select>
          </div>
        </div>

        {/* 적용된 필터 태그 */}
        {favActive && (
          <div className="ls-active-tag">
            <span className="ls-tag ls-tag--fav">♥ 찜만 보기 적용 중</span>
          </div>
        )}
      </form>

      {/* 에러 */}
      {error && <div className="ls-error">{error}</div>}

      {/* 페이지네이션 상단 */}
      <div className="ls-results-header">
        <span className="ls-results-info">
          {loading ? "조회 중..." : `${totalCount.toLocaleString("ko-KR")}건 중 ${items.length}건`}
        </span>
        <div className="ls-pager">
          <button
            type="button"
            className="ls-pager-btn"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >이전</button>
          <span className="ls-pager-info">{page}{totalPages > 0 ? ` / ${totalPages}` : ""}</span>
          <button
            type="button"
            className="ls-pager-btn"
            onClick={() => setPage(p => p + 1)}
            disabled={loading || items.length < Math.max(1, Number(submittedFilters.limit) || 40) || page >= totalPages}
          >다음</button>
        </div>
      </div>

      {/* 결과 */}
      <div className="listing-grid listing-grid--search">
        {loading && items.length === 0 && Array.from({ length: 4 }).map((_, i) => (
          <article key={`sk-${i}`} className="listing-card listing-card--search listing-card--skeleton" aria-hidden="true">
            <div className="listing-card-thumb" />
            <div className="listing-card-body">
              <div className="listing-card-skeleton-line listing-card-skeleton-line--short" />
              <div className="listing-card-skeleton-line" />
              <div className="listing-card-skeleton-line" />
            </div>
          </article>
        ))}

        {!loading && items.length === 0 && hasLoadedOnce && (
          <div className="listing-empty listing-empty--search">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none">
              <path d="M10 3a7 7 0 105.2 11.8l4.5 4.5a1 1 0 001.4-1.4l-4.5-4.5A7 7 0 0010 3zm-5 7a5 5 0 1110 0 5 5 0 01-10 0z" fill="#d6d3d1" />
            </svg>
            <p>{favActive ? "찜한 매물 중 조건에 맞는 항목이 없습니다." : "조건에 맞는 매물이 없습니다."}</p>
          </div>
        )}

        {items.map(item => (
          <ListingCard
            key={item.listing_id}
            item={item}
            variant="search"
            onClick={() => item.listing_id && loadDetail(item.listing_id)}
            isFavorite={isFavorite ? isFavorite(item.listing_id) : false}
            onToggleFavorite={toggleFavorite ? () => toggleFavorite(item.listing_id) : null}
            onViewOnMap={onViewOnMap}
            isLoadingDetail={loadingDetailId === toIdText(item.listing_id)}
          />
        ))}
      </div>

      {modalOpen && (
        <DetailModal
          detail={detail}
          loading={loadingDetail}
          onClose={closeDetail}
          onOpenExternal={openExternalUrl}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
          apiBase={apiBase}
        />
      )}
    </section>
  );
}
