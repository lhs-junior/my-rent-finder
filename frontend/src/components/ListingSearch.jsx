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
  maxRent: "80",
  minArea: "",
  maxArea: "",
  minFloor: "",
  limit: "40",
};

const FIELD_ORDER = ["minRent", "maxRent", "minArea", "maxArea"];

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

  if (Number.isNaN(minRent)) errors.minRent = "숫자만 입력하세요.";
  if (Number.isNaN(maxRent)) errors.maxRent = "숫자만 입력하세요.";
  if (Number.isNaN(minArea)) errors.minArea = "숫자만 입력하세요.";
  if (Number.isNaN(maxArea)) errors.maxArea = "숫자만 입력하세요.";

  if (!errors.minRent && minRent !== null && minRent < 0) {
    errors.minRent = "0 이상 값을 입력하세요.";
  }
  if (!errors.maxRent && maxRent !== null && maxRent < 0) {
    errors.maxRent = "0 이상 값을 입력하세요.";
  }
  if (!errors.minArea && minArea !== null && minArea < 0) {
    errors.minArea = "0 이상 값을 입력하세요.";
  }
  if (!errors.maxArea && maxArea !== null && maxArea < 0) {
    errors.maxArea = "0 이상 값을 입력하세요.";
  }

  if (!errors.minRent && !errors.maxRent && minRent !== null && maxRent !== null && minRent > maxRent) {
    errors.minRent = "최소 월세가 최대 월세보다 클 수 없습니다.";
  }
  if (!errors.minArea && !errors.maxArea && minArea !== null && maxArea !== null && minArea > maxArea) {
    errors.minArea = "최소 면적이 최대 면적보다 클 수 없습니다.";
  }

  return errors;
}

function countAppliedFilters(filters) {
  let count = 0;
  if (filters.platformCode) count += 1;
  if (toTrimmedText(filters.address)) count += 1;
  if (toTrimmedText(filters.minArea)) count += 1;
  if (toTrimmedText(filters.maxArea)) count += 1;
  if (filters.minFloor) count += 1;
  if (toTrimmedText(filters.minRent) !== DEFAULT_FILTERS.minRent) count += 1;
  if (toTrimmedText(filters.maxRent) !== DEFAULT_FILTERS.maxRent) count += 1;
  if (toTrimmedText(filters.limit) !== DEFAULT_FILTERS.limit) count += 1;
  return count;
}

function formatTimestamp(value) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "기록 없음";
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildAppliedFilterChips(filters) {
  const chips = [];
  if (filters.platformCode) {
    const option = PLATFORM_OPTIONS.find((candidate) => candidate.value === filters.platformCode);
    chips.push(`플랫폼 ${option?.label || filters.platformCode}`);
  }
  if (toTrimmedText(filters.address)) chips.push(`주소 ${toTrimmedText(filters.address)}`);
  if (toTrimmedText(filters.minRent) || toTrimmedText(filters.maxRent)) {
    chips.push(`월세 ${filters.minRent || "0"}~${filters.maxRent || "제한 없음"}만원`);
  }
  if (toTrimmedText(filters.minArea) || toTrimmedText(filters.maxArea)) {
    chips.push(`면적 ${filters.minArea || "0"}~${filters.maxArea || "제한 없음"}㎡`);
  }
  if (filters.minFloor) {
    const option = FLOOR_FILTER_OPTIONS.find((candidate) => candidate.value === filters.minFloor);
    chips.push(option?.label || filters.minFloor);
  }
  chips.push(`${filters.limit}건씩 표시`);
  return chips;
}

export default function ListingSearch({ apiBase, runId, isFavorite, toggleFavorite }) {
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

  const minRentRef = useRef(null);
  const maxRentRef = useRef(null);
  const minAreaRef = useRef(null);
  const maxAreaRef = useRef(null);
  const addressRef = useRef(null);

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
    return params.toString();
  }, [page, runId, submittedFilters]);

  const loadListings = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const query = buildQuery();
      const payload = await fetchJson(`${apiBase}/api/listings?${query}`);
      if (payload?.error) {
        throw new Error(`API 오류(${payload.error}): ${payload.message || "요청 처리 실패"}`);
      }
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setTotalCount(typeof payload?.total === "number" ? payload.total : 0);
      setHasLoadedOnce(true);
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(`매물 정보를 불러오지 못했습니다. (${String(err?.message || err)})`);
      setItems([]);
      setTotalCount(0);
      setHasLoadedOnce(true);
    } finally {
      setLoading(false);
    }
  }, [apiBase, buildQuery]);

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

  const focusFirstInvalidField = useCallback((errors) => {
    const refs = {
      address: addressRef,
      minRent: minRentRef,
      maxRent: maxRentRef,
      minArea: minAreaRef,
      maxArea: maxAreaRef,
    };
    const firstKey = FIELD_ORDER.find((key) => errors[key]) || Object.keys(errors)[0];
    refs[firstKey]?.current?.focus();
  }, []);

  const runSearch = useCallback((nextFilters) => {
    const validation = validateFilters(nextFilters);
    setFormErrors(validation);
    if (Object.keys(validation).length > 0) {
      focusFirstInvalidField(validation);
      return false;
    }

    setSubmittedFilters(nextFilters);
    setPage(1);
    setSearchToken((current) => current + 1);
    setDetail(null);
    return true;
  }, [focusFirstInvalidField]);

  const handleSubmit = useCallback((event) => {
    event.preventDefault();
    runSearch(filters);
  }, [filters, runSearch]);

  const updateFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setFormErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
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
    setSearchToken((current) => current + 1);
  }, []);

  const applySuggestion = useCallback((patch) => {
    const nextFilters = { ...filters, ...patch };
    setFilters(nextFilters);
    runSearch(nextFilters);
  }, [filters, runSearch]);

  useEffect(() => {
    loadListings();
  }, [loadListings, searchToken]);

  const modalOpen = detail !== null || loadingDetail;
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / Math.max(1, Number(submittedFilters.limit) || 40)) : 0;
  const staleCount = items.filter((item) => item.is_stale).length;
  const imageReadyCount = items.filter((item) => Number(item.image_count) > 0).length;
  const displayedRunId = items.find((item) => toTrimmedText(item?.run_id))?.run_id || runId.trim() || "latest";
  const latestCreatedAt = items.reduce((latest, item) => {
    if (!item?.created_at) return latest;
    if (!latest) return item.created_at;
    return new Date(item.created_at).getTime() > new Date(latest).getTime() ? item.created_at : latest;
  }, "");
  const appliedFilterChips = buildAppliedFilterChips(submittedFilters);
  const appliedFilterCount = countAppliedFilters(submittedFilters);
  const stateTone = error
    ? "error"
    : loading
      ? "loading"
      : items.length === 0
        ? "empty"
        : "success";

  return (
    <section className="view-shell listing-search-page">
      <header className="section-head search-overview-panel">
        <div className="search-overview-copy">
          <span className="section-kicker">통합 검색</span>
          <h2>매물 검색</h2>
          <p>
            예산, 면적, 층 조건을 고정한 뒤 결과를 갱신하고,
            stale 여부와 이미지 확보 상태를 첫 화면에서 바로 확인합니다.
          </p>
        </div>
        <div className="search-proof-grid">
          <article className="search-proof-card">
            <span className="search-proof-label">현재 결과</span>
            <strong className="search-proof-value">
              {error ? "조회 실패" : hasLoadedOnce ? `${totalCount.toLocaleString("ko-KR")}건` : "조회 준비"}
            </strong>
            <span className="search-proof-meta">현재 페이지 {page}{totalPages > 0 ? ` / ${totalPages}` : ""}</span>
          </article>
          <article className="search-proof-card">
            <span className="search-proof-label">적용 조건</span>
            <strong className="search-proof-value">{appliedFilterCount}개</strong>
            <span className="search-proof-meta">{appliedFilterCount > 0 ? "기본값에서 조정됨" : "기본 조건 유지"}</span>
          </article>
          <article className="search-proof-card">
            <span className="search-proof-label">실행 기준</span>
            <strong className="search-proof-value">{displayedRunId}</strong>
            <span className="search-proof-meta">
              최근 반영 {latestCreatedAt ? formatTimestamp(latestCreatedAt) : "기록 없음"}
            </span>
          </article>
        </div>
      </header>

      <form className="card search-form-panel" onSubmit={handleSubmit} noValidate>
        <div className="search-form-head">
          <div>
            <h3>검색 조건</h3>
            <p className="muted">조회는 제출형으로 동작한다. 유효성 문제가 있으면 첫 문제 필드로 포커스를 이동한다.</p>
          </div>
          <div className="search-form-actions">
            <button type="submit" className="search-submit-button" disabled={loading}>
              {loading ? "조회 중..." : "검색 실행"}
            </button>
            <button type="button" className="search-reset-button" onClick={handleReset}>
              기본값 복원
            </button>
          </div>
        </div>

        <div className="search-platform-group" role="group" aria-label="플랫폼 선택">
          {PLATFORM_OPTIONS.map((option) => (
            <button
              key={option.value || "__all__"}
              type="button"
              className={`filter-chip${filters.platformCode === option.value ? " filter-chip--active" : ""}`}
              onClick={() => updateFilter("platformCode", option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="search-field-grid">
          <label className="search-field" htmlFor="search-address">
            <span className="search-field-label">주소 / 동 검색</span>
            <input
              ref={addressRef}
              id="search-address"
              className="search-input"
              value={filters.address}
              onChange={(event) => updateFilter("address", event.target.value)}
              placeholder="예: 성수동, 면목동"
            />
          </label>

          <div className={`search-field${formErrors.minRent ? " search-field--invalid" : ""}`}>
            <span className="search-field-label">월세 범위</span>
            <div className="search-range">
              <input
                ref={minRentRef}
                id="search-min-rent"
                className="search-input"
                inputMode="numeric"
                value={filters.minRent}
                onChange={(event) => updateFilter("minRent", event.target.value)}
                aria-invalid={Boolean(formErrors.minRent)}
                aria-describedby={formErrors.minRent ? "search-min-rent-error" : undefined}
                placeholder="0"
              />
              <span className="search-range-sep">~</span>
              <input
                ref={maxRentRef}
                id="search-max-rent"
                className="search-input"
                inputMode="numeric"
                value={filters.maxRent}
                onChange={(event) => updateFilter("maxRent", event.target.value)}
                aria-invalid={Boolean(formErrors.minRent)}
                aria-describedby={formErrors.minRent ? "search-min-rent-error" : undefined}
                placeholder="80"
              />
              <span className="search-range-unit">만원</span>
            </div>
            {formErrors.minRent && (
              <p className="search-field-error" id="search-min-rent-error">{formErrors.minRent}</p>
            )}
          </div>

          <div className={`search-field${formErrors.minArea ? " search-field--invalid" : ""}`}>
            <span className="search-field-label">면적 범위</span>
            <div className="search-range">
              <input
                ref={minAreaRef}
                id="search-min-area"
                className="search-input"
                inputMode="numeric"
                value={filters.minArea}
                onChange={(event) => updateFilter("minArea", event.target.value)}
                aria-invalid={Boolean(formErrors.minArea)}
                aria-describedby={formErrors.minArea ? "search-min-area-error" : undefined}
                placeholder="최소"
              />
              <span className="search-range-sep">~</span>
              <input
                ref={maxAreaRef}
                id="search-max-area"
                className="search-input"
                inputMode="numeric"
                value={filters.maxArea}
                onChange={(event) => updateFilter("maxArea", event.target.value)}
                aria-invalid={Boolean(formErrors.minArea)}
                aria-describedby={formErrors.minArea ? "search-min-area-error" : undefined}
                placeholder="최대"
              />
              <span className="search-range-unit">㎡</span>
            </div>
            {formErrors.minArea && (
              <p className="search-field-error" id="search-min-area-error">{formErrors.minArea}</p>
            )}
          </div>

          <label className="search-field" htmlFor="search-floor">
            <span className="search-field-label">층 조건</span>
            <select
              id="search-floor"
              className="search-select"
              value={filters.minFloor}
              onChange={(event) => updateFilter("minFloor", event.target.value)}
            >
              {FLOOR_FILTER_OPTIONS.map((option) => (
                <option key={option.value || "__all__"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="search-field" htmlFor="search-limit">
            <span className="search-field-label">페이지당 노출</span>
            <select
              id="search-limit"
              className="search-select"
              value={filters.limit}
              onChange={(event) => updateFilter("limit", event.target.value)}
            >
              <option value="20">20건</option>
              <option value="40">40건</option>
              <option value="80">80건</option>
            </select>
          </label>
        </div>

        <div className="search-form-footer">
          <div className="search-chip-list" aria-label="적용된 검색 조건">
            {appliedFilterChips.map((chip) => (
              <span key={chip} className="search-summary-chip">{chip}</span>
            ))}
          </div>
          <p className="search-helper-text">proof, status, next action을 위쪽에서 먼저 읽을 수 있게 결과 요약을 고정한다.</p>
        </div>
      </form>

      <section className="card search-results-panel">
        <div className="search-results-head">
          <div>
            <h3>결과 목록</h3>
            <p className="muted">
              {loading
                ? "조건을 반영해 목록을 갱신하는 중입니다."
                : `${totalCount.toLocaleString("ko-KR")}건 중 ${items.length.toLocaleString("ko-KR")}건을 현재 페이지에 표시합니다.`}
            </p>
          </div>
          <div className="search-pager">
            <span className="search-pager-info">페이지 {page}{totalPages > 0 ? ` / ${totalPages}` : ""}</span>
            <div className="search-pager-actions">
              <button
                type="button"
                className="pager-button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || loading}
              >
                이전
              </button>
              <button
                type="button"
                className="pager-button"
                onClick={() => setPage((current) => current + 1)}
                disabled={loading || items.length < Math.max(1, Number(submittedFilters.limit) || 40) || page >= totalPages}
              >
                다음
              </button>
            </div>
          </div>
        </div>

        <div className={`search-state-bar search-state-bar--${stateTone}`} aria-live="polite">
          <div className="search-state-copy">
            <strong>
              {stateTone === "loading" && "검색 조건을 반영하고 있습니다."}
              {stateTone === "error" && "매물 목록을 불러오지 못했습니다."}
              {stateTone === "empty" && "조건에 맞는 매물이 없습니다."}
              {stateTone === "success" && "현재 결과는 검토 가능한 상태입니다."}
            </strong>
            <span>
              {stateTone === "loading" && "현재 run과 필터 조합으로 최신 목록을 다시 조회합니다."}
              {stateTone === "error" && error}
              {stateTone === "empty" && "월세 상한 또는 최소 면적을 완화해 다음 후보를 확인하세요."}
              {stateTone === "success" && `주의 ${staleCount}건 · 이미지 확보 ${imageReadyCount}건 · 마지막 갱신 ${formatTimestamp(lastLoadedAt)}`}
            </span>
          </div>
          <div className="search-state-actions">
            {stateTone === "error" && (
              <button type="button" className="search-inline-button" onClick={() => runSearch(submittedFilters)}>
                다시 시도
              </button>
            )}
            {stateTone === "empty" && (
              <>
                <button type="button" className="search-inline-button" onClick={() => applySuggestion({ maxRent: String((Number(filters.maxRent) || 80) + 10) })}>
                  월세 상한 +10
                </button>
                <button type="button" className="search-inline-button" onClick={() => applySuggestion({ minArea: "" })}>
                  최소 면적 해제
                </button>
                <button type="button" className="search-inline-button" onClick={() => applySuggestion({ minFloor: "" })}>
                  층 조건 해제
                </button>
              </>
            )}
          </div>
        </div>

        <div className="listing-grid listing-grid--search">
          {loading && items.length === 0 && Array.from({ length: 4 }).map((_, index) => (
            <article key={`skeleton-${index}`} className="listing-card listing-card--search listing-card--skeleton" aria-hidden="true">
              <div className="listing-card-thumb" />
              <div className="listing-card-body">
                <div className="listing-card-skeleton-line listing-card-skeleton-line--short" />
                <div className="listing-card-skeleton-line" />
                <div className="listing-card-skeleton-line" />
                <div className="listing-card-skeleton-tags">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </article>
          ))}

          {!loading && items.length === 0 && (
            <div className="listing-empty listing-empty--search">
              <div className="listing-empty-icon">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none">
                  <path d="M10 3a7 7 0 105.2 11.8l4.5 4.5a1 1 0 001.4-1.4l-4.5-4.5A7 7 0 0010 3zm-5 7a5 5 0 1110 0 5 5 0 01-10 0z" fill="#d6d3d1" />
                </svg>
              </div>
              <p>조건에 맞는 후보가 없습니다.</p>
              <span className="muted">위의 완화 액션을 눌러 다음 탐색 범위를 바로 실행할 수 있습니다.</span>
            </div>
          )}

          {items.map((item) => (
            <ListingCard
              key={item.listing_id}
              item={item}
              variant="search"
              onClick={() => item.listing_id && loadDetail(item.listing_id)}
              isFavorite={isFavorite ? isFavorite(item.listing_id) : false}
              onToggleFavorite={toggleFavorite ? () => toggleFavorite(item.listing_id) : null}
              isLoadingDetail={loadingDetailId === toIdText(item.listing_id)}
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
          apiBase={apiBase}
        />
      )}
    </section>
  );
}
