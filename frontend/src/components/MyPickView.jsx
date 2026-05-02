import { useState, useEffect, useCallback, useMemo } from "react";
import { toPlatformLabel, PLATFORM_COLORS, toMoney } from "../utils/format.js";
import DetailModal from "./DetailModal.jsx";

const DARK_TEXT_PLATFORMS = new Set(["naver", "daangn"]);

const SORT_OPTIONS = [
  { v: "newest", l: "최신순" },
  { v: "rent",   l: "월세순" },
  { v: "score",  l: "점수순" },
];

const LAST_SEEN_KEY = "myPickLastSeenAt";

function readLastSeenAt() {
  try {
    const raw = localStorage.getItem(LAST_SEEN_KEY);
    if (!raw) return 0;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function writeLastSeenAt(ts) {
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(ts));
  } catch {
    // ignore
  }
}

function formatRelativeKr(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMs = Date.now() - t;
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

function platformBadgeStyle(platform) {
  return {
    background: PLATFORM_COLORS[platform] || "#6B7280",
    color: DARK_TEXT_PLATFORMS.has(platform) ? "#111110" : "#fff",
  };
}

function MyPickCard({ item, isUnseen, onOpenDetail }) {
  const platform = item.platform_code || "";
  const subwayBadge =
    item.nearest_subway_station && item.subway_distance_m != null
      ? `${item.nearest_subway_station}${item.nearest_subway_line ? `(${item.nearest_subway_line})` : ""} ${item.subway_walk_min ? `도보 ${item.subway_walk_min}분` : `${item.subway_distance_m}m`}`
      : null;
  const relTime = formatRelativeKr(item.created_at);

  return (
    <div className={`score-card${isUnseen ? " score-card--unseen" : ""}`}>
      {isUnseen && <span className="mypick-unseen-dot" aria-label="미열람 신규" />}
      <button
        type="button"
        className="listing-card-main"
        style={{ width: "100%", textAlign: "left" }}
        aria-label={`${item.address_text || "매물"} 상세 보기`}
        onClick={() => onOpenDetail(item.listing_id)}
      >
        <div className="listing-card-thumb">
          {item.first_image_url ? (
            <img src={item.first_image_url} alt="" loading="lazy" />
          ) : (
            <div className="listing-card-thumb-empty">
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="8.5" cy="10.5" r="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M21 17l-5-4-3 2.5L9 12l-6 5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </div>
          )}
          <span className="listing-card-badge" style={platformBadgeStyle(platform)}>
            {toPlatformLabel(platform)}
          </span>
        </div>

        <div className="listing-card-body">
          <div className="score-card-header" style={{ marginBottom: 4 }}>
            {isUnseen ? (
              <span className="listing-card-signal listing-card-signal--unseen" title="마지막 방문 이후 새로 등록">
                NEW
              </span>
            ) : item.is_new ? (
              <span className="listing-card-signal listing-card-signal--new" title="7일 이내 수집">
                신규
              </span>
            ) : null}
            {relTime && (
              <span className="listing-card-signal listing-card-signal--time" title={item.created_at || ""}>
                {relTime}
              </span>
            )}
            {item.lien_warning && (
              <span
                className="listing-card-signal listing-card-signal--warn"
                title="설명에 융자/근저당 언급 있음"
              >
                융자경고
              </span>
            )}
            {item.room_count_unknown && (
              <span className="listing-card-signal" title="방수 정보 미확인">
                방수미확인
              </span>
            )}
          </div>

          <div className="listing-card-rent">
            {item.rent_amount != null ? `${item.rent_amount}만원` : "가격 미정"}
          </div>
          <div className="listing-card-deposit">보증금 {toMoney(item.deposit_amount)}</div>

          <div className="listing-card-address">{item.address_text || "-"}</div>

          <div className="listing-card-meta">
            {item.area_m2 != null && (
              <span className="listing-card-tag">{item.area_m2.toFixed(1)}㎡</span>
            )}
            {item.floor != null && (
              <span className="listing-card-tag">{item.floor}층</span>
            )}
            {item.room_count != null && (
              <span className="listing-card-tag">{item.room_count}룸</span>
            )}
            {item.building_use && (
              <span className="listing-card-tag">{item.building_use}</span>
            )}
            {item.building_year != null && (
              <span className="listing-card-tag">{item.building_year}년</span>
            )}
          </div>

          {subwayBadge && (
            <div className="listing-card-subway">
              🚇 {subwayBadge}
            </div>
          )}
        </div>
      </button>
    </div>
  );
}

export default function MyPickView({ apiBase }) {
  const [listings, setListings] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [sort, setSort] = useState("newest");
  const [unseenOnly, setUnseenOnly] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState(() => readLastSeenAt());

  const normalizedApiBase = (typeof apiBase === "string" ? apiBase.trim() : "").replace(/\/$/, "");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`${normalizedApiBase}/api/listings/my-pick?sort=${sort}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setListings(data.listings || []);
        setTotal(data.total || 0);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [normalizedApiBase, sort]);

  const openDetail = useCallback((listingId) => {
    if (!listingId) return;
    setDetailId(String(listingId));
  }, []);

  const isItemUnseen = useCallback((item) => {
    if (!item.created_at) return false;
    const t = new Date(item.created_at).getTime();
    return Number.isFinite(t) && t > lastSeenAt;
  }, [lastSeenAt]);

  const unseenCount = useMemo(
    () => listings.reduce((acc, it) => acc + (isItemUnseen(it) ? 1 : 0), 0),
    [listings, isItemUnseen],
  );

  const visibleListings = useMemo(() => {
    let arr = listings;
    if (unseenOnly) arr = arr.filter(isItemUnseen);
    if (sort === "newest") {
      arr = [...arr].sort((a, b) => {
        const ua = isItemUnseen(a) ? 1 : 0;
        const ub = isItemUnseen(b) ? 1 : 0;
        if (ua !== ub) return ub - ua;
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
    }
    return arr;
  }, [listings, unseenOnly, sort, isItemUnseen]);

  const markAllSeen = useCallback(() => {
    const now = Date.now();
    writeLastSeenAt(now);
    setLastSeenAt(now);
    setUnseenOnly(false);
  }, []);

  const lastSeenLabel = useMemo(() => {
    if (!lastSeenAt) return "마지막 확인: 없음";
    const rel = formatRelativeKr(new Date(lastSeenAt).toISOString());
    return rel ? `마지막 확인: ${rel}` : "마지막 확인: -";
  }, [lastSeenAt]);

  if (loading && listings.length === 0) {
    return (
      <div className="fav-view">
        <div className="fav-loading">내 조건 매물 불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="fav-view">
      <div className="fav-header">
        <h2>내 조건</h2>
        <span className="fav-count">{total}건</span>
        <div className="mypick-sort-row">
          {SORT_OPTIONS.map(o => (
            <button
              key={o.v}
              type="button"
              className={`ls-chip${sort === o.v ? " ls-chip--active" : ""}`}
              onClick={() => setSort(o.v)}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>

      <div className="mypick-unseen-bar" role="status">
        {unseenCount > 0 ? (
          <>
            <span className="mypick-unseen-bar-icon" aria-hidden>🆕</span>
            <span className="mypick-unseen-bar-text">
              마지막 확인 이후 새 매물 <strong>{unseenCount}건</strong>
            </span>
            <button
              type="button"
              className={`ls-chip mypick-unseen-toggle${unseenOnly ? " ls-chip--active" : ""}`}
              onClick={() => setUnseenOnly((v) => !v)}
            >
              {unseenOnly ? "전체 보기" : "신규만"}
            </button>
            <button
              type="button"
              className="mypick-mark-seen"
              onClick={markAllSeen}
              title="현재 시점을 마지막 확인 시간으로 기록합니다"
            >
              모두 확인
            </button>
          </>
        ) : (
          <>
            <span className="mypick-unseen-bar-icon mypick-unseen-bar-icon--muted" aria-hidden>✓</span>
            <span className="mypick-unseen-bar-text mypick-unseen-bar-text--muted">
              새 매물 없음 · {lastSeenLabel}
            </span>
            {lastSeenAt > 0 && (
              <button
                type="button"
                className="mypick-mark-seen mypick-mark-seen--reset"
                onClick={() => {
                  writeLastSeenAt(0);
                  setLastSeenAt(0);
                }}
                title="마지막 확인 기록을 지워 다시 신규 표시를 봅니다"
              >
                기록 초기화
              </button>
            )}
          </>
        )}
      </div>

      <div className="fav-grade-filter" style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)" }}>
        월세 90만↓ · 방3개↑ · 14개역 1km이내 · 근린/업무시설 제외
      </div>

      {error && <div className="error-box">{error}</div>}

      {visibleListings.length === 0 && !loading && (
        <div className="fav-empty">
          <p>{unseenOnly ? "신규 매물이 없습니다." : "조건에 맞는 매물이 없습니다."}</p>
          <span className="muted">
            {unseenOnly ? "‘전체 보기’를 눌러 모든 매물을 확인하세요." : "수집 후 다시 확인해 주세요."}
          </span>
        </div>
      )}

      <div className="listing-grid">
        {visibleListings.map((item, idx) => (
          <MyPickCard
            key={item.listing_id ?? `mypick-${idx}`}
            item={item}
            isUnseen={isItemUnseen(item)}
            onOpenDetail={openDetail}
          />
        ))}
      </div>

      {detailId !== null && (
        <DetailModal
          detailId={detailId}
          onClose={() => setDetailId(null)}
          onOpenExternal={() => {}}
          apiBase={apiBase}
        />
      )}
    </div>
  );
}
