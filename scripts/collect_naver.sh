#!/usr/bin/env bash
# ============================================================
# 네이버 매물 로컬 수집 → Neon DB 저장
# 사용법:
#   bash scripts/collect_naver.sh                    # .env 의 DATABASE_URL 사용
#   DATABASE_URL="postgresql://..." bash scripts/collect_naver.sh  # 직접 주입
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# .env 로드 (DATABASE_URL이 이미 환경변수에 있으면 덮어쓰지 않음)
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DATABASE_URL 이 설정되지 않았습니다."
  echo "   .env 파일에 DATABASE_URL=postgresql://... 을 추가하거나,"
  echo "   DATABASE_URL=\"postgresql://...\" bash scripts/collect_naver.sh"
  exit 1
fi

echo "🏠 네이버 부동산 수집 시작 (→ Neon DB)"
echo "   DB: ${DATABASE_URL%%@*}@..."
echo ""

node "$ROOT_DIR/scripts/run_parallel_collect.mjs" \
  --platforms naver \
  --persist-to-db \
  --sample-cap 0 \
  --qa-strict false \
  "$@"
