#!/bin/bash
# 수집 wrapper: 중복 실행 방지 + 절전 방지

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../logs"
LOCK=/tmp/rent-finder-collect.lock
# launchd에서 $HOME이 다를 수 있으므로 절대경로 사용
NODE_BIN="/Users/hyunsoo/.nvm/versions/node/v20.11.0/bin/node"
HARNESS="$SCRIPT_DIR/harness_runner.mjs"

mkdir -p "$LOG_DIR"

# 이미 실행 중이면 스킵
if [ -f "$LOCK" ]; then
  PID=$(cat "$LOCK" 2>/dev/null)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 이미 실행 중 (PID=$PID) - 스킵" | tee -a "$LOG_DIR/collect.log"
    exit 0
  fi
  rm -f "$LOCK"
fi

echo $$ > "$LOCK"
trap "rm -f $LOCK" EXIT INT TERM

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 수집 시작 (PID=$$)" | tee -a "$LOG_DIR/collect.log"

# 최신 코드로 실행하기 위해 git pull (실패해도 계속 진행)
GIT_BIN="/usr/bin/git"
REPO_DIR="$SCRIPT_DIR/.."
echo "[$(date '+%Y-%m-%d %H:%M:%S')] git pull 시작" | tee -a "$LOG_DIR/collect.log"
cd "$REPO_DIR" && $GIT_BIN pull --ff-only 2>&1 | tee -a "$LOG_DIR/collect.log" || \
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] git pull 실패 — 기존 코드로 계속 진행" | tee -a "$LOG_DIR/collect.log"

# --mode=incremental|full (기본 full, 환경변수 또는 첫 번째 인자로 지정 가능)
COLLECT_MODE="${COLLECT_MODE:-${1:-full}}"
case "$COLLECT_MODE" in
  full|incremental) ;;
  *)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] invalid mode: '$COLLECT_MODE' (full|incremental만 허용)" | tee -a "$LOG_DIR/collect.log"
    exit 2
    ;;
esac
echo "[$(date '+%Y-%m-%d %H:%M:%S')] collect mode=$COLLECT_MODE" | tee -a "$LOG_DIR/collect.log"

# COLLECT_EXCLUDE_PLATFORMS — 특정 플랫폼 제외 (예: 격일 스케줄에서 naver=naver 제외)
# 환경변수 또는 두 번째 인자로 지정 (CSV: "naver,kbland")
COLLECT_EXCLUDE_PLATFORMS="${COLLECT_EXCLUDE_PLATFORMS:-${2:-}}"
EXCLUDE_ARG=()
if [ -n "$COLLECT_EXCLUDE_PLATFORMS" ]; then
  EXCLUDE_ARG=(--exclude-platforms="$COLLECT_EXCLUDE_PLATFORMS")
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] excluding platforms: $COLLECT_EXCLUDE_PLATFORMS" | tee -a "$LOG_DIR/collect.log"
fi

# caffeinate -i: 수집 중 절전 방지 (stdout/stderr 터미널 + 로그 파일 동시 출력)
caffeinate -i "$NODE_BIN" "$HARNESS" --sample-cap=0 --mode="$COLLECT_MODE" "${EXCLUDE_ARG[@]}" 2>&1 | tee -a "$LOG_DIR/harness.log"

EXIT_CODE=${PIPESTATUS[0]}
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 수집 완료 (exit=$EXIT_CODE)" | tee -a "$LOG_DIR/collect.log"

# 직방 이미지 부족 매물 자동 보강 (detail API 실패로 썸네일만 저장된 것 복구)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 직방 이미지 reenrich 시작" | tee -a "$LOG_DIR/collect.log"
"$NODE_BIN" "$SCRIPT_DIR/zigbang_reenrich.mjs" 2>&1 | tee -a "$LOG_DIR/harness.log"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 직방 이미지 reenrich 완료" | tee -a "$LOG_DIR/collect.log"

exit $EXIT_CODE
