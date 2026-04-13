import { useState, useEffect, useCallback } from "react";
import { fetchJson } from "../hooks/useApi.js";
import { resolveExternalListingUrl } from "../utils/listing-url.js";
import ListingCard from "./ListingCard.jsx";
import DetailModal from "./DetailModal.jsx";

const GRADE_COLORS = { SS: "#dc2626", S: "#f59e0b", A: "#3b82f6", B: "#6b7280" };

function ScoreBadge({ grade, score }) {
  return (
    <span
      className="fav-grade-badge"
      style={{ background: GRADE_COLORS[grade] || "#6b7280", color: "#fff" }}
      title={`AI 배점 총점 ${score}/16점`}
    >
      {grade} · {score}점
    </span>
  );
}

function ScoreBreakdown({ scores }) {
  if (!scores) return null;
  const items = [
    { label: "가성비", value: scores.rpm, max: 4 },
    { label: "지하철", value: scores.subway, max: 3 },
    { label: "환승", value: scores.transfer, max: 3 },
    { label: "면적", value: scores.area, max: 2 },
    { label: "층수", value: scores.floor, max: 2 },
    { label: "연식", value: scores.year, max: 1 },
    { label: "사진", value: scores.img, max: 1 },
  ];
  return (
    <div className="score-breakdown">
      {items.map((i) => (
        <span key={i.label} className="score-breakdown-item" title={`${i.label} ${i.value}/${i.max}`}>
          <span className="score-breakdown-label">{i.label}</span>
          <span className={`score-breakdown-value${i.value === i.max ? " score-breakdown-value--max" : ""}`}>
            {i.value}/{i.max}
          </span>
        </span>
      ))}
    </div>
  );
}

function EffectiveCost({ rent, deposit, cost }) {
  if (!cost || !deposit) return null;
  return (
    <span className="score-effective-cost" title={`월세 ${rent}만 + 보증금 기회비용 → 실질 ${cost}만/월`}>
      실질 {cost}만/월
    </span>
  );
}

function sortItems(items, sortBy) {
  const copy = [...items];
  if (sortBy === "cost") {
    copy.sort((a, b) => {
      const ca = a.effective_monthly_cost ?? Infinity;
      const cb = b.effective_monthly_cost ?? Infinity;
      if (ca !== cb) return ca - cb;
      return (b.total_score ?? 0) - (a.total_score ?? 0);
    });
  } else {
    copy.sort((a, b) => {
      if ((b.total_score ?? 0) !== (a.total_score ?? 0)) return (b.total_score ?? 0) - (a.total_score ?? 0);
      const ca = a.effective_monthly_cost ?? Infinity;
      const cb = b.effective_monthly_cost ?? Infinity;
      return ca - cb;
    });
  }
  return copy;
}

export default function ScoresView({ apiBase, isFavorite, toggleFavorite, onViewOnMap }) {
  const [rawItems, setRawItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [gradeFilter, setGradeFilter] = useState("");
  const [sortBy, setSortBy] = useState("score");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const normalizedApiBase = (typeof apiBase === "string" ? apiBase.trim() : "").replace(/\/$/, "");

  // 서버에서는 grade 필터만 적용해서 한 번 fetch — 정렬은 클라이언트에서 즉시 처리
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const gradeParam = gradeFilter || "SS,S,A";
    fetch(`${normalizedApiBase}/api/scores?grade=${gradeParam}&limit=200`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`API error: ${r.status}`); return r.json(); })
      .then((data) => setRawItems(data.items || []))
      .catch((err) => { if (err.name !== "AbortError") setError(err.message); })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [normalizedApiBase, gradeFilter]);

  const items = sortItems(rawItems, sortBy);

  useEffect(() => {
    fetch(`${normalizedApiBase}/api/scores/summary`)
      .then((r) => r.json())
      .then((data) => setSummary(data))
      .catch(() => {});
  }, [normalizedApiBase]);

  const loadDetail = useCallback(async (listingId) => {
    if (!listingId) return;
    try {
      setDetailLoading(true);
      setDetail(null);
      const payload = await fetchJson(`${normalizedApiBase}/api/listings/${encodeURIComponent(listingId)}`);
      setDetail(payload?.listing || null);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [normalizedApiBase]);

  const openExternalUrl = useCallback((listing) => {
    const url = resolveExternalListingUrl(listing);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  if (loading && items.length === 0) {
    return <div className="fav-view"><div className="fav-loading">AI 추천 불러오는 중...</div></div>;
  }

  const modalOpen = detail !== null || detailLoading;

  return (
    <div className="fav-view">
      <div className="fav-header">
        <h2>AI 추천</h2>
        <span className="fav-count">
          {items.length}건
          {summary && <span className="fav-count-graded"> (전체 {summary.total}건)</span>}
        </span>
      </div>

      <div className="fav-grade-filter">
        {[
          { v: "", l: "SS+S+A" },
          { v: "SS", l: "SS" },
          { v: "S", l: "S" },
          { v: "A", l: "A" },
        ].map((opt) => (
          <button
            key={opt.v}
            type="button"
            className={`fav-grade-btn fav-grade-btn--${opt.v || "all"}${gradeFilter === opt.v ? " fav-grade-btn--active" : ""}`}
            onClick={() => setGradeFilter(opt.v)}
          >
            {opt.l}
            {summary && opt.v && summary.grades && (
              <span>({summary.grades.find((g) => g.grade === opt.v)?.count || 0})</span>
            )}
          </button>
        ))}
        <span className="score-sort-separator">|</span>
        <button
          type="button"
          className={`fav-grade-btn${sortBy === "score" ? " fav-grade-btn--active" : ""}`}
          onClick={() => setSortBy("score")}
        >
          점수순
        </button>
        <button
          type="button"
          className={`fav-grade-btn${sortBy === "cost" ? " fav-grade-btn--active" : ""}`}
          onClick={() => setSortBy("cost")}
        >
          실질비용순
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {items.length === 0 && !loading && (
        <div className="fav-empty">
          <p>AI 추천 매물이 없습니다.</p>
          <span className="muted">배점 스크립트를 실행하면 여기에 추천 매물이 표시됩니다.</span>
        </div>
      )}

      <div className="listing-grid">
        {items.map((item, idx) => (
          <div key={item.listing_id ?? `score-${idx}`} className="fav-card-wrapper">
            <ScoreBadge grade={item.grade} score={item.total_score} />
            {item.platform_code && (
              <span className="fav-platform-badge">
                {({ naver: "네이버", dabang: "다방", daangn: "당근", peterpanz: "피터팬", zigbang: "직방", kbland: "KB" })[item.platform_code] || item.platform_code}
              </span>
            )}
            <EffectiveCost rent={item.rent_amount} deposit={item.deposit_amount} cost={item.effective_monthly_cost} />
            <ScoreBreakdown scores={item.scores} />
            <ListingCard
              item={item}
              onClick={() => loadDetail(item.listing_id)}
              isFavorite={isFavorite?.(item.listing_id)}
              onToggleFavorite={toggleFavorite ? () => toggleFavorite(item.listing_id) : undefined}
              onViewOnMap={onViewOnMap}
            />
          </div>
        ))}
      </div>

      {modalOpen && (
        <DetailModal
          detail={detail}
          loading={detailLoading}
          onClose={() => { setDetail(null); setDetailLoading(false); }}
          onOpenExternal={openExternalUrl}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
          apiBase={apiBase}
        />
      )}
    </div>
  );
}
