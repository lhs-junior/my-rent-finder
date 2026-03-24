import { useCallback, useEffect, useMemo, useState } from "react";
import { toPercent, toPlatformLabel } from "../utils/format.js";
import { fetchJson } from "../hooks/useApi.js";

function toShortTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function classifyPlatform(row) {
  if ((row.failed || 0) > 0 || Number(row.success_rate || 0) < 1) return "fail";
  if (Number(row.metrics?.required_fields_rate || 0) < 0.85) return "warn";
  return "ok";
}

export default function OperationsDashboard({ apiBase, runId }) {
  const [opsPayload, setOpsPayload] = useState(null);
  const [matchPayload, setMatchPayload] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (runId.trim()) params.set("run_id", runId.trim());
    return params.toString();
  }, [runId]);

  const loadData = useCallback(async () => {
    try {
      setError("");
      setLoading(true);
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
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      const message = `로딩 실패: ${String(err?.message || err)}`;
      setError(message);
      setOpsPayload(null);
      setMatchPayload(null);
    } finally {
      setLoading(false);
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

  const priorityPlatforms = platformRows
    .map((row) => ({ ...row, health: classifyPlatform(row) }))
    .filter((row) => row.health !== "ok")
    .sort((left, right) => {
      const weight = { fail: 0, warn: 1, ok: 2 };
      return (weight[left.health] ?? 9) - (weight[right.health] ?? 9);
    });

  const failedCount = priorityPlatforms.filter((row) => row.health === "fail").length;
  const degradedCount = priorityPlatforms.length;
  const stateTone = error
    ? "error"
    : loading
      ? "loading"
      : platformRows.length === 0
        ? "empty"
        : "success";

  return (
    <section className="view-shell listing-search-page">
      <header className="section-head search-overview-panel">
        <div className="search-overview-copy">
          <span className="section-kicker">운영 상태</span>
          <h2>수집 운영 대시보드</h2>
          <p>
            neutral count보다 실패 플랫폼과 품질 저하를 먼저 보여 주고,
            다음 점검 대상을 첫 화면에서 바로 읽을 수 있게 정리합니다.
          </p>
        </div>
        <div className="search-proof-grid">
          <article className="search-proof-card">
            <span className="search-proof-label">실패 플랫폼</span>
            <strong className="search-proof-value">{failedCount}개</strong>
            <span className="search-proof-meta">즉시 점검 필요</span>
          </article>
          <article className="search-proof-card">
            <span className="search-proof-label">필수필드 충족율</span>
            <strong className="search-proof-value">{toPercent(overview.required_quality_rate || 0)}</strong>
            <span className="search-proof-meta">주소 + 가격 + 면적 동시 충족</span>
          </article>
          <article className="search-proof-card">
            <span className="search-proof-label">실행 기준</span>
            <strong className="search-proof-value">{runSummary.run_id || runId.trim() || "latest"}</strong>
            <span className="search-proof-meta">최근 갱신 {lastLoadedAt ? toShortTime(lastLoadedAt) : "기록 없음"}</span>
          </article>
        </div>
      </header>

      <section className="card search-form-panel">
        <div className="search-form-head">
          <div>
            <h3>현재 컨텍스트</h3>
            <p className="muted">
              {runId.trim()
                ? `입력한 run_id(${runId.trim()}) 기준으로 집계합니다.`
                : "run_id 미입력 시 최신 수집 run 기준으로 집계합니다."}
            </p>
          </div>
          <div className="search-form-actions">
            <button type="button" className="search-submit-button" onClick={loadData} disabled={loading}>
              {loading ? "갱신 중..." : "새로고침"}
            </button>
          </div>
        </div>
        <div className="search-chip-list">
          <span className="search-summary-chip">raw {overview.raw_count || 0}</span>
          <span className="search-summary-chip">normalized {overview.normalized_count || 0}</span>
          <span className="search-summary-chip">jobs {overview.total_jobs || 0}</span>
          <span className="search-summary-chip">REVIEW {matchingSummary.review_required || 0}</span>
        </div>
      </section>

      <section className="card search-results-panel">
        <div className={`search-state-bar search-state-bar--${stateTone}`} aria-live="polite">
          <div className="search-state-copy">
            <strong>
              {stateTone === "loading" && "운영 데이터를 다시 읽는 중입니다."}
              {stateTone === "error" && "운영 대시보드를 불러오지 못했습니다."}
              {stateTone === "empty" && "현재 run 기준 운영 데이터가 없습니다."}
              {stateTone === "success" && (degradedCount > 0 ? "문제 플랫폼이 먼저 보이도록 정렬했습니다." : "현재는 즉시 대응이 필요한 플랫폼이 없습니다.")}
            </strong>
            <span>
              {stateTone === "loading" && "platform/run/matching 요약을 동시에 갱신합니다."}
              {stateTone === "error" && error}
              {stateTone === "empty" && "run_id를 지정하거나 수집 실행 이후 다시 확인하세요."}
              {stateTone === "success" && `문제 플랫폼 ${degradedCount}개 · 자동 ${matchingSummary.auto_match || 0} · 검토 ${matchingSummary.review_required || 0}`}
            </span>
          </div>
          <div className="search-state-actions">
            {stateTone === "error" && (
              <button type="button" className="search-inline-button" onClick={loadData}>
                다시 시도
              </button>
            )}
          </div>
        </div>

        <div className="ops-alert-section">
          <div className="matching-priority-head">
            <div>
              <h3>지금 볼 항목</h3>
              <p className="muted">실패 또는 품질 저하 플랫폼을 우선 노출합니다.</p>
            </div>
            <span className="search-summary-chip">{degradedCount}개</span>
          </div>
          {priorityPlatforms.length === 0 ? (
            <div className="matching-empty-panel">
              <p>즉시 대응이 필요한 플랫폼이 없습니다.</p>
              <span className="muted">테이블은 참고 근거로 유지하되, 우선순위 카드가 비면 전체 상태가 안정적이라는 뜻입니다.</span>
            </div>
          ) : (
            <div className="ops-alert-grid">
              {priorityPlatforms.map((row) => (
                <article key={row.platform_code} className={`ops-alert-card ops-alert-card--${row.health}`}>
                  <div className="pair-title">
                    <span className="chip">{toPlatformLabel(row.platform_code)}</span>
                    <span className={`chip ${row.health === "fail" ? "chip-danger" : "chip-warn"}`}>
                      {row.health === "fail" ? "즉시 점검" : "품질 주의"}
                    </span>
                  </div>
                  <strong className="ops-alert-title">
                    성공률 {toPercent(row.success_rate || 0)} · 필수 {toPercent(row.metrics?.required_fields_rate || 0)}
                  </strong>
                  <p className="pair-meta">
                    성공 {row.succeeded || 0} · 실패 {row.failed || 0} · raw {row.raw_count || 0} / norm {row.normalized_count || 0}
                  </p>
                  <div className="search-chip-list">
                    <span className="search-summary-chip">주소 {toPercent(row.metrics?.address_rate || 0)}</span>
                    <span className="search-summary-chip">면적 {toPercent(row.metrics?.area_rate || 0)}</span>
                    <span className="search-summary-chip">가격 {toPercent(row.metrics?.price_rate || 0)}</span>
                    <span className="search-summary-chip">이미지 {toPercent(row.metrics?.image_rate || 0)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

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
                        <span className={row.failed > 0 ? "status-danger" : "status-ok"}>
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
                      <td><span className={job.status === "DONE" ? "status-ok" : "status-danger"}>{job.status || "-"}</span></td>
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
    </section>
  );
}
