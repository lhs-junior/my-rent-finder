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

# caffeinate -i: 수집 중 절전 방지 (stdout/stderr 터미널로 출력)
caffeinate -i "$NODE_BIN" "$HARNESS" --sample-cap=0

EXIT_CODE=$?
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 수집 완료 (exit=$EXIT_CODE)" | tee -a "$LOG_DIR/collect.log"
exit $EXIT_CODE
