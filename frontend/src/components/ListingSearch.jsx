import { useCallback, useEffect, useRef, useState } from "react";
import { toMoney, toArea, toText, toIdText, toPlatformLabel, formatFloorDirectionUse, PLATFORM_OPTIONS, FLOOR_FILTER_OPTIONS } from "../utils/format.js";
import { fetchJson } from "../hooks/useApi.js";
import { resolveExternalListingUrl } from "../utils/listing-url.js";

const QUALITY_FLAG_LABELS = {
  missing_address: "주소 누락",
  missing_price: "가격 누락",
  missing_area: "면적 누락",
  missing_image: "이미지 누락",
  low_quality: "저품질",
  incomplete: "정보 불완전",
  duplicated: "중복 의심",
  price_outlier: "가격 이상치",
  area_outlier: "면적 이상치",
};

const VIOLATION_SEVERITY_CLASS = {
  error: "chip-danger",
  warn: "chip-warn",
  info: "chip-info",
};

function QualityFlags({ flags }) {
  if (!Array.isArray(flags) || flags.length === 0) {
    return <p className="muted">품질 플래그 없음</p>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {flags.map((flag, idx) => {
        const label = typeof flag === "string"
          ? (QUALITY_FLAG_LABELS[flag] || flag)
          : (QUALITY_FLAG_LABELS[flag?.code] || flag?.code || JSON.stringify(flag));
        return (
          <span key={idx} className="chip">{label}</span>
        );
      })}
    </div>
  );
}

function Violations({ violations }) {
  if (!Array.isArray(violations) || violations.length === 0) {
    return <p className="muted">위반 사항 없음</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {violations.map((v, idx) => {
        const severity = (typeof v === "object" ? v?.severity : null) || "info";
        const severityClass = VIOLATION_SEVERITY_CLASS[severity] || "chip";
        const message = typeof v === "string" ? v : (v?.message || v?.rule || JSON.stringify(v));
        const severityLabel = severity === "error" ? "오류" : severity === "warn" ? "경고" : "정보";
        return (
          <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className={`chip ${severityClass}`}>{severityLabel}</span>
            <span style={{ fontSize: "0.86rem" }}>{message}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Detail Modal — inspired by 네이버부동산 / 직방 detail panels
 * - Image gallery at top
 * - Prominent price metrics
 * - Organized info grid
 * - Escape / overlay-click to close
 * - Body scroll lock while open
 * ------------------------------------------------------------------------- */

function DetailModal({ detail, loading, onClose, onOpenExternal }) {
  const overlayRef = useRef(null);
  const galleryRef = useRef(null);
  const [imgIdx, setImgIdx] = useState(0);

  const imageCount = Array.isArray(detail?.images) ? detail.images.length : 0;
  const hasImages = imageCount > 0;

  useEffect(() => {
    if (!detail && !loading) return;
    const handleKey = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (hasImages) {
        if (e.key === "ArrowLeft") setImgIdx((prev) => Math.max(0, prev - 1));
        if (e.key === "ArrowRight") setImgIdx((prev) => Math.min(imageCount - 1, prev + 1));
      }
    };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [detail, loading, onClose, hasImages, imageCount]);

  // Reset image index when detail changes
  useEffect(() => { setImgIdx(0); }, [detail?.listing_id]);

  // Scroll gallery to current index
  useEffect(() => {
    const el = galleryRef.current;
    if (!el) return;
    const item = el.children[imgIdx];
    if (item) item.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }, [imgIdx]);

  if (!detail && !loading) return null;

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  const externalUrl = detail ? resolveExternalListingUrl(detail) : null;

  const goPrev = (e) => { e.preventDefault(); e.stopPropagation(); setImgIdx((prev) => Math.max(0, prev - 1)); };
  const goNext = (e) => { e.preventDefault(); e.stopPropagation(); setImgIdx((prev) => Math.min(imageCount - 1, prev + 1)); };

  return (
    <div className="mdl-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="mdl-panel">
        {/* Close button */}
        <button className="mdl-close" onClick={onClose} aria-label="닫기">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        {/* Loading state */}
        {loading && !detail && (
          <div className="mdl-loading">
            <div className="mdl-spinner" />
            <p>매물 정보를 불러오는 중...</p>
          </div>
        )}

        {detail && (
          <>
            {/* Image gallery with nav buttons */}
            {hasImages && (
              <div className="mdl-gallery">
                <div className="mdl-gallery-scroll" ref={galleryRef}>
                  {detail.images.map((img, idx) => (
                    <a
                      key={idx}
                      href={img.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mdl-gallery-item"
                    >
                      <img src={img.source_url} alt={`매물 이미지 ${idx + 1}`} loading="lazy" />
                    </a>
                  ))}
                </div>
                {imageCount > 1 && (
                  <>
                    <button
                      className="mdl-gallery-nav mdl-gallery-nav--prev"
                      onClick={goPrev}
                      disabled={imgIdx === 0}
                      aria-label="이전 이미지"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      className="mdl-gallery-nav mdl-gallery-nav--next"
                      onClick={goNext}
                      disabled={imgIdx === imageCount - 1}
                      aria-label="다음 이미지"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </>
                )}
                <span className="mdl-gallery-count">{imgIdx + 1} / {imageCount}</span>
              </div>
            )}

            {/* Header */}
            <div className="mdl-header">
              <div className="mdl-badges">
                <span className="mdl-badge mdl-badge--platform">
                  {toPlatformLabel(detail.platform_code || detail.platform || "")}
                </span>
                <span className="mdl-badge">{detail.lease_type || "월세"}</span>
                <span className="mdl-id">#{detail.listing_id || "-"}</span>
              </div>
              <h2 className="mdl-title">{detail.title || detail.address_text || "-"}</h2>
              {detail.title && detail.address_text && (
                <p className="mdl-address">{detail.address_text}</p>
              )}
            </div>

            {/* Key price metrics */}
            <div className="mdl-metrics">
              <div className="mdl-metric">
                <span className="mdl-metric-label">월세</span>
                <span className="mdl-metric-value">{toMoney(detail.rent_amount)}</span>
              </div>
              <div className="mdl-metric-sep" />
              <div className="mdl-metric">
                <span className="mdl-metric-label">보증금</span>
                <span className="mdl-metric-value">{toMoney(detail.deposit_amount)}</span>
              </div>
              <div className="mdl-metric-sep" />
              <div className="mdl-metric">
                <span className="mdl-metric-label">전용면적</span>
                <span className="mdl-metric-value">{toArea(detail.area_exclusive_m2 || detail.area_gross_m2)}</span>
              </div>
            </div>

            {/* Info grid */}
            <div className="mdl-section">
              <h3 className="mdl-section-title">상세 정보</h3>
              <div className="mdl-info-grid">
                <div className="mdl-info-cell">
                  <span className="mdl-info-label">층수</span>
                  <span className="mdl-info-value">
                    {detail.floor ?? "-"}층{detail.total_floor ? ` / ${detail.total_floor}층` : ""}
                  </span>
                </div>
                <div className="mdl-info-cell">
                  <span className="mdl-info-label">방향</span>
                  <span className="mdl-info-value">{toText(detail.direction, "-")}</span>
                </div>
                <div className="mdl-info-cell">
                  <span className="mdl-info-label">용도</span>
                  <span className="mdl-info-value">{toText(detail.building_use, "-")}</span>
                </div>
                <div className="mdl-info-cell">
                  <span className="mdl-info-label">방</span>
                  <span className="mdl-info-value">{detail.room_count ?? "-"}개</span>
                </div>
                <div className="mdl-info-cell">
                  <span className="mdl-info-label">욕실</span>
                  <span className="mdl-info-value">{detail.bathroom_count ?? "-"}개</span>
                </div>
                {detail.building_name && (
                  <div className="mdl-info-cell">
                    <span className="mdl-info-label">건물명</span>
                    <span className="mdl-info-value">{detail.building_name}</span>
                  </div>
                )}
                {detail.agent_name && (
                  <div className="mdl-info-cell mdl-info-cell--wide">
                    <span className="mdl-info-label">중개사</span>
                    <span className="mdl-info-value">
                      {detail.agent_name}{detail.agent_phone ? ` (${detail.agent_phone})` : ""}
                    </span>
                  </div>
                )}
                {detail.available_date && (
                  <div className="mdl-info-cell">
                    <span className="mdl-info-label">입주가능</span>
                    <span className="mdl-info-value">{detail.available_date}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Quality & violations */}
            <div className="mdl-section">
              <h3 className="mdl-section-title">품질 검사</h3>
              <QualityFlags flags={detail.quality_flags} />
              {Array.isArray(detail.violations) && detail.violations.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontWeight: 600, marginBottom: 6, fontSize: "0.85rem", color: "var(--text-soft)" }}>위반 사항</p>
                  <Violations violations={detail.violations} />
                </div>
              )}
            </div>

            {/* Price history */}
            <div className="mdl-section">
              <h3 className="mdl-section-title">가격 변동 이력</h3>
              {Array.isArray(detail.price_history) && detail.price_history.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th>이전월세</th>
                        <th>변경월세</th>
                        <th>이전보증금</th>
                        <th>변경보증금</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.price_history.map((h, idx) => (
                        <tr key={h.history_id || idx}>
                          <td>{h.detected_at ? new Date(h.detected_at).toLocaleString("ko-KR") : "-"}</td>
                          <td>{toMoney(h.previous_rent)}</td>
                          <td>{toMoney(h.rent_amount)}</td>
                          <td>{toMoney(h.previous_deposit)}</td>
                          <td>{toMoney(h.deposit_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">가격 변동 이력 없음</p>
              )}
            </div>

            {/* Action bar */}
            <div className="mdl-actions">
              {externalUrl && (
                <button
                  type="button"
                  className="mdl-btn mdl-btn--primary"
                  onClick={() => onOpenExternal(detail)}
                >
                  원본 보기
                </button>
              )}
              {detail.source_url && (
                <a
                  href={detail.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mdl-btn mdl-btn--outline"
                >
                  원본 링크
                </a>
              )}
              <button
                type="button"
                className="mdl-btn mdl-btn--ghost"
                onClick={onClose}
              >
                닫기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * ListingSearch — main component
 * ------------------------------------------------------------------------- */

export default function ListingSearch({ apiBase, runId }) {
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
      setError(`목록 조회 실패: ${String(err?.message || err)}`);
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

  return (
    <section className="view-shell">
      <header className="section-head">
        <h2>매물 조회</h2>
        <p>DB 실데이터 기준 조건 검색 → 상세 정보 조회</p>
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
            페이지 {page}{totalCount > 0 ? ` / ${Math.ceil(totalCount / limit)}` : ""}
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
              disabled={loading || items.length < limit || page >= Math.ceil(totalCount / limit)}
            >
              다음
            </button>
          </div>
          <span className="pager-note">
            {loading ? "조회 중..." : `${totalCount.toLocaleString("ko-KR")}건 중 ${items.length}건 표시`}
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>매물ID</th>
                <th>플랫폼</th>
                <th>주소</th>
                <th>월세/보증금</th>
                <th>면적</th>
                <th>층/방향/용도</th>
                <th>이미지</th>
                <th>액션</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan="8">
                    <span className="muted">{loading ? "조회 중..." : "검색 결과가 없습니다."}</span>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.listing_id}>
                    <td className="mono">{item.listing_id || "-"}</td>
                    <td>
                      <span className="chip">{toPlatformLabel(item.platform_code || item.platform || "")}</span>
                      {item.is_stale === true && <span className="chip chip-warn">만료의심</span>}
                    </td>
                    <td>{item.address_text || "-"}</td>
                    <td>
                      월세 {toMoney(item.rent_amount)} / 보증금 {toMoney(item.deposit_amount)}
                    </td>
                    <td>{toArea(item.area_exclusive_m2 || item.area_gross_m2)}</td>
                    <td>{formatFloorDirectionUse(item)}</td>
                    <td>{item.image_count || 0}</td>
                    <td>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => item.listing_id && loadDetail(item.listing_id)}
                        disabled={!item.listing_id || (loadingDetailId !== null && String(loadingDetailId) === String(item.listing_id))}
                        aria-label={`listing-detail-${item.listing_id || "unknown"}`}
                      >
                        {loadingDetailId !== null && String(loadingDetailId) === String(item.listing_id) ? "조회중..." : "상세"}
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => openExternalUrl(item)}
                        disabled={!resolveExternalListingUrl(item)}
                      >
                        열기
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Detail modal */}
      {modalOpen && (
        <DetailModal
          detail={detail}
          loading={loadingDetail}
          onClose={closeDetail}
          onOpenExternal={openExternalUrl}
        />
      )}
    </section>
  );
}
