#!/bin/bash
# 수집 wrapper: 중복 실행 방지 + 절전 방지

LOCK=/tmp/rent-finder-collect.lock
LOG_DIR="$(dirname "$0")/../logs"
mkdir -p "$LOG_DIR"

# 이미 실행 중이면 스킵
if [ -f "$LOCK" ]; then
  PID=$(cat "$LOCK" 2>/dev/null)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 이미 실행 중 (PID=$PID) - 스킵" >> "$LOG_DIR/collect.log"
    exit 0
  fi
  # 프로세스가 없는데 lock 파일만 남아있는 경우 제거
  rm -f "$LOCK"
fi

echo $$ > "$LOCK"
trap "rm -f $LOCK" EXIT INT TERM

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 수집 시작 (PID=$$)" >> "$LOG_DIR/collect.log"

# caffeinate -i: 수집 중 절전 방지
NODE_BIN="$(dirname "$0")/../../.nvm/versions/node/v20.11.0/bin/node"
HARNESS="$(dirname "$0")/harness_runner.mjs"

caffeinate -i "$NODE_BIN" "$HARNESS" --sample-cap=0

EXIT_CODE=$?
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 수집 완료 (exit=$EXIT_CODE)" >> "$LOG_DIR/collect.log"
exit $EXIT_CODE
