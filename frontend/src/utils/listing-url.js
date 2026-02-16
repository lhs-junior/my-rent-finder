const PLATFORM_ALIAS = {
  네이버: "naver",
  네이버부동산: "naver",
  naver: "naver",
  직방: "zigbang",
  다방: "dabang",
  dabang: "dabang",
  kb: "kbland",
  KB부동산: "kbland",
  kbland: "kbland",
  kb부동산: "kbland",
  r114: "r114",
  부동산114: "r114",
  피터팬: "peterpanz",
  peterpanz: "peterpanz",
};

const DEFAULT_NAVER_A = "DDDGG:JWJT:SGJT:VL";

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizePlatform(platformCode, platform) {
  const source = normalizeText(platformCode || platform);
  if (!source) return "";
  return PLATFORM_ALIAS[source] || PLATFORM_ALIAS[source.toLowerCase()] || source.toLowerCase();
}

function normalizeUrl(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (/^\/\//.test(text)) return `https:${text}`;
  return text;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(normalizeUrl(value));
}

function toUrl(value) {
  try {
    return new URL(normalizeUrl(value));
  } catch {
    return null;
  }
}

function parseArticleNoFromUrl(rawUrl) {
  const parsed = toUrl(rawUrl);
  if (!parsed) return "";

  const candidates = [
    "articleNo",
    "article",
    "articleId",
    "article_no",
    "atclNo",
    "atcl_no",
  ];

  for (const key of candidates) {
    const value = normalizeText(parsed.searchParams.get(key));
    if (value) return value;
  }

  const pathMatch = /\/articles\/(\d+)/.exec(parsed.pathname);
  return pathMatch ? normalizeText(pathMatch[1]) : "";
}

function parseLeaseTypeToNaverTrade(value) {
  const source = normalizeText(value);
  if (!source) return "B2";

  if (/(^|,|\s)(B1|전세)($|,|\s)/i.test(source)) return "B1";
  if (/(^|,|\s)(A1|매매)($|,|\s)/i.test(source)) return "A1";
  return "B2";
}

function readNaverQuery(rawUrl, name) {
  const parsed = toUrl(rawUrl);
  if (!parsed) return "";
  return normalizeText(parsed.searchParams.get(name));
}

function buildNaverHouseUrl(options) {
  const {
    articleNo,
    ms,
    a,
    b,
    d,
    e,
  } = options;

  const target = new URL("https://new.land.naver.com/houses");
  if (ms) target.searchParams.set("ms", ms);
  target.searchParams.set("a", a || DEFAULT_NAVER_A);
  target.searchParams.set("b", b || "B2");
  target.searchParams.set("d", d || "80");
  target.searchParams.set("e", e || "RETAIL");
  target.searchParams.set("articleNo", articleNo);

  return target.toString();
}

function resolveNaver(listing, sourceRef) {
  const sourceCandidates = [
    listing?.source_url,
    listing?.sourceUrl,
    listing?.source,
  ];

  const candidateArticleNo = parseArticleNoFromUrl(sourceCandidates.find(isHttpUrl)) || sourceRef;
  if (!candidateArticleNo) return "";

  const listingTrade = parseLeaseTypeToNaverTrade(
    normalizeText(listing?.tradeTypeCode || listing?.lease_type || listing?.leaseType),
  );
  const rentMax = normalizeText(listing?.rent_amount) || "80";

  for (const raw of sourceCandidates) {
    const parsed = toUrl(raw);
    if (!parsed) continue;

    const hostname = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const hasArticleNo = Boolean(parseArticleNoFromUrl(parsed.toString()));

    if (hostname.includes("new.land.naver.com") && path.startsWith("/houses")) {
      const ms = readNaverQuery(parsed, "ms") || null;
      const houseA = readNaverQuery(parsed, "a") || DEFAULT_NAVER_A;
      const houseB = readNaverQuery(parsed, "b") || listingTrade;
      const houseD = readNaverQuery(parsed, "d") || rentMax;
      const finalUrl = buildNaverHouseUrl({
        articleNo: candidateArticleNo,
        ms,
        a: houseA,
        b: houseB,
        d: houseD,
        e: "RETAIL",
      });
      return finalUrl;
    }

    if (hostname.includes("fin.land.naver.com") && /\/articles\//.test(path) && hasArticleNo) {
      return parsed.toString();
    }

    if (hostname.includes("new.land.naver.com") && /(\/article\/|\/rooms\/)/.test(path)) {
      parsed.searchParams.set("articleNo", candidateArticleNo);
      return parsed.toString();
    }
  }

  const primary = toUrl(sourceCandidates.find(isHttpUrl));
  const sourceMs = primary ? readNaverQuery(primary, "ms") : "";

  if (sourceMs || listing?.lat || listing?.lng) {
    const ms = sourceMs || `${normalizeText(listing?.lat)},${normalizeText(listing?.lng)},16`;
    return buildNaverHouseUrl({
      articleNo: candidateArticleNo,
      ms,
      a: DEFAULT_NAVER_A,
      b: listingTrade,
      d: rentMax,
      e: "RETAIL",
    });
  }

  return `https://fin.land.naver.com/articles/${encodeURIComponent(candidateArticleNo)}`;
}

function resolveByPattern(platform, listing, sourceRef) {
  const sourceUrl = normalizeUrl(listing?.source_url);
  if (isHttpUrl(sourceUrl)) return sourceUrl;

  if (!sourceRef) return "";

  if (platform === "dabang") {
    return `https://www.dabangapp.com/room/${encodeURIComponent(sourceRef)}`;
  }
  if (platform === "zigbang") {
    return `https://sp.zigbang.com/share/oneroom/${encodeURIComponent(sourceRef)}?userNo=undefined&stamp=${Date.now()}`;
  }
  if (platform === "r114") {
    return `https://www.r114.com/?_c=memul&_m=p10&_a=goDetail&memulNo=${encodeURIComponent(sourceRef)}`;
  }
  if (platform === "peterpanz") {
    return `https://www.peterpanz.com/house/${encodeURIComponent(sourceRef)}`;
  }
  if (platform === "kbland") {
    return `https://www.kbland.kr/p/${encodeURIComponent(sourceRef)}`;
  }

  return "";
}

export function resolveExternalListingUrl(listing) {
  const platform = normalizePlatform(listing?.platform_code, listing?.platform);
  const sourceRef = normalizeText(
    listing?.source_ref ||
      listing?.external_id ||
      listing?.externalId ||
      listing?.sourceRef ||
      listing?.articleNo ||
      listing?.id,
  );

  if (platform === "naver") {
    return resolveNaver(listing, sourceRef);
  }

  return resolveByPattern(platform, listing, sourceRef);
}
