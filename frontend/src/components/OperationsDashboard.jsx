import { useCallback, useEffect, useMemo, useState } from "react";
import { toMoney, toPercent, toPlatformLabel, toStatusClass } from "../utils/format.js";
import { fetchJson } from "../hooks/useApi.js";

export default function OperationsDashboard({ apiBase, runId }) {
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
          <span className="muted">
            {status === "실시간 데이터 로딩" ? "데이터를 불러오는 중..." : status}
          </span>
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
