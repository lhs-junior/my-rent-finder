// frontend/src/components/map/MapRightPanel.jsx
import { useState, useEffect, useRef } from "react";
import { toPlatformLabel, normalizeImageUrl, toArea } from "../../utils/format.js";
import { resolveExternalListingUrl } from "../../utils/listing-url.js";
import FavoriteButton from "../FavoriteButton.jsx";

export default function MapRightPanel({
  detailId,
  apiBase,
  onClose,
  isFavorite,
  toggleFavorite,
}) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef(null);

  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    if (controllerRef.current) controllerRef.current.abort();
    const ctrl = new AbortController();
    controllerRef.current = ctrl;
    setLoading(true);
    const base = (apiBase || "").replace(/\/$/, "");
    fetch(`${base}/api/listings/${encodeURIComponent(detailId)}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!ctrl.signal.aborted) setDetail(data?.listing || null); })
      .catch(() => {})
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [detailId, apiBase]);

  const open = Boolean(detailId);
  const externalUrl = detail ? resolveExternalListingUrl(detail) : null;
  const firstImg = detail?.images?.[0]?.source_url;

  return (
    <div className={`map-right-panel${open ? " map-right-panel--open" : ""}`}>
      <div className="map-right-header">
        <span className="map-right-title">매물 상세</span>
        <button type="button" className="map-right-close" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="map-right-body">
        {loading && <div className="map-right-loading">불러오는 중...</div>}
        {!loading && !detail && open && <div className="map-right-loading">정보 없음</div>}
        {detail && (
          <>
            {firstImg && (
              <div className="map-right-img">
                <img src={normalizeImageUrl(firstImg)} alt="" loading="lazy" />
              </div>
            )}
            <div className="map-right-content">
              <div className="map-right-platform">
                {toPlatformLabel(detail.platform_code || detail.platform || "")}
              </div>
              <div className="map-right-price">{detail.rent_amount != null ? `월 ${detail.rent_amount}만원` : "가격 미정"}</div>
              <div className="map-right-deposit">보증금 {detail.deposit_amount != null ? `${detail.deposit_amount}만원` : "-"}</div>
              <div className="map-right-addr">{detail.address_text || "-"}</div>
              <div className="map-right-tags">
                {detail.area_exclusive_m2 && <span>{toArea(detail.area_exclusive_m2)}</span>}
                {detail.floor != null && <span>{detail.floor}층{detail.total_floor ? `/${detail.total_floor}층` : ""}</span>}
                {detail.room_count && <span>{detail.room_count}룸</span>}
                {detail.building_use && <span>{detail.building_use}</span>}
              </div>
              {detail.title && <div className="map-right-desc">{detail.title}</div>}
              <div className="map-right-actions">
                {externalUrl && (
                  <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="map-right-btn map-right-btn--primary">
                    원본 보기 →
                  </a>
                )}
                {toggleFavorite && (
                  <FavoriteButton
                    active={typeof isFavorite === "function" ? isFavorite(detail.listing_id) : false}
                    onClick={() => toggleFavorite(detail.listing_id)}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
