export const FLOOR_FILTER_OPTIONS = [
  { value: "", label: "층 전체" },
  { value: "1", label: "반지하 제외" },
  { value: "2", label: "2층 이상" },
  { value: "3", label: "3층 이상" },
];

export const PLATFORM_OPTIONS = [
  { value: "", label: "전체" },
  { value: "naver", label: "네이버" },
  { value: "zigbang", label: "직방" },
  { value: "dabang", label: "다방" },
  { value: "kbland", label: "KB부동산" },
  { value: "peterpanz", label: "피터팬" },
  { value: "daangn", label: "당근부동산" },
  { value: "serve", label: "부동산써브" },
];

export function toMoney(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "-";
  const rounded = Math.round(v);
  if (rounded >= 10000) {
    const eok = Math.floor(rounded / 10000);
    const man = rounded % 10000;
    return man > 0 ? `${eok}억 ${man.toLocaleString("ko-KR")}만` : `${eok}억`;
  }
  return `${rounded.toLocaleString("ko-KR")}만`;
}

export function toIdText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function toText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length ? text : fallback;
}

export function toArea(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "-";
  return `${v.toFixed(1)}㎡`;
}

// listed_at (YYYY-MM-DD HH:MM:SS, KST 가정) → "오늘" / "어제" / "N일 전" / "YYYY-MM-DD"
export function toRelativeListedAt(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(String(value));
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  const listed = new Date(Date.UTC(+y, +mo - 1, +d, +(hh || 0), +(mm || 0), +(ss || 0)));
  const nowUtc = new Date(Date.now());
  const nowKst = new Date(Date.UTC(
    nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(),
    nowUtc.getUTCHours() + 9, nowUtc.getUTCMinutes(), nowUtc.getUTCSeconds(),
  ));
  const dayDiff = Math.floor((Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate())
                             - Date.UTC(+y, +mo - 1, +d)) / 86400000);
  if (dayDiff < 0) return `${y}-${mo}-${d}`;
  if (dayDiff === 0) {
    if (!hh) return "오늘 등록";
    const hrs = Math.floor((nowKst.getTime() - listed.getTime()) / 3600000);
    if (hrs <= 0) return "방금 등록";
    if (hrs < 24) return `${hrs}시간 전 등록`;
    return "오늘 등록";
  }
  if (dayDiff === 1) return "어제 등록";
  if (dayDiff <= 7) return `${dayDiff}일 전 등록`;
  if (dayDiff <= 30) return `${Math.floor(dayDiff / 7)}주 전 등록`;
  return `${y}-${mo}-${d} 등록`;
}

export function toPercent(value, digits = 1) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
}

export function toPlatformLabel(code) {
  const map = {
    naver: "네이버",
    zigbang: "직방",
    dabang: "다방",
    kbland: "KB부동산",
    peterpanz: "피터팬",
    daangn: "당근부동산",
    serve: "부동산써브",
  };
  return map[code] || code || "-";
}

export function formatFloorDirectionUse(listing) {
  const floor = listing?.floor;
  const totalFloor = listing?.total_floor;
  const direction = toText(listing?.direction, "-");
  const buildingUse = toText(listing?.building_use, "-");
  const current = floor === 0 || floor ? `${toText(floor, "-")}층` : "-";
  const total = totalFloor ? `${toText(totalFloor, "-")}층` : null;
  const floorText = total ? `${current}/${total}` : current;
  return `${floorText} · 방향: ${direction} · 용도: ${buildingUse}`;
}

export function toStatusClass(status) {
  if (status === "DONE") return "status-ok";
  if (status === "SKIP") return "status-warn";
  return "status-danger";
}

export const PLATFORM_COLORS = {
  naver: "#03C75A",
  zigbang: "#3B82F6",
  dabang: "#8B5CF6",
  kbland: "#EF4444",
  peterpanz: "#F97316",
  daangn: "#FF6F0F",
  serve: "#10B981",
};

/** 직방 이미지 CDN은 w/h 파라미터 필수 */
export function normalizeImageUrl(url) {
  if (!url) return null;
  if (url.includes("ic.zigbang.com") && !url.includes("w=")) {
    return `${url}${url.includes("?") ? "&" : "?"}w=400&h=300`;
  }
  return url;
}

export function normalizeView(value) {
  return value === "matches" || value === "listings" || value === "map" || value === "favorites" || value === "scores" || value === "ops" || value === "sale" || value === "mypick" ? value : "map";
}
