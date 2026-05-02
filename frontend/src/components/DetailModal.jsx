import { useEffect, useRef, useState } from "react";
import { toMoney, toArea, toText, toPlatformLabel, normalizeImageUrl } from "../utils/format.js";
import { resolveExternalListingUrl } from "../utils/listing-url.js";
import FavoriteButton from "./FavoriteButton.jsx";
import { AffordabilityBadge } from "./AffordabilityBadge.jsx";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock.js";
import { useListingDetail } from "../hooks/useListingDetail.js";

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
  LISTING_EXPIRED: "매물 만료",
  STALE_SUSPECT: "업데이트 의심",
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

function FeaturesSection({ features }) {
  if (!features || typeof features !== "object") return null;

  const chipGroups = [
    { key: "options", label: "옵션" },
    { key: "safeties", label: "안전시설" },
    { key: "tags", label: "특징" },
  ];

  const scalarRows = [
    { key: "heating", label: "난방" },
    { key: "elevator", label: "승강기" },
    { key: "entrance", label: "현관" },
    { key: "households", label: "세대수" },
    { key: "balcony", label: "발코니" },
    { key: "built_in", label: "빌트인" },
    { key: "duplex", label: "복층" },
    { key: "moving_date", label: "입주" },
  ];

  const renderedChips = chipGroups
    .map(({ key, label }) => ({ key, label, items: Array.isArray(features[key]) ? features[key] : null }))
    .filter((g) => g.items && g.items.length > 0);

  const renderedScalars = scalarRows.filter((r) => typeof features[r.key] === "string" && features[r.key]);

  const parking = features.parking;
  const maintenance = features.maintenance;

  const hasContent =
    renderedChips.length > 0 || renderedScalars.length > 0 || parking || maintenance;
  if (!hasContent) return null;

  return (
    <div className="mdl-section">
      <h3 className="mdl-section-title">옵션·시설</h3>
      {renderedChips.map(({ key, label, items }) => (
        <div key={key} style={{ marginBottom: 10 }}>
          <p style={{ fontWeight: 600, marginBottom: 6, fontSize: "0.85rem", color: "var(--text-soft)" }}>{label}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {items.map((it, i) => (
              <span key={i} className="chip">{it}</span>
            ))}
          </div>
        </div>
      ))}
      {(renderedScalars.length > 0 || parking) && (
        <div className="mdl-info-grid" style={{ marginTop: 8 }}>
          {parking && (
            <div className="mdl-info-cell">
              <span className="mdl-info-label">주차</span>
              <span className="mdl-info-value">
                {parking.label || (parking.possible ? "가능" : "불가")}
                {parking.count != null ? ` (${parking.count}대)` : ""}
              </span>
            </div>
          )}
          {renderedScalars.map(({ key, label }) => (
            <div key={key} className="mdl-info-cell">
              <span className="mdl-info-label">{label}</span>
              <span className="mdl-info-value">{features[key]}</span>
            </div>
          ))}
        </div>
      )}
      {maintenance && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontWeight: 600, marginBottom: 6, fontSize: "0.85rem", color: "var(--text-soft)" }}>관리비</p>
          <div className="mdl-info-grid">
            {maintenance.cost_label && (
              <div className="mdl-info-cell">
                <span className="mdl-info-label">금액</span>
                <span className="mdl-info-value">{maintenance.cost_label}</span>
              </div>
            )}
            {maintenance.items && (
              <div className="mdl-info-cell">
                <span className="mdl-info-label">포함</span>
                <span className="mdl-info-value">{maintenance.items}</span>
              </div>
            )}
            {maintenance.month_total && (
              <div className="mdl-info-cell">
                <span className="mdl-info-label">월 총비용</span>
                <span className="mdl-info-value">{maintenance.month_total}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DetailModal({ detailId, onClose, onExpired, onOpenExternal, isFavorite, toggleFavorite, apiBase }) {
  const overlayRef = useRef(null);
  const galleryRef = useRef(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [cachedDetail, setCachedDetail] = useState(null);
  const [verifyStatus, setVerifyStatus] = useState({ checking: false, alive: null });

  const { detail, loading, error } = useListingDetail(detailId, apiBase);

  // detailId가 바뀌거나 닫힐 때 캐시 정리
  useEffect(() => {
    if (!detailId) setCachedDetail(null);
  }, [detailId]);

  // 로딩 깜빡임 방지를 위해 detail 도착 시 캐시에도 복제
  useEffect(() => {
    if (detail) {
      setCachedDetail(detail);
      if (detail.is_expired && onExpired) onExpired(detailId);
    }
  }, [detail, detailId, onExpired]);

  // detail 로드 실패(404 등 — cleanup race로 hard-delete된 매물) 시도 expired 처리해 카드 자동 제거.
  useEffect(() => {
    if (!error || !detailId || !onExpired) return;
    onExpired(detailId);
  }, [error, detailId, onExpired]);

  const displayDetail = detail || cachedDetail;
  const imageCount = Array.isArray(displayDetail?.images) ? displayDetail.images.length : 0;
  const hasImages = imageCount > 0;
  const modalOpen = Boolean(detailId);

  useBodyScrollLock(modalOpen);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === "Escape") {
        if (lightbox) { setLightbox(false); return; }
        onClose(); return;
      }
      if (hasImages) {
        if (e.key === "ArrowLeft") setImgIdx((prev) => Math.max(0, prev - 1));
        if (e.key === "ArrowRight") setImgIdx((prev) => Math.min(imageCount - 1, prev + 1));
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
    };
  }, [modalOpen, onClose, hasImages, imageCount, lightbox]);

  useEffect(() => { setImgIdx(0); }, [displayDetail?.listing_id]);

  // Auto-verify listings against source platform (zigbang, kbland)
  useEffect(() => {
    const platform = (displayDetail?.platform_code || displayDetail?.platform || "").toLowerCase();
    const listingId = displayDetail?.listing_id;
    const verifiable = ["zigbang", "kbland", "dabang"];
    if (!verifiable.includes(platform) || !listingId) {
      setVerifyStatus({ checking: false, alive: null });
      return;
    }
    setVerifyStatus({ checking: true, alive: null });
    const base = (typeof apiBase === "string" ? apiBase.trim() : "").replace(/\/$/, "");
    const controller = new AbortController();
    fetch(`${base}/api/listings/${listingId}/verify`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setVerifyStatus({ checking: false, alive: data.alive });
        else setVerifyStatus({ checking: false, alive: null });
      })
      .catch(() => setVerifyStatus({ checking: false, alive: null }));
    return () => controller.abort();
  }, [displayDetail?.listing_id, displayDetail?.platform_code, displayDetail?.platform, apiBase]);

  useEffect(() => {
    const el = galleryRef.current;
    if (!el) return;
    const item = el.children[imgIdx];
    if (item) item.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }, [imgIdx]);

  if (!modalOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  const externalUrl = displayDetail ? resolveExternalListingUrl(displayDetail) : null;

  const goPrev = (e) => { e.preventDefault(); e.stopPropagation(); setImgIdx((prev) => Math.max(0, prev - 1)); };
  const goNext = (e) => { e.preventDefault(); e.stopPropagation(); setImgIdx((prev) => Math.min(imageCount - 1, prev + 1)); };

  return (
    <>
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

        {!loading && !displayDetail && (
          <div className="mdl-loading">
            <p>매물 정보를 불러올 수 없습니다.</p>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
              삭제된 매물이거나 일시적인 오류입니다.
            </p>
            <button type="button" className="mdl-btn mdl-btn--ghost" style={{ marginTop: 16 }} onClick={onClose}>
              닫기
            </button>
          </div>
        )}

        {displayDetail && (
          <>
            {displayDetail.is_expired && (
              <div className="mdl-expired-banner">이 매물은 종료됐습니다</div>
            )}
            {hasImages && (
              <div className="mdl-gallery">
                <div className="mdl-gallery-scroll" ref={galleryRef}>
                  {displayDetail.images.map((img, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="mdl-gallery-item"
                      onClick={() => { setImgIdx(idx); setLightbox(true); }}
                      aria-label={`매물 이미지 ${idx + 1} 크게 보기`}
                    >
                      <img src={normalizeImageUrl(img.source_url)} alt={`매물 이미지 ${idx + 1}`} loading="lazy" />
                    </button>
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

            {verifyStatus.alive === false && (
              <div className="mdl-expired-banner">
                이 매물은 원본 사이트에서 거래 완료되었거나 삭제된 것으로 확인됩니다.
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
              {displayDetail.lease_type === "매매" && displayDetail.sale_price && (
                <div style={{ marginTop: 8 }}>
                  <AffordabilityBadge salePrice={displayDetail.sale_price} />
                </div>
              )}
            </div>

            <div className="mdl-metrics">
              {displayDetail.lease_type === "매매" ? (
                <>
                  <div className="mdl-metric">
                    <span className="mdl-metric-label">매매가</span>
                    <span className="mdl-metric-value">{displayDetail.sale_price != null ? (displayDetail.sale_price >= 10000 ? `${(displayDetail.sale_price / 10000).toFixed(1)}억` : `${displayDetail.sale_price.toLocaleString()}만`) : "-"}</span>
                  </div>
                  {displayDetail.loan_amount != null && (
                    <>
                      <div className="mdl-metric-sep" />
                      <div className="mdl-metric">
                        <span className="mdl-metric-label">융자금</span>
                        <span className="mdl-metric-value">{displayDetail.loan_amount >= 10000 ? `${(displayDetail.loan_amount / 10000).toFixed(1)}억` : `${displayDetail.loan_amount.toLocaleString()}만`}</span>
                      </div>
                    </>
                  )}
                  <div className="mdl-metric-sep" />
                  <div className="mdl-metric">
                    <span className="mdl-metric-label">전용면적</span>
                    <span className="mdl-metric-value">{toArea(displayDetail.area_exclusive_m2 || displayDetail.area_gross_m2)}</span>
                  </div>
                </>
              ) : (
                <>
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
                </>
              )}
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
                {displayDetail.building_year != null && (
                  <div className="mdl-info-cell">
                    <span className="mdl-info-label">건축연도</span>
                    <span className="mdl-info-value">{displayDetail.building_year}년</span>
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

            {displayDetail.features && (
              <FeaturesSection features={displayDetail.features} />
            )}

            {displayDetail.description_text && (
              <div className="mdl-section">
                <h3 className="mdl-section-title">상세 설명</h3>
                <p className="mdl-description-text">{displayDetail.description_text}</p>
              </div>
            )}

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
                  className={`mdl-btn ${verifyStatus.alive === false ? "mdl-btn--warn" : "mdl-btn--primary"}`}
                  disabled={verifyStatus.checking}
                  onClick={() => {
                    if (verifyStatus.alive === false) {
                      if (!window.confirm("이 매물은 원본 사이트에서 만료된 것으로 확인됩니다.\n그래도 원본 사이트로 이동하시겠습니까?")) return;
                    }
                    onOpenExternal ? onOpenExternal(displayDetail) : window.open(externalUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  {verifyStatus.checking ? "확인 중..." : verifyStatus.alive === false ? "원본 보기 (만료됨)" : "원본 보기"}
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

    {lightbox && hasImages && (
      <div className="map-lightbox" onClick={() => setLightbox(false)}>
        <img
          className="map-lightbox-img"
          src={normalizeImageUrl(displayDetail.images[imgIdx].source_url)}
          alt={`매물 이미지 ${imgIdx + 1}`}
          onClick={(e) => e.stopPropagation()}
        />
        <button className="map-lightbox-close" onClick={() => setLightbox(false)} aria-label="닫기">✕</button>
        {imageCount > 1 && (
          <>
            <button
              className="map-lightbox-btn map-lightbox-btn--prev"
              onClick={(e) => { e.stopPropagation(); setImgIdx((prev) => Math.max(0, prev - 1)); }}
              disabled={imgIdx === 0}
              aria-label="이전 이미지"
            >‹</button>
            <button
              className="map-lightbox-btn map-lightbox-btn--next"
              onClick={(e) => { e.stopPropagation(); setImgIdx((prev) => Math.min(imageCount - 1, prev + 1)); }}
              disabled={imgIdx === imageCount - 1}
              aria-label="다음 이미지"
            >›</button>
          </>
        )}
        <span className="map-lightbox-count">{imgIdx + 1} / {imageCount}</span>
      </div>
    )}
    </>
  );
}
