-- 031_add_run_mode_to_collection_runs.sql
-- collection_runs.run_mode: incremental(증분 수집) vs full(전수 수집)을 구분.
-- 기존 'mode' 컬럼은 수집 방식(API/STEALTH_AUTOMATION/BLOCKED)이라 의미가 다름.
-- 기본값 'full' — 기존/신규 run이 의미 변경 없이 안전하게 기록되도록.

ALTER TABLE collection_runs
  ADD COLUMN IF NOT EXISTS run_mode TEXT NOT NULL DEFAULT 'full'
  CHECK (run_mode IN ('full', 'incremental'));

CREATE INDEX IF NOT EXISTS idx_collection_runs_run_mode
  ON collection_runs(platform_code, run_mode, started_at DESC);
