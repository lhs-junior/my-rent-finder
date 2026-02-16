import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_API_BASE = (() => {
  if (typeof window === "undefined" || window.location.protocol === "file:") {
    return "http://127.0.0.1:4100";
  }
  const proto = window.location.protocol || "http:";
  const hostname = window.location.hostname || "127.0.0.1";
  const hostPort = window.location.port || "4100";
  const port = hostPort === "5173" || hostPort === "4173" ? "4100" : hostPort;
  return `${proto}//${hostname}:${port}`;
})();

const PLATFORM_OPTIONS = [
  { value: "", label: "전체" },
  { value: "naver", label: "네이버" },
  { value: "zigbang", label: "직방" },
  { value: "dabang", label: "다방" },
  { value: "r114", label: "부동산114" },
  { value: "peterpanz", label: "피터팬" },
];

function toMoney(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "-";
  return `${Math.round(v).toLocaleString("ko-KR")}만원`;
}

function toIdText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeExternalUrl(value) {
  const raw = toText(value, "").trim();
  if (!raw) return null;
  let candidate = raw;

  if (/^\/\//.test(candidate)) {
    candidate = `${window.location.protocol}${candidate}`;
  } else if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function extractNaverArticleRef(raw) {
  const text = toText(raw, "").trim();
  if (!text) return null;

  const directMatch = /(?:^|[/?#&])(?:articleNo=|articles\/|article\/)([0-9]{6,})(?:$|[^0-9])/.exec(text);
  if (directMatch?.[1]) return directMatch[1];

  const numericOnly = text.replace(/[^0-9]/g, "");
  return numericOnly.length >= 6 ? numericOnly : null;
}

function buildNaverHouseUrl(sourceUrl, sourceRef) {
  const normalizedSourceRef = toText(sourceRef, "");
  if (!normalizedSourceRef) return null;

  const defaultHouseUrl = new URL("https://new.land.naver.com/houses");
  defaultHouseUrl.searchParams.set("e", "RETAIL");
  defaultHouseUrl.searchParams.set("b", "B2");
  defaultHouseUrl.searchParams.set("d", "80");
  defaultHouseUrl.searchParams.set("articleNo", normalizedSourceRef);

  if (!sourceUrl) {
    return defaultHouseUrl.toString();
  }

  try {
    const parsedSource = new URL(sourceUrl);
    const isNaverHouse = /(^|\.)new\.land\.naver\.com$/i.test(parsedSource.hostname)
      || /(^|\.)land\.naver\.com$/i.test(parsedSource.hostname);
    if (!isNaverHouse || !parsedSource.pathname.startsWith("/houses")) {
      return defaultHouseUrl.toString();
    }

    const mapped = new URL(parsedSource.toString());
    const articleNo = parsedSource.searchParams.get("articleNo")
      || /(?:^|[?&])articleNo=([0-9]+)/.exec(sourceUrl)?.[1]
      || /(?:^|\/)articles?\/([0-9]+)/.exec(sourceUrl)?.[1];

    if (!articleNo) return defaultHouseUrl.toString();
    mapped.searchParams.set("articleNo", articleNo);
    mapped.searchParams.set("e", "RETAIL");
    mapped.searchParams.set("b", mapped.searchParams.get("b") || "B2");
    mapped.searchParams.set("d", mapped.searchParams.get("d") || "80");
    if (mapped.searchParams.get("path")) {
      mapped.searchParams.delete("path");
    }
    return mapped.toString();
  } catch {
    return defaultHouseUrl.toString();
  }
}

function resolveExternalListingUrl(listing) {
  if (!listing || typeof listing !== "object") return null;
  const platformCode = toText(listing.platform_code || listing.platform, "").toLowerCase();
  const sourceRefRaw = toText(listing.source_ref || listing.external_id, "");
  const sourceRef = platformCode === "naver" ? extractNaverArticleRef(sourceRefRaw) : sourceRefRaw;
  const sourceUrl = toText(listing.source_url, "");
  const candidates = [];

  if (platformCode === "zigbang" && sourceRef) {
    candidates.push(`https://sp.zigbang.com/share/oneroom/${encodeURIComponent(sourceRef)}?userNo=undefined`);
  }
  if (platformCode === "dabang" && sourceRef) {
    candidates.push(`https://www.dabangapp.com/room/${encodeURIComponent(sourceRef)}`);
  }
  if (platformCode === "r114" && sourceRef) {
    candidates.push(`https://www.r114.com/?_c=memul&_m=p10&_a=goDetail&memulNo=${encodeURIComponent(sourceRef)}`);
  }
  if (platformCode === "naver" && sourceRef) {
    const houseUrlFromSource = buildNaverHouseUrl(sourceUrl, sourceRef);
    if (houseUrlFromSource) {
      candidates.push(houseUrlFromSource);
    }
  }

  if (sourceUrl && platformCode !== "naver") {
    if (platformCode === "zigbang") {
      const parsedZigbangRef = /zigbang\.com\/(?:home\/oneroom|share\/oneroom)\/([0-9]+)/.exec(sourceUrl);
      if (parsedZigbangRef?.[1]) {
        const ref = parsedZigbangRef[1];
        candidates.push(`https://sp.zigbang.com/share/oneroom/${encodeURIComponent(ref)}?userNo=undefined`);
      }
    }
    if (platformCode !== "naver") {
      candidates.push(sourceUrl);
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeExternalUrl(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function toText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length ? text : fallback;
}

function toArea(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "-";
  return `${v.toFixed(1)}㎡`;
}

function toPercent(value, digits = 1) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
}

function toPlatformLabel(code) {
  const map = {
    naver: "네이버",
    zigbang: "직방",
    dabang: "다방",
    r114: "부동산114",
    peterpanz: "피터팬",
  };
  return map[code] || code || "-";
}

function formatFloorDirectionUse(listing) {
  const floor = listing?.floor;
  const totalFloor = listing?.total_floor;
  const direction = toText(listing?.direction, "-");
  const buildingUse = toText(listing?.building_use, "-");
  const current = floor === 0 || floor ? `${toText(floor, "-")}층` : "-";
  const total = totalFloor ? `${toText(totalFloor, "-")}층` : null;
  const floorText = total ? `${current}/${total}` : current;
  return `${floorText} · 방향: ${direction} · 용도: ${buildingUse}`;
}

function toStatusClass(status) {
  if (status === "DONE") return "status-ok";
  if (status === "SKIP") return "status-warn";
  return "status-danger";
}

function normalizeView(value) {
  return value === "matches" || value === "listings" ? value : "ops";
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.error || payload?.message) {
        detail = `${payload.error || "error"}: ${payload.message || "요청 처리 실패"}`;
      }
    } catch {
      // Keep fallback detail
    }
    throw new Error(detail);
  }
  return response.json();
}

function useApiHealth(apiBase) {
  const [health, setHealth] = useState({ state: "체크 중", error: null });

  useEffect(() => {
    let active = true;
    async function check() {
      try {
        await fetchJson(`${apiBase}/api/health`);
        if (active) setHealth({ state: "정상", error: null });
      } catch (error) {
        if (active) setHealth({ state: "실패", error: String(error?.message || error) });
      }
    }

    setHealth({ state: "체크 중", error: null });
    check();
    return () => {
      active = false;
    };
  }, [apiBase]);

  return health;
}

function OperationsDashboard({ apiBase, runId }) {
  const [opsPayload, setOpsPayload] = useState(null);
  const [matchPayload, setMatchPayload] = useState(null);
  const [status, setStatus] = useState("로딩 준비");
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (runId.trim()) params.set("run_id", runId.trim());
    return params.toString();
  }, [runId]);

  const loadData = useCallback(async () => {
    try {
      setError("");
      setStatus("실시간 데이터 로딩");
      const [ops, matches] = await Promise.all([
        fetchJson(`${apiBase}/api/ops${query ? `?${query}` : ""}`),
        fetchJson(`${apiBase}/api/matches${query ? `?${query}&limit=300` : "?limit=300"}`),
      ]);
      if (ops?.error) {
        throw new Error(`API 오류(${ops.error}): ${ops.message || "요청 처리 실패"}`);
      }
      if (matches?.error) {
        throw new Error(`API 오류(${matches.error}): ${matches.message || "요청 처리 실패"}`);
      }
      setOpsPayload(ops);
      setMatchPayload(matches);
      setStatus("로딩 완료");
    } catch (err) {
      const message = `로딩 실패: ${String(err?.message || err)}`;
      setError(message);
      setStatus("로딩 실패");
      setOpsPayload(null);
      setMatchPayload(null);
    }
  }, [apiBase, query]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const platformRows = opsPayload?.platform_rows || [];
  const jobs = opsPayload?.jobs || [];
  const overview = opsPayload?.overview || {};
  const runSummary = opsPayload?.run || {};
  const matchingSummary = matchPayload?.summary || {
    candidate_pairs: 0,
    auto_match: 0,
    review_required: 0,
    distinct: 0,
    merged_groups: 0,
  };

  return (
    <section className="view-shell">
      <header className="section-head">
        <h2>수집 운영 대시보드</h2>
        <p>DB 저장 상태 기반 / 플랫폼별 성공률, 품질율, 건수</p>
        <p className="muted">
          {runId.trim()
            ? `실행 기준: 입력한 run_id(${runId.trim()}) 기준 집계`
            : "실행 기준: run_id 미입력 시 최신 수집 run 기준 집계"}
        </p>
        <p className="muted metric-note">
          run_id가 비어 있으면 최신 실행의 platform/run 단위 집계값을 사용합니다.
        </p>
        <div className="toolbar compact">
          <button type="button" onClick={loadData}>새로고침</button>
          <span className="muted">{status}</span>
        </div>
      </header>

      {error ? <p className="error-box">{error}</p> : null}

      <section className="metrics-grid">
        <article className="metric-card">
          <p className="metric-label">run_id</p>
          <p className="metric-value">{runSummary.run_id || "-"}</p>
          <p className="muted">{`작업: ${overview.total_jobs || 0} · 완료 ${overview.succeeded_jobs || 0}`}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">원본(raw)</p>
          <p className="metric-value">{overview.raw_count || 0}</p>
          <p className="muted">정규화(normalized): {overview.normalized_count || 0}</p>
          <p className="muted metric-note">raw = 정규화 전 원본(raw_listings), normalized = 정규화 후 건수</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">필수필드 충족율</p>
          <p className="metric-value">{toPercent(overview.required_quality_rate || 0)}</p>
          <p className="muted">주소 + 가격 + 면적 동시 충족</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">매칭 후보</p>
          <p className="metric-value">
            {(matchingSummary.auto_match || 0) + (matchingSummary.review_required || 0)}/{matchingSummary.candidate_pairs || 0}
          </p>
          <p className="muted">{`자동 ${matchingSummary.auto_match || 0} / 검토 ${matchingSummary.review_required || 0}`}</p>
        </article>
      </section>

      <section className="card">
        <h3>플랫폼별 운영 현황</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>플랫폼</th>
                <th>성공률</th>
                <th>건수 (raw / norm)</th>
                <th>품질율</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {platformRows.length === 0 ? (
                <tr>
                  <td colSpan="5">
                    <span className="muted">수집 작업 데이터가 없습니다. run_id를 지정해 주세요.</span>
                  </td>
                </tr>
              ) : (
                platformRows.map((row) => (
                  <tr key={row.platform_code}>
                    <td>
                      <span className="chip">{toPlatformLabel(row.platform_code)}</span>
                    </td>
                    <td>
                      <span className={toStatusClass(row.succeeded > 0 ? "DONE" : "FAIL")}>
                        {toPercent(row.success_rate || 0)}
                      </span>
                      <span className="muted" style={{ marginLeft: 6 }}>{`성공 ${row.succeeded || 0} · 실패 ${row.failed || 0} · 스킵 ${row.skipped || 0}`}</span>
                    </td>
                    <td>{row.raw_count || 0} / {row.normalized_count || 0}</td>
                    <td className="muted">
                      주소 {toPercent((row.metrics?.address_rate || 0))}
                      <br />
                      면적 {toPercent((row.metrics?.area_rate || 0))}, 가격 {toPercent((row.metrics?.price_rate || 0))}
                      <br />
                      이미지 {toPercent((row.metrics?.image_rate || 0))}, 필수 {toPercent((row.metrics?.required_fields_rate || 0))}
                    </td>
                    <td>
                      <span className="chip">{row.jobs}건</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>최근 실행 이력</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>플랫폼</th>
                <th>상태</th>
                <th>건수</th>
                <th>시간</th>
                <th>run_id</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan="5"><span className="muted">이력 없음</span></td>
                </tr>
              ) : (
                jobs.map((job, idx) => (
                  <tr key={`${job.__run_id || job.platform}-${idx}`}>
                    <td><span className="chip">{toPlatformLabel(job.platform || job.platform_code || "-")}</span></td>
                    <td><span className={toStatusClass(job.status || "FAIL")}>{job.status || "-"}</span></td>
                    <td>{job.raw_count || 0} / {job.normalized_count || 0}</td>
                    <td className="muted">{job.started_at || "-"} → {job.finished_at || "-"}</td>
                    <td className="muted">{job.__run_id || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function MatchingBoard({ apiBase, runId }) {
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

function ListingSearch({ apiBase, runId }) {
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
            <option value="">전체</option>
            <option value="naver">네이버</option>
            <option value="zigbang">직방</option>
            <option value="dabang">다방</option>
            <option value="r114">부동산114</option>
            <option value="peterpanz">피터팬</option>
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
              <pre>{JSON.stringify(detail.quality_flags || [], null, 2)}</pre>
              <pre>{JSON.stringify(detail.violations || [], null, 2)}</pre>
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

export default function App() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [runId, setRunId] = useState("");
  const [activeView, setActiveView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return normalizeView(params.get("view"));
  });
  const health = useApiHealth(apiBase);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (activeView === "ops") {
      params.delete("view");
    } else {
      params.set("view", activeView);
    }
    const nextPath = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", nextPath);
  }, [activeView]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Rent Finder</h1>
        <p className="muted">수집/매칭 데이터를 DB에서 바로 읽는 실운영 화면</p>
        <div className="toolbar">
          <input
            value={apiBase}
            onChange={(event) => setApiBase(event.target.value)}
            placeholder="http://127.0.0.1:4100"
          />
          <input
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
            placeholder="run_id (비우면 최근)"
          />
          <span className={`chip ${health.state === "정상" ? "chip-success" : "chip-danger"}`}>
            API {health.state}
          </span>
          {health.error ? <span className="muted">{health.error}</span> : null}
        </div>
        <nav className="tabs">
          <button
            type="button"
            className={activeView === "ops" ? "tab-active" : ""}
            onClick={() => setActiveView("ops")}
          >
            수집 운영
          </button>
            <button
            type="button"
            className={activeView === "matches" ? "tab-active" : ""}
            onClick={() => setActiveView("matches")}
          >
            매칭 후보 / 중복 탐색
          </button>
          <button
            type="button"
            className={activeView === "listings" ? "tab-active" : ""}
            onClick={() => setActiveView("listings")}
          >
            매물 검색
          </button>
        </nav>
      </header>

      {activeView === "ops" && <OperationsDashboard apiBase={apiBase} runId={runId} />}
      {activeView === "matches" && <MatchingBoard apiBase={apiBase} runId={runId} />}
      {activeView === "listings" && <ListingSearch apiBase={apiBase} runId={runId} />}
    </div>
  );
}
