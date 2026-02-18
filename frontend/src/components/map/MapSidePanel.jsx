import { useState, useEffect, useRef } from "react";
import MapListingCard from "./MapListingCard.jsx";
import DetailModal from "../DetailModal.jsx";

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
        <DetailModal
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
