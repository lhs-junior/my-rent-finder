import { useState, useEffect, useRef } from "react";
import MapListingCard from "./MapListingCard.jsx";
import FavoriteButton from "../FavoriteButton.jsx";
import { toMoney, toArea, toText, toPlatformLabel } from "../../utils/format.js";
import { resolveExternalListingUrl } from "../../utils/listing-url.js";

const MONEY_SWAP_PLATFORMS = new Set(["dabang", "daangn"]);
const MONEY_SWAP_RENT_MIN = 500;
const MONEY_SWAP_DEPOSIT_MAX = 200;

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
    return { rent: rentAmount, deposit: depositAmount };
  }

  if (depositAmount > 0 && rentAmount > MONEY_SWAP_RENT_MIN && depositAmount <= MONEY_SWAP_DEPOSIT_MAX) {
    return { rent: depositAmount, deposit: rentAmount };
  }

  return { rent: rentAmount, deposit: depositAmount };
}

/* ---------------------------------------------------------------------------
 * Detail Modal — full overlay, reuses .mdl-* styles from ListingSearch
 * ------------------------------------------------------------------------- */

function MapDetailModal({ detail, loading, onClose, isFavorite, toggleFavorite }) {
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
    return () => document.removeEventListener("keydown", handleKey);
  }, [detail, loading, onClose, hasImages, imageCount]);

  useEffect(() => { setImgIdx(0); }, [detail?.listing_id]);

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
  const price = detail ? normalizeDisplayMoney(detail) : null;

  const goPrev = (e) => { e.preventDefault(); e.stopPropagation(); setImgIdx((prev) => Math.max(0, prev - 1)); };
  const goNext = (e) => { e.preventDefault(); e.stopPropagation(); setImgIdx((prev) => Math.min(imageCount - 1, prev + 1)); };

  return (
    <div className="mdl-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="mdl-panel">
        {/* Top bar: fav + close */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "8px 10px 0" }}>
          {detail && isFavorite && toggleFavorite && (
            <FavoriteButton
              active={isFavorite(detail.listing_id)}
              onClick={() => toggleFavorite(detail.listing_id)}
            />
          )}
          <button className="mdl-close" style={{ position: "static" }} onClick={onClose} aria-label="닫기">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {loading && !detail && (
          <div className="mdl-loading">
            <div className="mdl-spinner" />
            <p>매물 정보를 불러오는 중...</p>
          </div>
        )}

        {detail && (
          <>
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
                    <button className="mdl-gallery-nav mdl-gallery-nav--prev" onClick={goPrev} disabled={imgIdx === 0} aria-label="이전 이미지">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <button className="mdl-gallery-nav mdl-gallery-nav--next" onClick={goNext} disabled={imgIdx === imageCount - 1} aria-label="다음 이미지">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </>
                )}
                <span className="mdl-gallery-count">{imgIdx + 1} / {imageCount}</span>
              </div>
            )}

            <div className="mdl-header">
              <div className="mdl-badges">
                <span className="mdl-badge mdl-badge--platform">
                  {toPlatformLabel(detail.platform_code || "")}
                </span>
                <span className="mdl-badge">{detail.lease_type || "월세"}</span>
                <span className="mdl-id">#{detail.listing_id || "-"}</span>
              </div>
              <h2 className="mdl-title">{detail.title || detail.address_text || "-"}</h2>
              {detail.title && detail.address_text && (
                <p className="mdl-address">{detail.address_text}</p>
              )}
            </div>

            <div className="mdl-metrics">
              <div className="mdl-metric">
                <span className="mdl-metric-label">월세</span>
                <span className="mdl-metric-value">{price?.rent != null ? toMoney(price.rent) : "-"}</span>
              </div>
              <div className="mdl-metric-sep" />
              <div className="mdl-metric">
                <span className="mdl-metric-label">보증금</span>
                <span className="mdl-metric-value">{price?.deposit != null ? toMoney(price.deposit) : "-"}</span>
              </div>
              <div className="mdl-metric-sep" />
              <div className="mdl-metric">
                <span className="mdl-metric-label">전용면적</span>
                <span className="mdl-metric-value">{toArea(detail.area_exclusive_m2 || detail.area_gross_m2)}</span>
              </div>
            </div>

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

            {/* Price history */}
            {Array.isArray(detail.price_history) && detail.price_history.length > 0 && (
              <div className="mdl-section">
                <h3 className="mdl-section-title">가격 변동 이력</h3>
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
              </div>
            )}

            <div className="mdl-actions">
              {externalUrl && (
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mdl-btn mdl-btn--primary"
                >
                  원본 보기
                </a>
              )}
              {detail.source_url && !externalUrl && (
                <a
                  href={detail.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mdl-btn mdl-btn--outline"
                >
                  원본 링크
                </a>
              )}
              <button type="button" className="mdl-btn mdl-btn--ghost" onClick={onClose}>
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
 * MapSidePanel — listing list + modal detail
 * ------------------------------------------------------------------------- */

export default function MapSidePanel({
  markers,
  totalInBounds,
  loading,
  error,
  selectedId,
  detailId,
  onCardClick,
  onCloseDetail,
  apiBase,
  isFavorite,
  toggleFavorite,
}) {
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const detailRequestRef = useRef(0);
  const detailControllerRef = useRef(null);
  const listRef = useRef(null);

  /* Fetch detail only when detailId changes (not selectedId) */
  useEffect(() => {
    const normalizedId = detailId != null ? String(detailId) : null;
    const selectedMarker = normalizedId
      ? markers.find((item) => String(item?.listing_id) === normalizedId)
      : null;
    const normalizedApiBase = (typeof apiBase === "string" ? apiBase.trim() : "");
    const detailUrl = `${normalizedApiBase ? normalizedApiBase.replace(/\/$/, "") : ""}/api/listings/${encodeURIComponent(normalizedId || "")}`;

    if (!normalizedId) {
      setDetail(null);
      setDetailError("");
      setDetailLoading(false);
      detailRequestRef.current += 1;
      if (detailControllerRef.current) {
        detailControllerRef.current.abort();
        detailControllerRef.current = null;
      }
      return;
    }

    setDetail(selectedMarker || null);
    const requestId = ++detailRequestRef.current;
    if (detailControllerRef.current) {
      detailControllerRef.current.abort();
    }
    const controller = new AbortController();
    detailControllerRef.current = controller;

    setDetailLoading(true);
    setDetailError("");
    fetch(detailUrl, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (requestId !== detailRequestRef.current) return;
        if (!controller.signal.aborted) {
          if (data?.listing) {
            setDetail(data.listing);
          } else {
            if (!selectedMarker) setDetail(null);
            setDetailError("상세 조회 결과가 비어 있습니다.");
          }
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        if (requestId !== detailRequestRef.current || controller.signal.aborted) return;
        if (!selectedMarker) setDetail(null);
        setDetailError(`상세 조회 실패: ${String(err?.message || err)}`);
      })
      .finally(() => {
        if (requestId === detailRequestRef.current && !controller.signal.aborted) {
          setDetailLoading(false);
        }
      });

    return () => {
      if (detailControllerRef.current === controller) {
        detailControllerRef.current.abort();
        detailControllerRef.current = null;
      }
    };
  }, [detailId, markers, apiBase]);

  useEffect(() => {
    setPage(1);
  }, [markers.length]);

  useEffect(() => {
    if (!selectedId) return;
    const index = markers.findIndex((m) => String(m.listing_id) === String(selectedId));
    if (index === -1) return;
    const targetPage = Math.floor(index / pageSize) + 1;
    if (targetPage !== page) setPage(targetPage);
  }, [markers, selectedId, page]);

  /* Scroll selected card into view after page switch or selection change */
  useEffect(() => {
    if (!selectedId) return;
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(".map-card--selected");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [selectedId, page]);

  const totalPages = Math.max(1, Math.ceil(markers.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = markers.slice(pageStart, pageStart + pageSize);
  const showPagination = totalPages > 1;

  const gotoPage = (nextPage) => {
    if (nextPage < 1 || nextPage > totalPages) return;
    setPage(nextPage);
  };

  const rentItems = markers.filter(m => m.rent_amount != null && m.rent_amount > 0);
  const avgRent = rentItems.length
    ? Math.round(rentItems.reduce((s, m) => s + m.rent_amount, 0) / rentItems.length)
    : 0;
  const areaItems = markers.filter(m => m.area_m2 != null && m.area_m2 > 0);
  const avgArea = areaItems.length
    ? Math.round(areaItems.reduce((s, m) => s + m.area_m2, 0) / areaItems.length)
    : 0;

  const showModal = detailId && (detail || detailLoading);

  return (
    <div className="map-side">
      <div className="map-side-header">
        <h3>현재 영역 매물</h3>
        <span className="map-side-count">{totalInBounds}건</span>
      </div>

      {error && <div className="error-box">{error}</div>}
      {detailError && <div className="error-box">{detailError}</div>}

      <div className="map-side-list-wrap">
        <div className="map-side-list" ref={listRef}>
          {pageItems.map((m) => (
            <MapListingCard
              key={m.listing_id}
              marker={m}
              isSelected={String(m.listing_id) === String(selectedId)}
              onClick={() => onCardClick(m)}
              isFavorite={isFavorite ? isFavorite(m.listing_id) : false}
              onToggleFavorite={toggleFavorite ? () => toggleFavorite(m.listing_id) : null}
            />
          ))}
          {!loading && markers.length === 0 && (
            <div className="map-side-empty">
              이 영역에 매물이 없습니다.
              <br />
              <span className="muted">지도를 이동하거나 필터를 조정해보세요.</span>
            </div>
          )}
        </div>

        {showPagination && (
          <div className="map-side-pagination">
            <button
              type="button"
              className="map-side-page-btn"
              onClick={() => gotoPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              이전
            </button>
            <span className="map-side-page-status">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              className="map-side-page-btn"
              onClick={() => gotoPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
            >
              다음
            </button>
          </div>
        )}
      </div>

      <div className="map-side-summary">
        <span>영역 내 {totalInBounds}건</span>
        {avgRent > 0 && <span>평균 월세 {avgRent}만원</span>}
        {avgArea > 0 && <span>평균 면적 {avgArea}m²</span>}
      </div>

      {/* Detail modal overlay */}
      {showModal && (
        <MapDetailModal
          detail={detail}
          loading={detailLoading}
          onClose={onCloseDetail}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
        />
      )}
    </div>
  );
}
