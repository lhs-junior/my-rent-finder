import { toText } from "./format.js";

function normalizeExternalUrl(value) {
  const raw = toText(value, "").trim();
  if (!raw) return null;
  let candidate = raw;

  if (/^\/\//.test(candidate)) {
    candidate = `${window.location.protocol}${candidate}`;
  } else if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function extractNaverArticleRef(raw) {
  const text = toText(raw, "").trim();
  if (!text) return null;

  const directMatch = /(?:^|[/?#&])(?:articleNo=|articles\/|article\/)([0-9]{6,10})(?:$|[^0-9])/.exec(text);
  if (directMatch?.[1]) return directMatch[1];

  if (/^fp_/i.test(text)) return null;
  const exactNumeric = /^([0-9]{6,10})$/.exec(text);
  return exactNumeric?.[1] || null;
}

function isLikelyNaverArticleNo(value) {
  return /^[0-9]{6,10}$/.test(toText(value, ""));
}

function buildNaverHouseUrl(sourceUrl, sourceRef) {
  const normalizedSourceRef = isLikelyNaverArticleNo(sourceRef)
    ? toText(sourceRef, "")
    : null;
  if (!normalizedSourceRef) return null;

  const defaultHouseUrl = new URL("https://new.land.naver.com/houses");
  defaultHouseUrl.searchParams.set("e", "RETAIL");
  defaultHouseUrl.searchParams.set("b", "B2");
  defaultHouseUrl.searchParams.set("d", "80");
  defaultHouseUrl.searchParams.set("articleNo", normalizedSourceRef);

  if (!sourceUrl) {
    return defaultHouseUrl.toString();
  }

  try {
    const parsedSource = new URL(sourceUrl);
    const isNaverHouse = /(^|\.)new\.land\.naver\.com$/i.test(parsedSource.hostname)
      || /(^|\.)land\.naver\.com$/i.test(parsedSource.hostname);
    if (!isNaverHouse || !parsedSource.pathname.startsWith("/houses")) {
      return defaultHouseUrl.toString();
    }

    const mapped = new URL(parsedSource.toString());
    const articleNo = parsedSource.searchParams.get("articleNo")
      || /(?:^|[?&])articleNo=([0-9]{6,10})(?:&|$)/.exec(sourceUrl)?.[1]
      || /(?:^|\/)articles?\/([0-9]{6,10})(?:[/?#&]|$)/.exec(sourceUrl)?.[1];

    if (!isLikelyNaverArticleNo(articleNo)) return defaultHouseUrl.toString();
    mapped.searchParams.set("articleNo", articleNo);
    mapped.searchParams.set("e", "RETAIL");
    mapped.searchParams.set("b", mapped.searchParams.get("b") || "B2");
    mapped.searchParams.set("d", mapped.searchParams.get("d") || "80");
    if (mapped.searchParams.get("path")) {
      mapped.searchParams.delete("path");
    }
    return mapped.toString();
  } catch {
    return defaultHouseUrl.toString();
  }
}

export function resolveExternalListingUrl(listing) {
  if (!listing || typeof listing !== "object") return null;
  const platformCode = toText(listing.platform_code || listing.platform, "").toLowerCase();
  const sourceRefRaw = toText(listing.source_ref || listing.external_id, "");
  const isNaverPlatform = platformCode === "naver" || platformCode.includes("naver");
  const sourceRef = isNaverPlatform ? extractNaverArticleRef(sourceRefRaw) : sourceRefRaw;
  const sourceUrl = toText(listing.source_url, "");
  const candidates = [];

  if (platformCode === "zigbang" && sourceRef) {
    candidates.push(`https://sp.zigbang.com/share/oneroom/${encodeURIComponent(sourceRef)}?userNo=undefined`);
  }
  if (platformCode === "dabang" && sourceRef) {
    candidates.push(`https://www.dabangapp.com/room/${encodeURIComponent(sourceRef)}`);
  }
  if (platformCode === "r114" && sourceRef) {
    candidates.push(`https://www.r114.com/?_c=memul&_m=p10&_a=goDetail&memulNo=${encodeURIComponent(sourceRef)}`);
  }
  if (isNaverPlatform) {
    const houseUrlFromSource = buildNaverHouseUrl(sourceUrl, sourceRef || extractNaverArticleRef(sourceUrl));
    if (houseUrlFromSource) {
      candidates.push(houseUrlFromSource);
    }
  }

  if (sourceUrl && platformCode !== "naver") {
    if (platformCode === "zigbang") {
      const parsedZigbangRef = /zigbang\.com\/(?:home\/oneroom|share\/oneroom)\/([0-9]+)/.exec(sourceUrl);
      if (parsedZigbangRef?.[1]) {
        const ref = parsedZigbangRef[1];
        candidates.push(`https://sp.zigbang.com/share/oneroom/${encodeURIComponent(ref)}?userNo=undefined`);
      }
    }
    if (platformCode !== "naver") {
      candidates.push(sourceUrl);
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeExternalUrl(candidate);
    if (normalized) return normalized;
  }

  return null;
}
