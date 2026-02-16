#!/usr/bin/env node

import fs from 'node:fs';
import { getArg } from './lib/cli_utils.mjs';

const args = process.argv.slice(2);

const DEFAULT_RULES = {
  weights: {
    address: 0.30,
    distance: 0.20,
    area: 0.25,
    price: 0.15,
    attribute: 0.10,
  },
  threshold: {
    autoMatch: 93,
    reviewRequiredMin: 80,
    conflictPenalty: 6,
  },
  area: {
    exclusiveRelativeTolerance: 0.06,
    grossToExclusiveMinRatio: 1.05,
    grossToExclusiveMaxRatio: 1.35,
    rangeOverlapMinRate: 0.1,
  },
  price: {
    rentTolerance: 0.08,
    depositTolerance: 0.12,
  },
  distance: {
    high: 20,
    medium: 80,
    low: 500,
  },
};

const inputPath = getArg(args, '--input', 'scripts/match_sample_input.json');
const outPath = getArg(args, '--out', null);
const rulesArg = getArg(args, '--rules', null);

const inputRaw = fs.readFileSync(inputPath, 'utf8');
const input = JSON.parse(inputRaw);
const listings = Array.isArray(input.listings) ? input.listings : [];
const rules = rulesArg ? { ...DEFAULT_RULES, ...JSON.parse(rulesArg) } : DEFAULT_RULES;

function n(v) {
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

function cleanText(v) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenMatchScore(a, b) {
  if (!a || !b) return 0;
  const pa = cleanText(a);
  const pb = cleanText(b);
  if (!pa || !pb) return 0;
  if (pa === pb) return 100;
  if (pa.includes(pb) || pb.includes(pa)) return 72;
  if (pa.slice(0, 6) === pb.slice(0, 6)) return 40;
  let same = 0;
  for (const tok of pa.split(' ')) if (pb.includes(tok) && tok.length >= 2) same += 1;
  return Math.min(60, same * 12 + 8);
}

function haversineDistanceMeters(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return null;
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const aa = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

function normalize(listing) {
  const addrCode = cleanText(listing.address_code || listing.addressCode || listing.address || '');
  return {
    id: listing.id || listing.listing_id || '',
    platformCode: cleanText(listing.platform_code || listing.platformCode || ''),
    externalId: String(listing.external_id || listing.externalId || ''),
    sourceUrl: cleanText(listing.source_url || listing.sourceUrl || ''),
    addressCode: addrCode,
    addressText: cleanText(listing.address_text || listing.addressText || ''),
    leaseType: cleanText(listing.lease_type || listing.leaseType || ''),
    rentAmount: n(listing.rent_amount ?? listing.rentAmount),
    depositAmount: n(listing.deposit_amount ?? listing.depositAmount),
    roomCount: n(listing.room_count ?? listing.roomCount),
    floor: n(listing.floor),
    totalFloor: n(listing.total_floor ?? listing.totalFloor),
    areaExclusiveMin: n(listing.area_exclusive_m2_min ?? listing.areaExclusiveMin),
    areaExclusiveMax: n(listing.area_exclusive_m2_max ?? listing.areaExclusiveMax),
    areaExclusive: n(listing.area_exclusive_m2 ?? listing.areaExclusive),
    areaGrossMin: n(listing.area_gross_m2_min ?? listing.areaGrossMin),
    areaGrossMax: n(listing.area_gross_m2_max ?? listing.areaGrossMax),
    areaGross: n(listing.area_gross_m2 ?? listing.areaGross),
    areaClaimed: cleanText(listing.area_claimed || listing.areaClaimed || 'exclusive'),
    lat: n(listing.lat),
    lng: n(listing.lng),
    priceBucket: null,
    areaBucket: null,
  };
}

function areaRange(listing) {
  const min = listing.areaExclusiveMin ?? listing.areaExclusive;
  const max = listing.areaExclusiveMax ?? listing.areaExclusive;
  const minG = listing.areaGrossMin ?? listing.areaGross;
  const maxG = listing.areaGrossMax ?? listing.areaGross;
  if (min !== null && max !== null && Number.isFinite(min) && Number.isFinite(max)) {
    return [Math.min(min, max), Math.max(min, max), 'exclusive'];
  }
  if (minG !== null && maxG !== null && Number.isFinite(minG) && Number.isFinite(maxG)) {
    return [Math.min(minG, maxG), Math.max(minG, maxG), 'gross'];
  }
  if (listing.areaExclusive !== null) return [listing.areaExclusive, listing.areaExclusive, 'exclusive'];
  if (listing.areaGross !== null) return [listing.areaGross, listing.areaGross, 'gross'];
  return null;
}

function overlapRate(a, b) {
  if (!a || !b) return 0;
  const left = Math.max(a[0], b[0]);
  const right = Math.min(a[1], b[1]);
  if (right < left) return 0;
  const overlap = right - left;
  const aLen = a[1] - a[0] || 1;
  const bLen = b[1] - b[0] || 1;
  return Math.max(0, overlap / Math.max(aLen, bLen));
}

function areaScore(a, b) {
  const ra = areaRange(a);
  const rb = areaRange(b);
  if (!ra || !rb) return { score: 20, detail: 'missing' };

  const scoreByRelative = (x, y, t) => {
    const base = Math.max(Math.abs(x), Math.abs(y), 1);
    const diff = Math.abs(x - y) / base;
    if (diff <= t) return 100;
    if (diff <= t * 1.8) return Math.round((1 - diff / (t * 1.8)) * 60);
    return Math.max(0, Math.round((1 - diff) * 20));
  };

  const arType = ra[2];
  const brType = rb[2];

  // exclusive vs exclusive
  if (arType === 'exclusive' && brType === 'exclusive') {
    const score = scoreByRelative(ra[0], rb[0], rules.area.exclusiveRelativeTolerance);
    return { score, detail: 'exclusive vs exclusive' };
  }

  // exclusive vs gross ratio guard
  if (arType !== brType) {
    const ex = arType === 'exclusive' ? ra[0] : rb[0];
    const gr = arType === 'gross' ? ra[0] : rb[0];
    const ratio = ex > 0 && gr > 0 ? ex / gr : 0;
    if (ratio >= rules.area.grossToExclusiveMinRatio && ratio <= rules.area.grossToExclusiveMaxRatio) {
      return { score: 92, detail: 'exclusive-gross ratio allowed' };
    }
  }

  // range overlap
  const overlap = overlapRate(ra, rb);
  if (overlap >= rules.area.rangeOverlapMinRate) {
    return { score: Math.round(75 + overlap * 25), detail: 'range overlap' };
  }

  return { score: 35, detail: 'no clear area rule match' };
}

function priceScore(a, b) {
  const rentA = a.rentAmount;
  const rentB = b.rentAmount;
  const depA = a.depositAmount;
  const depB = b.depositAmount;
  if (rentA === null && depA === null) return { score: 15, detail: 'both rent missing' };
  if (rentA === null || rentB === null) return { score: 30, detail: 'rent missing partial' };

  const base = Math.max(rentA, rentB, 1);
  const rentDiff = Math.abs(rentA - rentB) / base;
  let sRent = 100 - rentDiff / rules.price.rentTolerance * 45;
  sRent = Math.min(100, Math.max(30, sRent));

  if (depA !== null && depB !== null) {
    const baseDep = Math.max(depA, depB, 1);
    const depDiff = Math.abs(depA - depB) / baseDep;
    let sDep = 100 - depDiff / rules.price.depositTolerance * 30;
    sDep = Math.min(100, Math.max(20, sDep));
    return {
      score: Math.round((sRent * 0.7 + sDep * 0.3)),
      detail: `rent:${Math.round(sRent)} dep:${Math.round(sDep)}`,
    };
  }

  return { score: Math.round((sRent * 0.8 + 20)), detail: 'deposit missing' };
}

function attributeScore(a, b) {
  let score = 0;
  if (a.roomCount !== null && b.roomCount !== null) {
    const d = Math.abs(a.roomCount - b.roomCount);
    if (d === 0) score += 40;
    else if (d === 1) score += 25;
    else if (d === 2) score += 12;
  } else {
    score += 10;
  }

  if (a.floor !== null && b.floor !== null && a.totalFloor !== null && b.totalFloor !== null) {
    const d = Math.abs(a.floor - b.floor);
    const t = Math.max(a.totalFloor, b.totalFloor, 1);
    if (d === 0) score += 30;
    else if (d <= 1) score += 20;
    else if (d / t < 0.03) score += 12;
  } else {
    score += 10;
  }

  if (a.leaseType && b.leaseType && a.leaseType === b.leaseType) score += 30;
  return { score: Math.min(100, score), detail: 'room/floor/lease' };
}

function addressScore(a, b) {
  if (a.addressCode && b.addressCode) {
    if (a.addressCode === b.addressCode) return { score: 100, detail: 'address_code exact' };
    if (a.addressCode.slice(0, 8) === b.addressCode.slice(0, 8)) return { score: 70, detail: 'address_code prefix match' };
  }
  const sim = tokenMatchScore(a.addressText, b.addressText);
  return { score: sim, detail: 'address text sim' };
}

function distanceScore(a, b) {
  const dist = haversineDistanceMeters(a, b);
  if (dist === null) return { score: 30, detail: 'no coordinate' };
  if (dist <= rules.distance.high) return { score: 100, detail: `dist:${Math.round(dist)}m` };
  if (dist <= rules.distance.medium) {
    const ratio = 1 - (dist - rules.distance.high) / (rules.distance.medium - rules.distance.high);
    return { score: Math.round(90 + ratio * 10), detail: `dist:${Math.round(dist)}m` };
  }
  if (dist <= rules.distance.low) {
    const ratio = 1 - (dist - rules.distance.medium) / (rules.distance.low - rules.distance.medium);
    return { score: Math.round(45 + ratio * 45), detail: `dist:${Math.round(dist)}m` };
  }
  return { score: Math.max(0, Math.round(45 - (dist - rules.distance.low) / 20)), detail: `dist:${Math.round(dist)}m` };
}

function scorePair(a, b) {
  const aScore = addressScore(a, b);
  const dScore = distanceScore(a, b);
  const arScore = areaScore(a, b);
  const pScore = priceScore(a, b);
  const atScore = attributeScore(a, b);

  let score = aScore.score * rules.weights.address +
    dScore.score * rules.weights.distance +
    arScore.score * rules.weights.area +
    pScore.score * rules.weights.price +
    atScore.score * rules.weights.attribute;

  score = Math.round(Math.max(0, Math.min(100, score)));

  const sameListing = a.platformCode && b.platformCode && a.platformCode === b.platformCode && a.externalId && b.externalId && a.externalId === b.externalId;

  let status = 'DISTINCT';
  if (sameListing) {
    status = 'AUTO_MATCH';
  } else if (score >= rules.threshold.autoMatch) {
    status = 'AUTO_MATCH';
  } else if (score >= rules.threshold.reviewRequiredMin) {
    status = 'REVIEW_REQUIRED';
  }

  const reason = {
    address: aScore,
    distance: dScore,
    area: arScore,
    price: pScore,
    attribute: atScore,
    samePlatformExternal: sameListing,
    bucket: {
      areaBucketMatch: a.areaBucket === b.areaBucket,
      priceBucketMatch: a.priceBucket === b.priceBucket,
    },
  };

  return { score, status, reason };
}

function bucketize(listing) {
  const normalized = { ...listing };
  const area = n(listing.areaExclusive ?? listing.areaGross ?? null);
  if (area !== null) normalized.areaBucket = Math.max(0, Math.round(area / 2));
  const rent = n(listing.rentAmount ?? null);
  if (rent !== null) normalized.priceBucket = Math.max(0, Math.round(rent / 10));
  return normalized;
}

function candidateKeys(l) {
  const keys = new Set();
  const addr = l.addressCode || 'na';
  const rb = n(l.priceBucket);
  const ab = n(l.areaBucket);
  const addBucket = (r, a) => keys.add(`${addr}|r${r}|a${a}`);
  if (rb !== null && ab !== null) {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let da = -1; da <= 1; da += 1) {
        addBucket(rb + dr, ab + da);
      }
    }
  }
  keys.add(`${addr}|r*|a*`);
  return Array.from(keys);
}

function buildCandidates(items) {
  const normalized = items.map((x) => bucketize(normalize(x)));
  const buckets = new Map();
  normalized.forEach((l, idx) => {
    candidateKeys(l).forEach((key) => {
      const arr = buckets.get(key) || [];
      arr.push({ idx, l });
      buckets.set(key, arr);
    });
  });

  const seen = new Set();
  const pairs = [];
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a.l.id === b.l.id) continue;
        const idA = `${a.idx}:${b.idx}`;
        const idB = `${b.idx}:${a.idx}`;
        if (seen.has(idA) || seen.has(idB)) continue;
        seen.add(idA);
        const result = scorePair(a.l, b.l);
        const pair = {
          source_listing_id: a.l.id || a.l.externalId || `idx_${a.idx}`,
          target_listing_id: b.l.id || b.l.externalId || `idx_${b.idx}`,
          source_index: a.idx,
          target_index: b.idx,
          score: result.score,
          status: result.status,
          distance_score: result.reason.distance.score,
          address_score: result.reason.address.score,
          area_score: result.reason.area.score,
          price_score: result.reason.price.score,
          attribute_score: result.reason.attribute.score,
          reason_json: result.reason,
          source: a.l,
          target: b.l,
        };
        pairs.push(pair);
      }
    }
  }

  return { pairs, normalized };
}

function unionFind(itemsCount) {
  const p = Array.from({ length: itemsCount }, (_, i) => i);
  const r = Array.from({ length: itemsCount }, () => 1);
  const find = (x) => {
    let root = x;
    while (p[root] !== root) {
      p[root] = p[p[root]];
      root = p[root];
    }
    let current = x;
    while (p[current] !== root) {
      const parent = p[current];
      p[current] = root;
      current = parent;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (r[ra] < r[rb]) {
      p[ra] = rb;
      r[rb] += r[ra];
    } else {
      p[rb] = ra;
      r[ra] += r[rb];
    }
  };
  return { find, union };
}

function buildGroups(normalized, pairs) {
  const uf = unionFind(normalized.length);
  pairs.filter((p) => p.status === 'AUTO_MATCH').forEach((pair) => {
    uf.union(pair.source_index, pair.target_index);
  });
  const groups = new Map();
  for (let i = 0; i < normalized.length; i += 1) {
    const root = uf.find(i);
    const arr = groups.get(root) || [];
    arr.push({ index: i, listing: normalized[i].id || normalized[i].externalId || `idx_${i}` });
    groups.set(root, arr);
  }

  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members], idx) => ({
      group_id: `g_${idx + 1}`,
      canonical_key: `cg_${root}`,
      members: members.map((m) => m.listing),
      member_count: members.length,
      reason: 'auto_match_cluster',
    }));
}

// Export functions for testing
export {
  tokenMatchScore,
  haversineDistanceMeters,
  normalize,
  areaRange,
  areaScore,
  priceScore,
  attributeScore,
  addressScore,
  distanceScore,
  scorePair,
  buildCandidates,
  unionFind,
  buildGroups,
  DEFAULT_RULES,
};

// Only run CLI when executed directly
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  const result = (() => {
    const { pairs, normalized } = buildCandidates(listings);
    const autoMatch = pairs.filter((p) => p.status === 'AUTO_MATCH').length;
    const review = pairs.filter((p) => p.status === 'REVIEW_REQUIRED').length;
    const distinct = pairs.filter((p) => p.status === 'DISTINCT').length;
    const groups = buildGroups(normalized, pairs);
    return {
      run_id: input.run_id || `matcher_${Date.now()}`,
      generated_at: new Date().toISOString(),
      rules_snapshot: rules,
      input_summary: {
        count: normalized.length,
        candidate_pairs: pairs.length,
        auto_match: autoMatch,
        review_required: review,
        distinct,
        merged_groups: groups.length,
      },
      pairs: pairs.map((p) => {
        // remove large duplicates before output
        const { source, target, ...rest } = p;
        return rest;
      }),
      match_groups: groups,
    };
  })();

  console.log(JSON.stringify(result, null, 2));
  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
    console.error(`matcher output saved: ${outPath}`);
  }
  process.exit(0);
}
