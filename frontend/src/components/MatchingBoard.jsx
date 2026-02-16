import { useCallback, useEffect, useMemo, useState } from "react";
import { toMoney, toArea, toText, toIdText, toPlatformLabel, PLATFORM_OPTIONS } from "../utils/format.js";
import { fetchJson } from "../hooks/useApi.js";

export default function MatchingBoard({ apiBase, runId }) {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [addressKeyword, setAddressKeyword] = useState("");
  const [platformFilter, setPlatformFilter] = useState("ALL");
  const [listingIdKeyword, setListingIdKeyword] = useState("");
  const [pairs, setPairs] = useState([]);
  const [groups, setGroups] = useState([]);
  const [summary, setSummary] = useState({
    candidate_pairs: 0,
    auto_match: 0,
    review_required: 0,
    distinct: 0,
    merged_groups: 0,
  });
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (runId.trim()) params.set("run_id", runId.trim());
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    params.set("limit", "400");
    return params.toString();
  }, [runId, statusFilter]);

  const load = useCallback(async () => {
    try {
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
      setError("");
    } catch (err) {
      setError(`매칭 목록 로딩 실패: ${String(err?.message || err)}`);
      setPairs([]);
      setGroups([]);
    }
  }, [apiBase, query]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredPairs = useMemo(() => {
    const platform = toText(platformFilter, "all").toLowerCase();
    const addr = toText(addressKeyword, "").toLowerCase();
    const listingId = toText(listingIdKeyword, "").toLowerCase();
    return pairs.filter((pair) => {
      if (platform !== "all") {
        const sourcePlatform = toText(pair.source?.platform, "").toLowerCase();
        const targetPlatform = toText(pair.target?.platform, "").toLowerCase();
        if (sourcePlatform !== platform.toLowerCase() && targetPlatform !== platform.toLowerCase()) {
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
        const sourceListingId = toIdText(pair.source_listing_id);
        const targetListingId = toIdText(pair.target_listing_id);
        if (
          !sourceListingId.toLowerCase().includes(listingId)
          && !targetListingId.toLowerCase().includes(listingId)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [pairs, platformFilter, addressKeyword, listingIdKeyword]);

  const autoCount = summary.auto_match || 0;
  const reviewCount = summary.review_required || 0;
  const distinctCount = summary.distinct || 0;

  return (
    <section className="view-shell">
      <header className="section-head">
        <h2>매칭 후보 / 중복 탐색</h2>
        <p>동일매물 매칭군을 점검하고 검토군만 선별해 확인할 수 있습니다.</p>
        <div className="toolbar compact">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="ALL">전체</option>
            <option value="AUTO_MATCH">AUTO_MATCH</option>
            <option value="REVIEW_REQUIRED">REVIEW_REQUIRED</option>
            <option value="DISTINCT">DISTINCT</option>
          </select>
          <input
            type="text"
            value={addressKeyword}
            onChange={(event) => setAddressKeyword(event.target.value)}
            placeholder="주소 검색"
          />
          <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}>
            {PLATFORM_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value || "ALL"}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={listingIdKeyword}
            onChange={(event) => setListingIdKeyword(event.target.value)}
            placeholder="매물 ID 검색"
          />
          <button type="button" onClick={load}>조회</button>
        </div>
        <p className="muted">플랫폼은 선택형, 주소/매물ID는 자유 입력 텍스트로 필터링됩니다.</p>
      </header>

      {error ? <p className="error-box">{error}</p> : null}

      <section className="metrics-grid">
        <article className="metric-card">
          <p className="metric-label">총 후보쌍</p>
          <p className="metric-value">{summary.candidate_pairs || 0}</p>
          <p className="muted">AUTO {autoCount} / REVIEW {reviewCount} / DISTINCT {distinctCount}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">AUTO_MATCH</p>
          <p className="metric-value">{autoCount}</p>
          <p className="muted">자동 신뢰군</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">REVIEW_REQUIRED</p>
          <p className="metric-value">{reviewCount}</p>
          <p className="muted">검토가 필요한 쌍</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">매칭군</p>
          <p className="metric-value">{summary.merged_groups || 0}</p>
          <p className="muted">중복 매물 그룹</p>
        </article>
      </section>

      <section className="grid-2">
        <section className="card">
          <h3>매칭쌍 목록 ({filteredPairs.length})</h3>
          <div className="pair-list">
            {filteredPairs.length === 0 ? (
              <p className="muted">표시할 후보가 없습니다.</p>
            ) : (
              filteredPairs.map((pair) => (
                <article key={`${pair.source_listing_id}-${pair.target_listing_id}-${pair.status}`} className="pair-card">
                  <div className="pair-title">
                    <span className={`chip chip-${pair.status?.toLowerCase() || "neutral"}`}>{pair.status}</span>
                    <span className="chip">{pair.score}</span>
                  </div>
                    <p className="pair-meta">
                    {toPlatformLabel(pair.source?.platform)} / {pair.source?.address || "-"}
                    <br />
                    {toPlatformLabel(pair.target?.platform)} / {pair.target?.address || "-"}
                    <br />
                    월세 {toMoney(pair.source?.rent)} / {toMoney(pair.target?.rent)}, 면적 {toArea(pair.source?.area_exclusive_m2)} / {toArea(pair.target?.area_exclusive_m2)}
                  </p>
                  <details>
                    <summary className="chip">score breakdown</summary>
                    <pre>{JSON.stringify(pair.reason || {}, null, 2)}</pre>
                  </details>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="card">
          <h3>군집 요약 ({groups.length})</h3>
          {groups.length === 0 ? (
            <p className="muted">군집은 후보가 충분할 때 생성됩니다.</p>
          ) : (
            <div className="pair-list">
              {groups.slice(0, 20).map((group) => (
                <article key={group.group_id || group.id || `${group.member_count}-${group.canonical_key}`} className="pair-card">
                  <p className="pair-title">
                    <span className="chip">회원 {Array.isArray(group.members) ? group.members.length : (group.member_count || 0)}개</span>
                    <span className="chip">{group.canonical_status || "-"}</span>
                  </p>
                  <p className="pair-meta">
                    {Array.isArray(group.members) && group.members.length > 0
                      ? group.members
                        .map((member) => `${toPlatformLabel(member.platform)} ${member.address || "-"} (${toMoney(member.rent || member?.source?.rent)})`)
                        .join(" / ")
                      : "구성원 없음"}
                  </p>
                  <details>
                    <summary className="chip">group reason</summary>
                    <pre>{JSON.stringify(group, null, 2)}</pre>
                  </details>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </section>
  );
}
