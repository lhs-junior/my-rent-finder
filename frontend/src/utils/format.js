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
];

export function toMoney(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "-";
  return `${Math.round(v).toLocaleString("ko-KR")}만원`;
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

export function normalizeView(value) {
  return value === "matches" || value === "listings" || value === "map" || value === "favorites" ? value : "ops";
}
