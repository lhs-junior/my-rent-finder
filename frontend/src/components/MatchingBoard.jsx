import { useCallback, useEffect, useMemo, useState } from "react";
import { toMoney, toArea, toText, toIdText, toPlatformLabel, PLATFORM_OPTIONS } from "../utils/format.js";
import { fetchJson } from "../hooks/useApi.js";

const DEFAULT_FILTERS = {
  status: "ALL",
  platform: "ALL",
  address: "",
  listingId: "",
};

const STATUS_PRIORITY = {
  REVIEW_REQUIRED: 0,
  AUTO_MATCH: 1,
  DISTINCT: 2,
};

const STATUS_HELP = {
  REVIEW_REQUIRED: "우선 검토",
  AUTO_MATCH: "자동 신뢰군",
  DISTINCT: "별도 매물",
};

function toStatusTone(status) {
  if (status === "REVIEW_REQUIRED") return "chip-warn";
  if (status === "AUTO_MATCH") return "chip-success";
  if (status === "DISTINCT") return "chip-neutral";
  return "chip";
}

function summarizeReason(reason) {
  if (!reason || typeof reason !== "object") return [];
  return Object.entries(reason)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([key, value]) => `${key} ${value}`);
}

function PairCard({ pair, emphasized }) {
  const reasons = summarizeReason(pair.reason);

  return (
    <article className={`pair-card${emphasized ? " pair-card--priority" : ""}`}>
      <div className="pair-title">
        <span className={`chip ${toStatusTone(pair.status)}`}>{pair.status}</span>
        <span className="chip">점수 {pair.score}</span>
        <span className="pair-title-hint">{STATUS_HELP[pair.status] || "확인 필요"}</span>
      </div>
      <div className="pair-compare-grid">
        <section className="pair-compare-cell">
          <span className="pair-compare-label">{toPlatformLabel(pair.source?.platform)}</span>
          <strong className="pair-compare-title">{pair.source?.address || "-"}</strong>
          <span className="pair-compare-meta">
            월세 {toMoney(pair.source?.rent)} · 면적 {toArea(pair.source?.area_exclusive_m2)}
          </span>
        </section>
        <section className="pair-compare-cell">
          <span className="pair-compare-label">{toPlatformLabel(pair.target?.platform)}</span>
          <strong className="pair-compare-title">{pair.target?.address || "-"}</strong>
          <span className="pair-compare-meta">
            월세 {toMoney(pair.target?.rent)} · 면적 {toArea(pair.target?.area_exclusive_m2)}
          </span>
        </section>
      </div>
      {reasons.length > 0 && (
        <div className="pair-reason-row">
          {reasons.map((reason) => (
            <span key={reason} className="search-summary-chip">{reason}</span>
          ))}
        </div>
      )}
      <details>
        <summary className="chip">score breakdown</summary>
        <pre>{JSON.stringify(pair.reason || {}, null, 2)}</pre>
      </details>
    </article>
  );
}

function GroupCard({ group }) {
  const members = Array.isArray(group.members) ? group.members : [];

  return (
    <article className="pair-card">
      <div className="pair-title">
        <span className="chip">회원 {members.length || group.member_count || 0}개</span>
        <span className={`chip ${toStatusTone(group.canonical_status)}`}>{group.canonical_status || "-"}</span>
      </div>
      <div className="group-member-list">
        {members.length > 0 ? (
          members.map((member, index) => (
            <div key={`${member.platform}-${member.address}-${index}`} className="group-member-row">
              <span className="group-member-platform">{toPlatformLabel(member.platform)}</span>
              <span className="group-member-address">{member.address || "-"}</span>
              <span className="group-member-rent">{toMoney(member.rent || member?.source?.rent)}</span>
            </div>
          ))
        ) : (
          <p className="muted">구성원 없음</p>
        )}
      </div>
      <details>
        <summary className="chip">group reason</summary>
        <pre>{JSON.stringify(group, null, 2)}</pre>
      </details>
    </article>
  );
}

export default function MatchingBoard({ apiBase, runId }) {
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [pairs, setPairs] = useState([]);
  const [groups, setGroups] = useState([]);
  const [summary, setSummary] = useState({
    candidate_pairs: 0,
    auto_match: 0,
    review_required: 0,
    distinct: 0,
    merged_groups: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState("");
  const [searchToken, setSearchToken] = useState(0);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (runId.trim()) params.set("run_id", runId.trim());
    if (appliedFilters.status !== "ALL") params.set("status", appliedFilters.status);
    params.set("limit", "400");
    return params.toString();
  }, [appliedFilters.status, runId]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const payload = await fetchJson(`${apiBase}/api/matches?${query}`);
      if (payload?.error) {
        throw new Error(`API 오류(${payload.error}): ${payload.message || "요청 처리 실패"}`);
      }
      setSummary(payload?.summary || payload?.matching?.summary || {
        candidate_pairs: 0,
        auto_match: 0,
        review_required: 0,
        distinct: 0,
        merged_groups: 0,
      });
      setPairs(payload?.items || payload?.pairs || []);
      setGroups(payload?.groups || []);
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(`매칭 목록 로딩 실패: ${String(err?.message || err)}`);
      setPairs([]);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase, query]);

  useEffect(() => {
    load();
  }, [load, searchToken]);

  const filteredPairs = useMemo(() => {
    const platform = toText(appliedFilters.platform, "all").toLowerCase();
    const addr = toText(appliedFilters.address, "").toLowerCase();
    const listingId = toText(appliedFilters.listingId, "").toLowerCase();
    return pairs
      .filter((pair) => {
        if (platform !== "all") {
          const sourcePlatform = toText(pair.source?.platform, "").toLowerCase();
          const targetPlatform = toText(pair.target?.platform, "").toLowerCase();
          if (sourcePlatform !== platform && targetPlatform !== platform) {
            return false;
          }
        }
        if (addr) {
          const source = `${pair.source?.address || ""} ${pair.source?.sigungu || ""}`.toLowerCase();
          const target = `${pair.target?.address || ""} ${pair.target?.sigungu || ""}`.toLowerCase();
          if (!source.includes(addr) && !target.includes(addr)) {
            return false;
          }
        }
        if (listingId) {
          const sourceListingId = toIdText(pair.source_listing_id).toLowerCase();
          const targetListingId = toIdText(pair.target_listing_id).toLowerCase();
          if (!sourceListingId.includes(listingId) && !targetListingId.includes(listingId)) {
            return false;
          }
        }
        return true;
      })
      .sort((left, right) => {
        const leftPriority = STATUS_PRIORITY[left.status] ?? 99;
        const rightPriority = STATUS_PRIORITY[right.status] ?? 99;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return Number(right.score || 0) - Number(left.score || 0);
      });
  }, [appliedFilters.address, appliedFilters.listingId, appliedFilters.platform, pairs]);

  const filteredGroups = useMemo(() => {
    const platform = toText(appliedFilters.platform, "all").toLowerCase();
    const addr = toText(appliedFilters.address, "").toLowerCase();
    return groups.filter((group) => {
      const members = Array.isArray(group.members) ? group.members : [];
      if (platform !== "all") {
        const hasPlatform = members.some((member) => toText(member.platform, "").toLowerCase() === platform);
        if (!hasPlatform) return false;
      }
      if (addr) {
        const hasAddress = members.some((member) => toText(member.address, "").toLowerCase().includes(addr));
        if (!hasAddress) return false;
      }
      return true;
    });
  }, [appliedFilters.address, appliedFilters.platform, groups]);

  const reviewPairs = filteredPairs.filter((pair) => pair.status === "REVIEW_REQUIRED");
  const stateTone = error
    ? "error"
    : loading
      ? "loading"
      : filteredPairs.length === 0
        ? "empty"
        : "success";

  return (
    <section className="view-shell listing-search-page">
      <header className="section-head search-overview-panel">
        <div className="search-overview-copy">
          <span className="section-kicker">매칭 검토</span>
          <h2>매칭 후보 / 중복 탐색</h2>
          <p>
            REVIEW_REQUIRED 쌍을 먼저 드러내고, 왜 의심 후보인지 점수 근거와 비교 맥락을
            첫 화면에서 읽을 수 있게 정리합니다.
          </p>
        </div>
        <div className="search-proof-grid">
          <article className="search-proof-card">
            <span className="search-proof-label">우선 검토</span>
            <strong className="search-proof-value">{reviewPairs.length}건</strong>
            <span className="search-proof-meta">표시 중 REVIEW_REQUIRED</span>
          </article>
          <article className="search-proof-card">
            <span className="search-proof-label">자동 신뢰군</span>
            <strong className="search-proof-value">{summary.auto_match || 0}건</strong>
            <span className="search-proof-meta">AUTO_MATCH 요약</span>
          </article>
          <article className="search-proof-card">
            <span className="search-proof-label">매칭군</span>
            <strong className="search-proof-value">{filteredGroups.length}개</strong>
            <span className="search-proof-meta">최근 갱신 {lastLoadedAt ? new Date(lastLoadedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "기록 없음"}</span>
          </article>
        </div>
      </header>

      <form
        className="card search-form-panel"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedFilters(draftFilters);
          setSearchToken((current) => current + 1);
        }}
      >
        <div className="search-form-head">
          <div>
            <h3>검토 범위</h3>
            <p className="muted">상태 기준은 서버 조회, 플랫폼/주소/매물 ID는 현재 후보군 내부에서 좁힙니다.</p>
          </div>
          <div className="search-form-actions">
            <button type="submit" className="search-submit-button" disabled={loading}>조회</button>
            <button
              type="button"
              className="search-reset-button"
              onClick={() => {
                setDraftFilters(DEFAULT_FILTERS);
                setAppliedFilters(DEFAULT_FILTERS);
                setSearchToken((current) => current + 1);
              }}
            >
              기본값 복원
            </button>
          </div>
        </div>

        <div className="search-field-grid search-field-grid--matches">
          <label className="search-field" htmlFor="matches-status">
            <span className="search-field-label">매칭 상태</span>
            <select
              id="matches-status"
              className="search-select"
              value={draftFilters.status}
              onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="ALL">전체</option>
              <option value="AUTO_MATCH">AUTO_MATCH</option>
              <option value="REVIEW_REQUIRED">REVIEW_REQUIRED</option>
              <option value="DISTINCT">DISTINCT</option>
            </select>
          </label>
          <label className="search-field" htmlFor="matches-platform">
            <span className="search-field-label">플랫폼</span>
            <select
              id="matches-platform"
              className="search-select"
              value={draftFilters.platform}
              onChange={(event) => setDraftFilters((current) => ({ ...current, platform: event.target.value }))}
            >
              {PLATFORM_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value || "ALL"}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="search-field" htmlFor="matches-address">
            <span className="search-field-label">주소 검색</span>
            <input
              id="matches-address"
              className="search-input"
              value={draftFilters.address}
              onChange={(event) => setDraftFilters((current) => ({ ...current, address: event.target.value }))}
              placeholder="예: 성수동"
            />
          </label>
          <label className="search-field" htmlFor="matches-listing-id">
            <span className="search-field-label">매물 ID 검색</span>
            <input
              id="matches-listing-id"
              className="search-input"
              value={draftFilters.listingId}
              onChange={(event) => setDraftFilters((current) => ({ ...current, listingId: event.target.value }))}
              placeholder="예: 12345"
            />
          </label>
        </div>

        <div className="search-chip-list" aria-label="적용된 검토 조건">
          <span className="search-summary-chip">{draftFilters.status === "ALL" ? "전체 상태" : draftFilters.status}</span>
          <span className="search-summary-chip">{draftFilters.platform === "ALL" ? "플랫폼 전체" : draftFilters.platform}</span>
          {draftFilters.address && <span className="search-summary-chip">주소 {draftFilters.address}</span>}
          {draftFilters.listingId && <span className="search-summary-chip">ID {draftFilters.listingId}</span>}
        </div>
      </form>

      <section className="card search-results-panel">
        <div className="search-results-head">
          <div>
            <h3>검토 상태</h3>
            <p className="muted">총 {filteredPairs.length}개 후보쌍, {filteredGroups.length}개 군집을 현재 조건으로 표시합니다.</p>
          </div>
        </div>

        <div className={`search-state-bar search-state-bar--${stateTone}`} aria-live="polite">
          <div className="search-state-copy">
            <strong>
              {stateTone === "loading" && "매칭 후보를 다시 불러오는 중입니다."}
              {stateTone === "error" && "매칭 후보를 불러오지 못했습니다."}
              {stateTone === "empty" && "현재 조건에 맞는 후보가 없습니다."}
              {stateTone === "success" && (reviewPairs.length > 0 ? "REVIEW_REQUIRED부터 확인하세요." : "현재 조건에는 검토 우선 후보가 없습니다.")}
            </strong>
            <span>
              {stateTone === "loading" && "run 기준 후보쌍과 군집을 다시 집계합니다."}
              {stateTone === "error" && error}
              {stateTone === "empty" && "상태를 전체로 넓히거나 플랫폼/주소 필터를 완화하세요."}
              {stateTone === "success" && `AUTO ${summary.auto_match || 0} · REVIEW ${summary.review_required || 0} · DISTINCT ${summary.distinct || 0}`}
            </span>
          </div>
          <div className="search-state-actions">
            {stateTone === "error" && (
              <button type="button" className="search-inline-button" onClick={() => setSearchToken((current) => current + 1)}>
                다시 시도
              </button>
            )}
          </div>
        </div>

        <div className="matching-priority-panel">
          <div className="matching-priority-head">
            <div>
              <h3>지금 검토할 쌍</h3>
              <p className="muted">점수가 높고 REVIEW_REQUIRED인 후보를 먼저 배치합니다.</p>
            </div>
            <span className="search-summary-chip">{reviewPairs.length}건</span>
          </div>
          {reviewPairs.length === 0 ? (
            <div className="matching-empty-panel">
              <p>우선 검토 후보가 없습니다.</p>
              <span className="muted">상태를 전체로 바꾸면 AUTO_MATCH와 DISTINCT까지 함께 볼 수 있습니다.</span>
            </div>
          ) : (
            <div className="pair-list pair-list--priority">
              {reviewPairs.slice(0, 3).map((pair) => (
                <PairCard
                  key={`${pair.source_listing_id}-${pair.target_listing_id}-${pair.status}`}
                  pair={pair}
                  emphasized
                />
              ))}
            </div>
          )}
        </div>

        <section className="grid-2">
          <section className="card">
            <h3>전체 후보쌍 ({filteredPairs.length})</h3>
            <div className="pair-list">
              {filteredPairs.length === 0 ? (
                <p className="muted">표시할 후보가 없습니다.</p>
              ) : (
                filteredPairs.map((pair) => (
                  <PairCard key={`${pair.source_listing_id}-${pair.target_listing_id}-${pair.status}`} pair={pair} />
                ))
              )}
            </div>
          </section>

          <section className="card">
            <h3>군집 요약 ({filteredGroups.length})</h3>
            {filteredGroups.length === 0 ? (
              <p className="muted">군집은 후보가 충분할 때 생성됩니다.</p>
            ) : (
              <div className="pair-list">
                {filteredGroups.slice(0, 20).map((group) => (
                  <GroupCard
                    key={group.group_id || group.id || `${group.member_count}-${group.canonical_key}`}
                    group={group}
                  />
                ))}
              </div>
            )}
          </section>
        </section>
      </section>
    </section>
  );
}
