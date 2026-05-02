import { useCallback, useEffect, useMemo, useState } from "react";
import { PLATFORM_OPTIONS, FLOOR_FILTER_OPTIONS, toIdText } from "../utils/format.js";
import { fetchJson } from "../hooks/useApi.js";
import { resolveExternalListingUrl } from "../utils/listing-url.js";
import ListingCard from "./ListingCard.jsx";
import DetailModal from "./DetailModal.jsx";

const MY_PICK_LAST_SEEN_KEY = "myPickLastSeenAt";
const MY_PICK_SEEN_IDS_KEY = "myPickSeenIds";

function readMyPickLastSeenAt() {
  try {
    const raw = localStorage.getItem(MY_PICK_LAST_SEEN_KEY);
    if (!raw) return 0;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function writeMyPickLastSeenAt(ts) {
  try {
    localStorage.setItem(MY_PICK_LAST_SEEN_KEY, String(ts));
  } catch {
    // ignore
  }
}

function readMyPickSeenIds() {
  try {
    const raw = localStorage.getItem(MY_PICK_SEEN_IDS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeMyPickSeenIds(set) {
  try {
    localStorage.setItem(MY_PICK_SEEN_IDS_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

function formatRelativeKr(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "방금";
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}주 전`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}개월 전`;
  return `${Math.floor(day / 365)}년 전`;
}

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
  sort: "",
  maxSubwayM: "",
  limit: "40",
};

const SUBWAY_DISTANCE_OPTIONS = [
  { v: "", l: "전체" },
  { v: "500", l: "500m" },
  { v: "1000", l: "1km" },
  { v: "2000", l: "2km" },
];

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
  const [detailId, setDetailId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState("");
  const [searchToken, setSearchToken] = useState(0);
  const [gradeFilter, setGradeFilter] = useState(""); // "", "SS", "S", "A"
  const [myPickMode, setMyPickMode] = useState(false);
  const [myPickLastSeenAt, setMyPickLastSeenAt] = useState(() => readMyPickLastSeenAt());
  const [myPickSeenIds, setMyPickSeenIds] = useState(() => readMyPickSeenIds());
  const [myPickUnseenOnly, setMyPickUnseenOnly] = useState(false);

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
    if (targetFilters.sort) params.set("sort", targetFilters.sort);
    if (targetFilters.maxSubwayM) params.set("max_subway_m", targetFilters.maxSubwayM);
    if (gradeFilter) params.set("grade", gradeFilter);
    return params.toString();
  }, [page, runId, submittedFilters, favoriteIds, gradeFilter]);

  const loadListings = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const query = buildQuery();
      const endpoint = myPickMode
        ? `${apiBase}/api/listings/my-pick?${query}`
        : `${apiBase}/api/listings?${query}`;
      const payload = await fetchJson(endpoint);
      if (payload?.error) throw new Error(`API 오류: ${payload.message || "요청 실패"}`);
      setItems(Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.listings) ? payload.listings : []);
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
  }, [apiBase, buildQuery, myPickMode]);

  const openDetail = useCallback((listingId) => {
    const normalizedId = toIdText(listingId);
    if (!normalizedId) return;
    setDetailId(normalizedId);
    // 내 조건 모드에서 카드를 한 번 클릭하면 그 매물의 NEW 표시는 사라짐
    if (myPickMode) {
      setMyPickSeenIds((prev) => {
        if (prev.has(normalizedId)) return prev;
        const next = new Set(prev);
        next.add(normalizedId);
        writeMyPickSeenIds(next);
        return next;
      });
    }
  }, [myPickMode]);

  const openExternalUrl = useCallback((listing) => {
    const url = resolveExternalListingUrl(listing);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const closeDetail = useCallback(() => {
    setDetailId(null);
  }, []);

  const handleExpired = useCallback((expiredId) => {
    setItems(prev => prev.filter(item => String(item.listing_id) !== String(expiredId)));
    setTotalCount(prev => Math.max(0, prev - 1));
  }, []);

  const runSearch = useCallback((nextFilters) => {
    const validation = validateFilters(nextFilters);
    setFormErrors(validation);
    if (Object.keys(validation).length > 0) return false;
    setSubmittedFilters(nextFilters);
    setPage(1);
    setSearchToken(t => t + 1);
    setDetailId(null);
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
    setDetailId(null);
    setPage(1);
    setGradeFilter("");
    setMyPickMode(false);
    setSearchToken(t => t + 1);
  }, []);

  useEffect(() => { loadListings(); }, [loadListings, searchToken]);

  // gradeFilter 또는 myPickMode 변경 시 자동 재조회
  useEffect(() => {
    setPage(1);
    setSearchToken(t => t + 1);
  }, [gradeFilter, myPickMode]);

  const isItemUnseen = useCallback((item) => {
    if (!item || !item.created_at) return false;
    const t = new Date(item.created_at).getTime();
    if (!(Number.isFinite(t) && t > myPickLastSeenAt)) return false;
    return !myPickSeenIds.has(String(item.listing_id));
  }, [myPickLastSeenAt, myPickSeenIds]);

  const myPickUnseenCount = useMemo(() => {
    if (!myPickMode) return 0;
    return items.reduce((acc, it) => acc + (isItemUnseen(it) ? 1 : 0), 0);
  }, [myPickMode, items, isItemUnseen]);

  const visibleItems = useMemo(() => {
    if (!myPickMode) return items;
    if (myPickUnseenOnly) return items.filter(isItemUnseen);
    // 정렬은 서버 응답(sort 옵션)을 그대로 사용. NEW는 시각 표시로만 강조.
    return items;
  }, [myPickMode, items, myPickUnseenOnly, isItemUnseen]);

  const markAllMyPickSeen = useCallback(() => {
    const now = Date.now();
    writeMyPickLastSeenAt(now);
    setMyPickLastSeenAt(now);
    writeMyPickSeenIds(new Set());
    setMyPickSeenIds(new Set());
    setMyPickUnseenOnly(false);
  }, []);

  const resetMyPickSeen = useCallback(() => {
    writeMyPickLastSeenAt(0);
    setMyPickLastSeenAt(0);
    writeMyPickSeenIds(new Set());
    setMyPickSeenIds(new Set());
  }, []);

  const myPickLastSeenLabel = useMemo(() => {
    if (!myPickLastSeenAt) return "마지막 확인: 없음";
    const rel = formatRelativeKr(myPickLastSeenAt);
    return rel ? `마지막 확인: ${rel}` : "마지막 확인: -";
  }, [myPickLastSeenAt]);

  const modalOpen = detailId !== null;
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
        {/* 등급 필터 */}
        <div className="grade-filter-row">
          {["", "SS", "S", "A"].map(g => (
            <button
              key={g || "all"}
              type="button"
              className={`grade-btn${gradeFilter === g && !myPickMode ? " grade-btn--active" : ""}${g ? ` grade-btn--${g.toLowerCase()}` : ""}`}
              onClick={() => { setGradeFilter(g); setMyPickMode(false); }}
            >
              {g || "전체"}
            </button>
          ))}
          <button
            type="button"
            className={`grade-btn grade-btn--mypick${myPickMode ? " grade-btn--active" : ""}`}
            onClick={() => { setMyPickMode(m => !m); setGradeFilter(""); }}
          >
            내 조건
          </button>
        </div>

        {/* 플랫폼 */}
        <div className={`ls-filter-row ls-filter-row--platform${myPickMode ? " ls-filter-row--disabled" : ""}`}>
          {PLATFORM_OPTIONS.map(o => (
            <button
              key={o.value || "__all__"}
              type="button"
              className={`ls-chip${filters.platformCode === o.value ? " ls-chip--active" : ""}`}
              onClick={() => set("platformCode", o.value)}
              disabled={myPickMode}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* 주요 필터 */}
        <div className={`ls-filter-row ls-filter-row--main${myPickMode ? " ls-filter-row--disabled" : ""}`}>
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

          {/* 역세권 */}
          <div className="ls-field">
            <span className="ls-field-label">역세권</span>
            <div className="ls-chip-group">
              {SUBWAY_DISTANCE_OPTIONS.map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  className={`ls-chip${(filters.maxSubwayM || "") === opt.v ? " ls-chip--active" : ""}`}
                  onClick={() => set("maxSubwayM", opt.v)}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>

          {/* 정렬 — myPickMode에서도 활성 상태 유지, 클릭 즉시 재조회 */}
          <div className="ls-field ls-field--always-enabled">
            <span className="ls-field-label">정렬</span>
            <div className="ls-chip-group">
              {(myPickMode
                ? [{ v: "newest", l: "최신순" }, { v: "rent", l: "월세 낮은순" }, { v: "score", l: "점수 높은순" }]
                : [{ v: "", l: "수집순" }, { v: "newest", l: "최신순" }]
              ).map(opt => {
                const cur = filters.sort || (myPickMode ? "newest" : "");
                return (
                  <button
                    key={opt.v}
                    type="button"
                    className={`ls-chip${cur === opt.v ? " ls-chip--active" : ""}`}
                    onClick={() => {
                      const next = { ...filters, sort: opt.v };
                      setFilters(next);
                      setSubmittedFilters(next);
                      setPage(1);
                      setSearchToken(t => t + 1);
                    }}
                  >
                    {opt.l}
                  </button>
                );
              })}
            </div>
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

      {/* 내 조건: 미열람 신규 알림 바 */}
      {myPickMode && (
        <div className="mypick-unseen-bar" role="status">
          {myPickUnseenCount > 0 ? (
            <>
              <span className="mypick-unseen-bar-icon" aria-hidden>🆕</span>
              <span className="mypick-unseen-bar-text">
                마지막 확인 이후 새 매물 <strong>{myPickUnseenCount}건</strong>
              </span>
              <button
                type="button"
                className={`ls-chip mypick-unseen-toggle${myPickUnseenOnly ? " ls-chip--active" : ""}`}
                onClick={() => setMyPickUnseenOnly((v) => !v)}
              >
                {myPickUnseenOnly ? "전체 보기" : "신규만"}
              </button>
              <button
                type="button"
                className="mypick-mark-seen"
                onClick={markAllMyPickSeen}
                title="현재 시점을 마지막 확인 시간으로 기록합니다"
              >
                모두 확인
              </button>
            </>
          ) : (
            <>
              <span className="mypick-unseen-bar-icon mypick-unseen-bar-icon--muted" aria-hidden>✓</span>
              <span className="mypick-unseen-bar-text mypick-unseen-bar-text--muted">
                새 매물 없음 · {myPickLastSeenLabel}
              </span>
              {myPickLastSeenAt > 0 && (
                <button
                  type="button"
                  className="mypick-mark-seen mypick-mark-seen--reset"
                  onClick={resetMyPickSeen}
                  title="마지막 확인 기록을 지워 다시 신규 표시를 봅니다"
                >
                  기록 초기화
                </button>
              )}
            </>
          )}
        </div>
      )}

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

        {visibleItems.map(item => {
          const unseen = myPickMode && isItemUnseen(item);
          const card = (
            <ListingCard
              key={item.listing_id}
              item={item}
              variant="search"
              onClick={() => item.listing_id && openDetail(item.listing_id)}
              isFavorite={isFavorite ? isFavorite(item.listing_id) : false}
              onToggleFavorite={toggleFavorite ? () => toggleFavorite(item.listing_id) : null}
              onViewOnMap={onViewOnMap}
              isLoadingDetail={detailId === toIdText(item.listing_id)}
            />
          );
          if (!unseen) return card;
          return (
            <div key={item.listing_id} className="mypick-card-wrap mypick-card-wrap--unseen">
              <span className="mypick-unseen-dot" aria-label="미열람 신규" />
              <span className="mypick-unseen-tag">NEW</span>
              {card}
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <DetailModal
          detailId={detailId}
          onClose={closeDetail}
          onExpired={handleExpired}
          onOpenExternal={openExternalUrl}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
          apiBase={apiBase}
        />
      )}
    </section>
  );
}
