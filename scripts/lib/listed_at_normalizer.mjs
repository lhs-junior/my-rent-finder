// listed_at 포맷을 "YYYY-MM-DD HH:MM:SS" (KST 가정) 로 통일.
// 플랫폼별 원본 포맷:
//   - naver     : "20260418"                          (YYYYMMDD)
//   - kbland    : "2026.04.06"                        (day)
//   - zigbang   : "2026-04-10T11:33:42+09:00"         (ISO w/ TZ)
//   - dabang    : "2026.04.13"                        (day)
//   - peterpanz : "2026-03-23 00:00:00"               (sec, KST)
//   - daangn    : "2026-04-09T07:08:39.944Z"          (ISO UTC → KST 변환)
//   - serve     : "2026-04-13 17:15:43"               (sec, KST)

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatKst(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + KST_OFFSET_MS);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

export function normalizeListedAt(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // "20260418" → YYYYMMDD
  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    return `${y}-${m}-${d} 00:00:00`;
  }

  // "2026.04.13" or "2026/04/13"
  const dotMatch = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(raw);
  if (dotMatch) {
    return `${dotMatch[1]}-${pad(dotMatch[2])}-${pad(dotMatch[3])} 00:00:00`;
  }

  // "2026-04-13 17:15:43" (KST 가정) — 그대로 반환
  const ymdhmsMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  if (ymdhmsMatch) {
    return `${ymdhmsMatch[1]}-${ymdhmsMatch[2]}-${ymdhmsMatch[3]} ${ymdhmsMatch[4]}:${ymdhmsMatch[5]}:${ymdhmsMatch[6]}`;
  }

  // ISO with TZ (Z or +09:00 etc.) — 파싱해서 KST로 변환
  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) {
    return formatKst(ts);
  }

  return null;
}

export default normalizeListedAt;
