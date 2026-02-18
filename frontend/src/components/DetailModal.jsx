import { useEffect, useRef, useState } from "react";
import { toMoney, toArea, toText, toPlatformLabel, normalizeImageUrl } from "../utils/format.js";
import { resolveExternalListingUrl } from "../utils/listing-url.js";
import FavoriteButton from "./FavoriteButton.jsx";

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
        return <span key={idx} className="chip">{label}</span>;
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

export default function DetailModal({ detail, loading, onClose, onOpenExternal, isFavorite, toggleFavorite }) {
  const overlayRef = useRef(null);
  const galleryRef = useRef(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [cachedDetail, setCachedDetail] = useState(null);

  // Cache detail when it's available to prevent flickering during loading
  useEffect(() => {
    if (detail) {
      setCachedDetail(detail);
    }
  }, [detail]);

  // Use cached detail during loading to maintain UI continuity
  const displayDetail = detail || cachedDetail;
  const imageCount = Array.isArray(displayDetail?.images) ? displayDetail.images.length : 0;
  const hasImages = imageCount > 0;

  useEffect(() => {
    if (!displayDetail && !loading) return;
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
  }, [displayDetail, loading, onClose, hasImages, imageCount]);

  useEffect(() => { setImgIdx(0); }, [displayDetail?.listing_id]);

  useEffect(() => {
    const el = galleryRef.current;
    if (!el) return;
    const item = el.children[imgIdx];
    if (item) item.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }, [imgIdx]);

  if (!displayDetail && !loading) return null;

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  const externalUrl = displayDetail ? resolveExternalListingUrl(displayDetail) : null;

  const goPrev = (e) => { e.preventDefault(); e.stopPropagation(); setImgIdx((prev) => Math.max(0, prev - 1)); };
  const goNext = (e) => { e.preventDefault(); e.stopPropagation(); setImgIdx((prev) => Math.min(imageCount - 1, prev + 1)); };

  return (
    <div className="mdl-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="mdl-panel">
        {/* Top bar with fav + close */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, position: "absolute", top: 10, right: 10, zIndex: 10 }}>
          {displayDetail && isFavorite && toggleFavorite && (
            <FavoriteButton
              active={typeof isFavorite === "function" ? isFavorite(displayDetail.listing_id) : false}
              onClick={() => toggleFavorite(displayDetail.listing_id)}
            />
          )}
          <button className="mdl-close" style={{ position: "static" }} onClick={onClose} aria-label="닫기">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {loading && !displayDetail && (
          <div className="mdl-loading">
            <div className="mdl-spinner" />
            <p>매물 정보를 불러오는 중...</p>
          </div>
        )}

        {displayDetail && (
          <>
            {hasImages && (
              <div className="mdl-gallery">
                <div className="mdl-gallery-scroll" ref={galleryRef}>
                  {displayDetail.images.map((img, idx) => (
                    <a
                      key={idx}
                      href={img.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mdl-gallery-item"
                    >
                      <img src={normalizeImageUrl(img.source_url)} alt={`매물 이미지 ${idx + 1}`} loading="lazy" />
                    </a>
                  ))}
                </div>
                {imageCount > 1 && (
                  <>
                    <button className="mdl-gallery-nav mdl-gallery-nav--prev" onClick={goPrev} disabled={imgIdx === 0} aria-label="이전 이미지">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button className="mdl-gallery-nav mdl-gallery-nav--next" onClick={goNext} disabled={imgIdx === imageCount - 1} aria-label="다음 이미지">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </>
                )}
                <span className="mdl-gallery-count">{imgIdx + 1} / {imageCount}</span>
              </div>
            )}

            <div className="mdl-header">
              <div className="mdl-badges">
                <span className="mdl-badge mdl-badge--platform">
                  {toPlatformLabel(displayDetail.platform_code || displayDetail.platform || "")}
                </span>
                <span className="mdl-badge">{displayDetail.lease_type || "월세"}</span>
                <span className="mdl-id">#{displayDetail.listing_id || "-"}</span>
              </div>
              <h2 className="mdl-title">{displayDetail.title || displayDetail.address_text || "-"}</h2>
              {displayDetail.title && displayDetail.address_text && (
                <p className="mdl-address">{displayDetail.address_text}</p>
              )}
            </div>

            <div className="mdl-metrics">
              <div className="mdl-metric">
                <span className="mdl-metric-label">월세</span>
                <span className="mdl-metric-value">{toMoney(displayDetail.rent_amount)}</span>
              </div>
              <div className="mdl-metric-sep" />
              <div className="mdl-metric">
                <span className="mdl-metric-label">보증금</span>
                <span className="mdl-metric-value">{toMoney(displayDetail.deposit_amount)}</span>
              </div>
              <div className="mdl-metric-sep" />
              <div className="mdl-metric">
                <span className="mdl-metric-label">전용면적</span>
                <span className="mdl-metric-value">{toArea(displayDetail.area_exclusive_m2 || displayDetail.area_gross_m2)}</span>
              </div>
            </div>

            <div className="mdl-section">
              <h3 className="mdl-section-title">상세 정보</h3>
              <div className="mdl-info-grid">
                <div className="mdl-info-cell">
                  <span className="mdl-info-label">층수</span>
                  <span className="mdl-info-value">
                    {displayDetail.floor ?? "-"}층{displayDetail.total_floor ? ` / ${displayDetail.total_floor}층` : ""}
                  </span>
                </div>
                <div className="mdl-info-cell">
                  <span className="mdl-info-label">방향</span>
                  <span className="mdl-info-value">{toText(displayDetail.direction, "-")}</span>
                </div>
                <div className="mdl-info-cell">
                  <span className="mdl-info-label">용도</span>
                  <span className="mdl-info-value">{toText(displayDetail.building_use, "-")}</span>
                </div>
                <div className="mdl-info-cell">
                  <span className="mdl-info-label">방</span>
                  <span className="mdl-info-value">{displayDetail.room_count ?? "-"}개</span>
                </div>
                <div className="mdl-info-cell">
                  <span className="mdl-info-label">욕실</span>
                  <span className="mdl-info-value">{displayDetail.bathroom_count ?? "-"}개</span>
                </div>
                {displayDetail.building_name && (
                  <div className="mdl-info-cell">
                    <span className="mdl-info-label">건물명</span>
                    <span className="mdl-info-value">{displayDetail.building_name}</span>
                  </div>
                )}
                {displayDetail.agent_name && (
                  <div className="mdl-info-cell mdl-info-cell--wide">
                    <span className="mdl-info-label">중개사</span>
                    <span className="mdl-info-value">
                      {displayDetail.agent_name}{displayDetail.agent_phone ? ` (${displayDetail.agent_phone})` : ""}
                    </span>
                  </div>
                )}
                {displayDetail.available_date && (
                  <div className="mdl-info-cell">
                    <span className="mdl-info-label">입주가능</span>
                    <span className="mdl-info-value">{displayDetail.available_date}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="mdl-section">
              <h3 className="mdl-section-title">품질 검사</h3>
              <QualityFlags flags={displayDetail.quality_flags} />
              {Array.isArray(displayDetail.violations) && displayDetail.violations.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontWeight: 600, marginBottom: 6, fontSize: "0.85rem", color: "var(--text-soft)" }}>위반 사항</p>
                  <Violations violations={displayDetail.violations} />
                </div>
              )}
            </div>

            {Array.isArray(displayDetail.price_history) && displayDetail.price_history.length > 0 && (
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
                      {displayDetail.price_history.map((h, idx) => (
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
                <button
                  type="button"
                  className="mdl-btn mdl-btn--primary"
                  onClick={() => onOpenExternal ? onOpenExternal(detail) : window.open(externalUrl, "_blank", "noopener,noreferrer")}
                >
                  원본 보기
                </button>
              )}
              {displayDetail.source_url && !externalUrl && (
                <a
                  href={displayDetail.source_url}
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
