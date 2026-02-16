import { useCallback, useEffect, useState } from "react";
import { toMoney, toArea, toText, toIdText, toPlatformLabel, formatFloorDirectionUse, PLATFORM_OPTIONS } from "../utils/format.js";
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

export default function ListingSearch({ apiBase, runId }) {
  const [platformCode, setPlatformCode] = useState("");
  const [address, setAddress] = useState("");
  const [minRent, setMinRent] = useState("0");
  const [maxRent, setMaxRent] = useState("80");
  const [minArea, setMinArea] = useState("");
  const [maxArea, setMaxArea] = useState("");
  const [limit, setLimit] = useState(40);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingDetailId, setLoadingDetailId] = useState(null);
  const [error, setError] = useState("");

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
    return params.toString();
  }, [address, limit, maxArea, maxRent, minArea, minRent, page, platformCode, runId]);

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
    } catch (err) {
      setError(`목록 조회 실패: ${String(err?.message || err)}`);
      setItems([]);
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

  return (
    <section className="view-shell">
      <header className="section-head">
        <h2>매물 조회</h2>
        <p>DB 실데이터 기준 조건 검색 → 상세 정보 조회</p>
        <div className="toolbar compact">
          <select value={platformCode} onChange={(event) => setPlatformCode(event.target.value)}>
            {PLATFORM_OPTIONS.map((option) => (
              <option key={option.value || "__all__"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="주소/동" />
          <input value={minRent} onChange={(event) => setMinRent(event.target.value)} placeholder="최저월세" />
          <input value={maxRent} onChange={(event) => setMaxRent(event.target.value)} placeholder="최고월세" />
          <input value={minArea} onChange={(event) => setMinArea(event.target.value)} placeholder="최소면적" />
          <input value={maxArea} onChange={(event) => setMaxArea(event.target.value)} placeholder="최대면적" />
          <select value={limit} onChange={(event) => setLimit(Math.max(1, Number(event.target.value) || 40))}>
            <option value={20}>20</option>
            <option value={40}>40</option>
            <option value={80}>80</option>
          </select>
          <button type="button" onClick={handleSearch}>조회</button>
          <button
            type="button"
            onClick={() => {
              setPlatformCode("");
              setAddress("");
              setMinRent("0");
              setMaxRent("80");
              setMinArea("");
              setMaxArea("");
              setError("");
              setDetail(null);
              setPage(1);
            }}
          >
            초기화
          </button>
        </div>
      </header>

      {error ? <p className="error-box">{error}</p> : null}

      <section className="card">
        <div className="pager">
          <span className="pager-info">페이지 {page}</span>
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
              disabled={loading || items.length < limit}
            >
              다음
            </button>
          </div>
          <span className="pager-note">
            {loading ? "조회 중..." : `${items.length}건 표시됨`}
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
                        {loadingDetailId !== null && String(loadingDetailId) === String(item.listing_id) ? "상세 조회중" : "상세"}
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

      <section className="card">
        <h3>매물 상세</h3>
        {detail ? (
              <div className="detail-grid">
                <div className="detail-block">
                  <p className="muted">매물 {detail.listing_id || "-"}</p>
                  <p>{toPlatformLabel(detail.platform_code || detail.platform || "")}</p>
                  <p>주소: {detail.address_text || "-"}</p>
                  <p>월세 {toMoney(detail.rent_amount)} / 보증금 {toMoney(detail.deposit_amount)}</p>
                  <p>면적 {toArea(detail.area_exclusive_m2 || detail.area_gross_m2)}</p>
                  <p>임대유형 {detail.lease_type || "-"}</p>
                  <p>
                    방/{detail.room_count || "-"} 욕/{detail.bathroom_count || "-"} 층/{detail.floor || "-"}
                    {detail.total_floor ? ` / 총${detail.total_floor}층` : ""}
                    {` / 방향 ${toText(detail.direction, "-")}`} / 용도 {toText(detail.building_use, "-")}
                  </p>
                </div>
            <div className="detail-block">
              <p style={{ fontWeight: 700, marginBottom: 6, marginTop: 0 }}>품질 플래그</p>
              <QualityFlags flags={detail.quality_flags} />
              <p style={{ fontWeight: 700, marginBottom: 6, marginTop: 10 }}>위반 사항</p>
              <Violations violations={detail.violations} />
            </div>
          </div>
        ) : (
          <p className="muted">
            {loadingDetail ? "상세를 불러오는 중..." : "목록의 매물을 선택해 주세요."}
          </p>
        )}
      </section>
    </section>
  );
}
