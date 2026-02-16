#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { NaverListingAdapter } from './adapters/naver_listings_adapter.mjs';

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.findIndex((v) => v === name || v.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split('=').slice(1).join('=') ?? fallback;
}

const inputPath = getArg('--input', 'scripts/platform_sampling_targets.json');
const outPath = getArg('--out', 'scripts/platform_sampling_results.json');
function normalizeSampleCap(raw, fallback = 100) {
  const parsed = Number(raw);
  if (raw === null || raw === undefined || Number.isNaN(parsed)) return fallback;
  if (parsed < 0) return fallback;
  if (!Number.isFinite(parsed) || parsed === 0) return Number.POSITIVE_INFINITY;
  return Math.floor(parsed);
}
const sampleCap = normalizeSampleCap(getArg('--sample-cap', '100'));
const requestDelayMs = Number(getArg('--delay-ms', '700'));

const defaultRunMeta = {
  runId: `sampling_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
  createdAt: new Date().toISOString(),
  owner: 'my-rent-finder',
};
const naverStealthCache = new Map();
let naverDistrictCodes = null;

async function runCommand(command, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: timedOut ? null : code,
        signal,
        timedOut,
        stdout,
        stderr,
      });
    });
  });
}

function getNaverDistrictCode(sigungu) {
  if (!naverDistrictCodes) {
    try {
      naverDistrictCodes = JSON.parse(
        fs.readFileSync('scripts/naver_district_codes.json', 'utf8'),
      );
    } catch (err) {
      naverDistrictCodes = {};
      return null;
    }
  }
  const direct = naverDistrictCodes[asText(sigungu)] || naverDistrictCodes[String(sigungu).replace(/\s+/g, '').trim()];
  return direct || null;
}

function matchesNaverAdapterCandidate(item, queryHint = {}) {
  const targetSigungu = asText(queryHint.sigungu || queryHint.cortarNo || '');
  const targetSido = asText(queryHint.sido || '');
  const targetLeaseType = asText(queryHint.leaseType || '월세');
  const minArea = asLocaleInt(queryHint.minAreaM2, asLocaleInt(queryHint.minArea, null));
  const rentMax = asLocaleInt(queryHint.rentMax, null);
  const depositMax = asLocaleInt(queryHint.depositMax, null);
  const propertyTypes = Array.isArray(queryHint.propertyTypes) ? queryHint.propertyTypes.map((v) => asText(v)) : [];

  const addressText = asText(item.address_text || '');
  if (targetSigungu && addressText && !addressText.includes(targetSigungu)) {
    return false;
  }
  if (targetSido && addressText && !addressText.includes(targetSido)) {
    return false;
  }

  const area = item.area_exclusive_m2 ?? item.area_gross_m2;
  if (minArea !== null && area !== null && area < minArea) {
    return false;
  }

  if (targetLeaseType && item.lease_type && item.lease_type !== targetLeaseType) {
    return false;
  }
  if (rentMax !== null && item.rent_amount !== null && item.rent_amount > rentMax) {
    return false;
  }
  if (depositMax !== null && item.deposit_amount !== null && item.deposit_amount > depositMax) {
    return false;
  }

  if (propertyTypes.length > 0) {
    const text = asText([item.building_name, item.address_text, item.lease_type].filter(Boolean).join(' ')).toLowerCase();
    const wantVilla = propertyTypes.some((v) => /빌라|연립/.test(v));
    const wantSingle = propertyTypes.some((v) => /단독|다가구/.test(v));
    const hasVilla = /빌라|연립/.test(text);
    const hasSingle = /단독|다가구/.test(text);
    const typeMatched = (wantVilla && hasVilla) || (wantSingle && hasSingle);
    if (wantVilla || wantSingle) {
      if (!typeMatched) {
        return false;
      }
    }
  }
  return true;
}

function convertNaverAdapterItemToParsed(item) {
  const images = Array.isArray(item.image_urls) ? item.image_urls : [];
  const addressText = asText(item.address_text || 'MISSING');
  const areaClaimed = item.area_claimed || 'estimated';
  const areaRawText = asText([
    item.area_exclusive_m2,
    item.area_gross_m2,
    item.area_exclusive_m2_min,
    item.area_gross_m2_min,
  ].filter((v) => v !== null && v !== undefined).join(' '));

  const violations = Array.isArray(item.validation)
    ? item.validation
        .map((v) => (typeof v === 'string' ? v : v?.code))
        .filter(Boolean)
    : [];

  return {
    sourceUrl: item.source_url || '',
    raw: {
      title: asText(item.building_name || item.address_text || 'MISSING'),
      price: {
        monthly_rent: item.rent_amount ?? null,
        deposit: item.deposit_amount ?? null,
      },
      area: {
        area_type: areaClaimed,
        exclusive_m2: item.area_exclusive_m2 ?? null,
        gross_m2: item.area_gross_m2 ?? null,
        area_exclusive_m2_min: item.area_exclusive_m2_min ?? null,
        area_exclusive_m2_max: item.area_exclusive_m2_max ?? null,
        area_gross_m2_min: item.area_gross_m2_min ?? null,
        area_gross_m2_max: item.area_gross_m2_max ?? null,
        area_raw: areaRawText,
      },
      address: {
        address_raw: addressText,
        sido: '',
        sigungu: '',
        dong: '',
      },
      building: {
        floor: item.floor ?? null,
        total_floor: item.total_floor ?? null,
      },
      unit: {
        room_count: item.room_count ?? null,
        bathroom_count: item.bathroom_count ?? null,
      },
      listing_type: item.listing_type || item.lease_type || '월세',
      images,
      raw_text: `${addressText} ${asText(item.building_name)} ${asText(item.lease_type)} ${asText(item.address_code)}`.trim(),
    },
    normalized: {
      area_exclusive_m2: item.area_exclusive_m2 ?? null,
      area_exclusive_m2_min: item.area_exclusive_m2_min ?? null,
      area_exclusive_m2_max: item.area_exclusive_m2_max ?? null,
      area_gross_m2: item.area_gross_m2 ?? null,
      area_gross_m2_min: item.area_gross_m2_min ?? null,
      area_gross_m2_max: item.area_gross_m2_max ?? null,
      area_claimed: areaClaimed,
      address_text: addressText,
      address_code: item.address_code || hashAddressCode(addressText),
      rent_amount: item.rent_amount ?? null,
      deposit_amount: item.deposit_amount ?? null,
      room_count: item.room_count ?? null,
      floor: item.floor ?? null,
      total_floor: item.total_floor ?? null,
      lease_type: item.lease_type || '기타',
      quality_flags: violations,
      sido: '',
      sigungu: '',
      dong: '',
    },
    requiredFields: Boolean(addressText && (item.rent_amount !== null || item.deposit_amount !== null) && (item.area_exclusive_m2 !== null || item.area_gross_m2 !== null)),
    violations: violations,
    area_raw: areaRawText,
  };
}

async function collectNaverStealthCandidate(queryHint = {}, sourceUrl = '') {
  const pageInfo = {
    status: null,
    parse_error: null,
    sample_status: null,
    note: '',
    fetchedAt: new Date().toISOString(),
    rawHash: null,
  };

  const targetSigungu = asText(queryHint.sigungu || '노원구');
  const cacheKey = [
    targetSigungu,
    queryHint.leaseType || '월세',
    asLocaleInt(queryHint.rentMax, 80),
    asLocaleInt(queryHint.depositMax, 6000),
    asLocaleInt(queryHint.minAreaM2, 40),
  ].join('|');

  const cached = naverStealthCache.get(cacheKey);
  if (cached) {
    pageInfo.note = cached.pageInfo.note || 'naver_stealth_cache_hit';
    return {
      parsed: cached.parsed,
      pageInfo: {
        ...pageInfo,
        ...cached.pageInfo,
        sample_status: cached.parsed ? 'SUCCESS' : 'FAILED',
      },
    };
  }

  const rentMax = asLocaleInt(queryHint.rentMax, 80);
  const depositMax = asLocaleInt(queryHint.depositMax, 6000);
  const minArea = asLocaleInt(queryHint.minAreaM2, 40);
  const leaseType = asText(queryHint.leaseType || '월세');
  const districtCode = getNaverDistrictCode(targetSigungu);
  if (!districtCode) {
    pageInfo.parse_error = 'NAVER_DISTRICT_NOT_FOUND';
    pageInfo.sample_status = 'FAILED';
    return { parsed: null, pageInfo };
  }

  if (!districtCode) {
    pageInfo.parse_error = 'NAVER_DISTRICT_NOT_FOUND';
    pageInfo.sample_status = 'FAILED';
    return { parsed: null, pageInfo };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rent-naver-stealth-'));
  const rawPath = path.join(tmpDir, 'naver_raw.jsonl');
  const metaPath = path.join(tmpDir, 'naver_capture_meta.json');
  const outputPrefix = districtCode ? `cut_${districtCode}` : `sig_${targetSigungu}`;
  const autoArgs = [
    path.resolve(process.cwd(), 'scripts/naver_auto_collector.mjs'),
    '--sigungu',
    targetSigungu,
    '--sample-cap',
    String(2),
    '--rent-max',
    String(rentMax),
    '--deposit-max',
    String(depositMax),
    '--min-area',
    String(minArea),
    '--filter-probe',
    '--filter-probe-delay-ms',
    '900',
    '--output-raw',
    rawPath,
    '--output-meta',
    metaPath,
    '--headless',
  ];

  const collectTradeType = leaseType.includes('전세') ? 'B1' : leaseType.includes('매매') ? 'A1' : 'B2';
  autoArgs.push('--trade-type', collectTradeType);

  pageInfo.note = `naver_stealth_collect:${outputPrefix}`;
  let runResult;
  try {
    runResult = await runCommand(process.execPath, autoArgs, 240000);
  } catch (err) {
    pageInfo.parse_error = `NAVER_AUTO_RUN_ERROR:${err?.message || String(err)}`;
    pageInfo.sample_status = 'FAILED';
    return { parsed: null, pageInfo };
  }

  if (runResult.timedOut || runResult.code !== 0) {
    pageInfo.parse_error = `NAVER_AUTO_EXIT_${runResult.code || 'TIMEOUT'}`;
    pageInfo.sample_status = 'FAILED';
    return { parsed: null, pageInfo };
  }

  if (!fs.existsSync(rawPath)) {
    pageInfo.parse_error = 'NAVER_RAW_NOT_FOUND';
    pageInfo.sample_status = 'FAILED';
    return { parsed: null, pageInfo };
  }

  const adapter = new NaverListingAdapter({ leaseTypeFilter: leaseType, maxCandidates: 12000 });
  const normalized = await adapter.normalizeFromRawFile(rawPath, { maxItems: 20, includeRaw: true });
  const candidates = Array.isArray(normalized.items) ? normalized.items : [];
  if (candidates.length === 0) {
    pageInfo.parse_error = 'NAVER_NO_ITEMS';
    pageInfo.sample_status = 'FAILED';
    return { parsed: null, pageInfo };
  }

  const matched = candidates.find((item) => matchesNaverAdapterCandidate(item, queryHint)) || candidates[0];
  const parsed = convertNaverAdapterItemToParsed(matched);
  if (!parsed.requiredFields) {
    pageInfo.parse_error = 'required_field_missing';
    pageInfo.sample_status = 'FAILED';
  } else {
    pageInfo.sample_status = 'SUCCESS';
    pageInfo.parse_error = null;
  }
  pageInfo.status = 200;
  pageInfo.rawHash = simpleHash(targetSigungu + rawPath);
  pageInfo.fetchedAt = new Date().toISOString();
  pageInfo.note = `naver_stealth_ok:${matched?.external_id || matched?.source_ref || 'unknown'}`;

  const result = { parsed, pageInfo };
  if (parsed) {
    naverStealthCache.set(cacheKey, result);
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbsoluteUrl(v) {
  return /^https?:\/\//i.test(v || '');
}

function asText(v) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(v) {
  if (v === null || v === undefined) return null;
  const raw = String(v).trim().replace(/,/g, '');
  if (!raw || /협의|문의|상담|문의요청/.test(raw)) return null;

  const unitA = /([0-9]+(?:\.[0-9]+)?)\s*억/.exec(raw);
  if (unitA) {
    const 억 = Number(unitA[1]);
    const 만단위 = /([0-9]+(?:\.[0-9]+)?)\s*천/.exec(raw);
    const 만 = 만단위 ? Number(만단위[1]) : 0;
    return Number.isFinite(억 * 10000 + 만) ? 억 * 10000 + 만 : null;
  }

  const unitM = /([0-9]+(?:\.[0-9]+)?)\s*만/.exec(raw);
  if (unitM) {
    const 만 = Number(unitM[1]);
    return Number.isFinite(만) ? 만 : null;
  }

  const unitB = /([0-9]+(?:\.[0-9]+)?)/.exec(raw);
  if (!unitB) return null;
  const num = Number(unitB[1]);
  return Number.isFinite(num) ? num : null;
}

function toMetersArea(v, unit) {
  const num = toNumber(v);
  if (num === null) return null;
  if (unit === '평') return num * 3.3058;
  return num;
}

function hashAddressCode(address) {
  const base = asText(address).replace(/\s+/g, '');
  if (!base) return null;
  let acc = 2166136261 >>> 0;
  for (let i = 0; i < base.length; i += 1) {
    acc ^= base.charCodeAt(i);
    acc = Math.imul(acc, 16777619);
  }
  const numeric = String((acc >>> 0) % 900000000).padStart(9, '0');
  return `11${numeric}`;
};

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function extractMeta(html, prop) {
  const m = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i').exec(html);
  return m ? m[1].trim() : '';
}

function extractTitle(html) {
  const og = extractMeta(html, 'og:title');
  if (og) return og;
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return asText(t ? t[1] : '');
}

function extractImageUrls(html) {
  const urls = [];
  const set = new Set();
  const re = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s"'<>]*)?/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = m[0];
    if (!set.has(u)) {
      set.add(u);
      urls.push(u);
    }
  }
  const og = extractMeta(html, 'og:image');
  if (og && !set.has(og)) {
    urls.unshift(og);
    set.add(og);
  }
  return urls;
}

function normalizeAddress(raw) {
  const v = asText(raw);
  if (!v) return { address_raw: '', sido: '', sigungu: '', dong: '', address_code: null };
  const sidoMatch = /(서울(?:특별시)?)/.exec(v);
  const guMatch = /(강남구|서초구|강북구|마포구|영등포구|송파구|성북구|종로구|중구|중랑구|강서구|동대문구|노원구|성동구|도봉구|양천구|강동구|광진구|관악구|구로구|금천구|동작구|은평구|용산구|종로구|강동구|서대문구|용산구|중구)/.exec(v);
  const dongMatch = /([가-힣]+동)/.exec(v);
  return {
    address_raw: v,
    sido: sidoMatch ? sidoMatch[1] : '서울',
    sigungu: guMatch ? guMatch[1] : '',
    dong: dongMatch ? dongMatch[1] : '',
    address_code: hashAddressCode(v),
  };
}

function parseRentDeposit(rawText, listingTypeHint = '') {
  if (!rawText) return { monthlyRent: null, deposit: null };
  const t = rawText.replace(/,/g, '');
  const typeHint = asText(listingTypeHint).toUpperCase();
  const isMonthlyRent = typeHint.includes('MONTHLY_RENT') || typeHint.includes('월세') || typeHint.includes('월세매물');

  const wMatch = /(월세)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:만원)?/.exec(t) ||
    /(월세\s*)?([0-9]+(?:\.[0-9]+)?)\s*만원/.exec(t) ||
    /([0-9]+(?:\.[0-9]+)?)\s*만\s*원/.exec(t);
  const dMatch = /(보증금)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:만원)?/.exec(t) ||
    /(보증금\s*)?([0-9]+(?:\.[0-9]+)?)\s*만/.exec(t);

  let monthly = wMatch ? toNumber(wMatch[2] || wMatch[1]) : null;
  let deposit = dMatch ? toNumber(dMatch[2] || dMatch[1]) : null;

  if (monthly === null && deposit === null) {
    const slash = /([0-9]+(?:\.[0-9]+)?)\s*[\/|]\s*([0-9]+(?:\.[0-9]+)?)/.exec(t);
    if (slash) {
      const first = toNumber(slash[1]);
      const second = toNumber(slash[2]);
      if (first !== null && second !== null) {
        if (isMonthlyRent) {
          // 다방/네이버 스타일: 보증금/월세
          deposit = first;
          monthly = second;
        } else {
          monthly = first;
          deposit = second;
        }
      }
    }
  }

  return { monthlyRent: monthly, deposit };
}

function parseArea(rawText) {
  const text = asText(rawText);
  if (!text) return { area: { exclusive_m2: null, gross_m2: null, area_type: 'estimated' }, area_raw: '' };
  const normalizeAreaUnit = (unit) => {
    const u = asText(unit).toLowerCase().replace(/\s+/g, '');
    if (u === 'm2' || u === 'm²' || u === '㎡') return '㎡';
    if (u === '평') return '평';
    return '㎡';
  };
  const exclusive = /전용(?:면적)?\s*([0-9]+(?:\.[0-9]+)?)(?:\s*~\s*([0-9]+(?:\.[0-9]+)?))?\s*(㎡|m²|m2|㎡|평)/i.exec(text);
  const gross = /공용(?:면적)?\s*([0-9]+(?:\.[0-9]+)?)(?:\s*~\s*([0-9]+(?:\.[0-9]+)?))?\s*(㎡|m²|m2|㎡|평)/i.exec(text);
  const fallback = /([0-9]+(?:\.[0-9]+)?)(?:\s*~\s*([0-9]+(?:\.[0-9]+)?))?\s*(㎡|m²|m2|㎡|평)/i.exec(text);
  const makeRange = (m) => {
    if (!m) return { min: null, max: null, unit: '㎡' };
    const unit = normalizeAreaUnit(m[3] || '㎡');
    const min = toMetersArea(m[1], unit);
    const max = m[2] ? toMetersArea(m[2], unit) : null;
    return { min, max, unit };
  };

  const e = makeRange(exclusive || fallback);
  const g = makeRange(gross);
  let areaType = 'estimated';
  let exclusiveM2 = null;
  let grossM2 = null;
  if (exclusive) {
    exclusiveM2 = e.min;
    areaType = 'exclusive';
  } else if (gross) {
    grossM2 = g.min;
    areaType = 'gross';
  } else if (fallback) {
    exclusiveM2 = e.min;
    areaType = 'estimated';
  }
  return {
    area: {
      area_type: areaType,
      exclusive_m2: exclusiveM2,
      gross_m2: grossM2,
      area_exclusive_m2_min: e.min ?? null,
      area_exclusive_m2_max: e.max ?? null,
      area_gross_m2_min: g.min ?? null,
      area_gross_m2_max: g.max ?? null,
    },
    area_raw: text.match(/(?:[0-9]+(?:\.[0-9]+)?(?:\s*~\s*[0-9]+(?:\.[0-9]+)?)?\s*(?:㎡|m²|m2|㎡|평))/g)?.[0] || '',
  };
}

function parseFloor(text) {
  const t = asText(text);
  const pair = /(\d+)\s*\/\s*(\d+)\s*층/.exec(t) || /(\d+)\s*층\/(\d+)\s*층/.exec(t);
  if (pair) return { floor: Number(pair[1]), total_floor: Number(pair[2]) };
  const total = /총\s*(\d+)\s*층/.exec(t);
  const floor = /(\d+)\s*층/.exec(t);
  return {
    floor: floor ? Number(floor[1]) : null,
    total_floor: total ? Number(total[1]) : null,
  };
}

function parseRoom(rawText) {
  const t = asText(rawText);
  if (/원룸/.test(t)) return 1;
  if (/투룸/.test(t)) return 2;
  if (/쓰리룸|3룸/.test(t)) return 3;
  if (/오피스텔|오픈형|오픈/.test(t)) return 2;
  const m = /([1-5])룸/.exec(t);
  return m ? Number(m[1]) : null;
}

function normalizeToAbsoluteList(value) {
  const out = [];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    if (item && typeof item === 'object') {
      const candidates = collectDedupeList([
        item.url,
        item.urls,
        item.image,
        item.imageUrl,
        item.image_url,
        item.thumb,
        item.thumbnail,
        item.images,
      ]);
      if (candidates.length) out.push(...candidates);
    }
  }
  return dedupeStrings(out);
}

const BLOCK_TEXT_PATTERNS = /(captcha|차단|blocked|access denied|forbidden|403|429|너무 많은|요청이 차단|비정상적인 접근|권한이 없습니다|서비스 이용을 제한|무단으로 수집|봇|bot|자동화|스크래핑|정보통신망법)/i;

function isBlockedContent(rawText) {
  const text = asText(rawText).toLowerCase();
  return BLOCK_TEXT_PATTERNS.test(text);
}

function findValueByKey(node, keyRegex, maxDepth = 7, currentDepth = 0, seen = new Set()) {
  if (!node || currentDepth > maxDepth) return null;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return null;
  if (typeof node !== 'object') return null;
  if (seen.has(node)) return null;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      const direct = findValueByKey(item, keyRegex, maxDepth, currentDepth + 1, seen);
      if (direct !== null) return direct;
    }
    return null;
  }

  for (const [k, v] of Object.entries(node)) {
    if (!k) continue;
    if (keyRegex.test(String(k))) {
      if (v === null || v === undefined) continue;
      const direct = asText(v);
      if (direct) return direct;
      if (typeof v === 'object') {
        const nested = findValueByKey(v, keyRegex, maxDepth, currentDepth + 1, seen);
        if (nested !== null) return nested;
      }
    }
  }

  for (const v of Object.values(node)) {
    const nested = findValueByKey(v, keyRegex, maxDepth, currentDepth + 1, seen);
    if (nested !== null) return nested;
  }
  return null;
}

function collectValuesByKey(node, keyRegex, out = new Set(), maxDepth = 7, currentDepth = 0, seen = new Set(), limit = 80) {
  if (!node || currentDepth > maxDepth || out.size >= limit) return out;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    const v = asText(node);
    if (v) out.add(v);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (seen.has(node)) return out;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      collectValuesByKey(item, keyRegex, out, maxDepth, currentDepth + 1, seen, limit);
      if (out.size >= limit) return out;
    }
    return out;
  }

  for (const [k, v] of Object.entries(node)) {
    if (keyRegex.test(String(k))) {
      if (typeof v === 'string' || typeof v === 'number') {
        const n = asText(v);
        if (n) out.add(n);
      } else if (Array.isArray(v) || (v && typeof v === 'object')) {
        collectValuesByKey(v, /.*/, out, maxDepth, currentDepth + 1, seen, limit);
      }
    } else {
      collectValuesByKey(v, keyRegex, out, maxDepth, currentDepth + 1, seen, limit);
    }
    if (out.size >= limit) return out;
  }
  return out;
}

function extractJsonPayloadObjects(html) {
  const payloads = [];
  const src = String(html || '');
  const ldTagRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = null;
  while ((match = ldTagRe.exec(src))) {
    const parsed = safeJsonParse(match[1]);
    if (parsed) payloads.push(parsed);
  }

  const nextTagRe = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = nextTagRe.exec(src))) {
    const parsed = safeJsonParse(match[1]);
    if (parsed) payloads.push(parsed);
  }

  const nuxtTagRe = /<script[^>]*>\s*window\.__NUXT__\s*=\s*({[\s\S]*?});?\s*<\/script>/gi;
  while ((match = nuxtTagRe.exec(src))) {
    const parsed = safeJsonParse(match[1]);
    if (parsed) payloads.push(parsed);
  }

  const stateTagRe = /<script[^>]*>\s*window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/gi;
  while ((match = stateTagRe.exec(src))) {
    const parsed = safeJsonParse(match[1]);
    if (parsed) payloads.push(parsed);
  }

  return payloads;
}

function extractListingFromEmbeddedPayload(html) {
  const payloads = extractJsonPayloadObjects(html);
  if (!payloads.length) return null;

  for (const payload of payloads) {
    const title = asText(firstDefined(
      findValueByKey(payload, /title|name|headline|subject|roomTitle|articleTitle/i),
      findValueByKey(payload, /property_name|apt_name|house_name|itemName/i),
    ));
    const addressText = asText(firstDefined(
      findValueByKey(payload, /fullAddress|주소|address_text|addressText|address|address1|addrText|addr|address1_kr|주소_텍스트/i),
      findValueByKey(payload, /sido|sigungu|gu|dong|읍면동|dongNm/i),
    ));
  const rentText = asText(findValueByKey(payload, /월세|rentPrice|monthRent|monthlyRent|rent|월세금액/i));
  const depositText = asText(findValueByKey(payload, /보증금|depositPrice|deposit|deposite|jeonse|전세금/i));
  const listingTypeHint = asText(findValueByKey(payload, /priceType|tradeType|trade_type|listing_type|type|leaseType/i));
  const combinedPrice = asText([rentText, depositText].filter(Boolean).join('\n'));
  const price = parsePriceFallback(combinedPrice, title, listingTypeHint);
    const areaText = asText(firstDefined(
      findValueByKey(payload, /전용면적|공용면적|공급면적|area_text|areaText|sizeText|area|exclusiveArea|grossArea|areaExclusive|areaGross/i),
      findValueByKey(payload, /exclusive_area|gross_area|area_m2|areaM2/i),
    ));
    const areaParse = parseArea(areaText);
    const unitAreaText = asText(findValueByKey(payload, /exclusiveArea|areaExclusive|size_exclusive|size_gross|size|area_m2|areaM2|area_m2m|m2|㎡/i));
    const areaFromNumeric = parseArea(unitAreaText);
    const address = normalizeAddress(addressText || title);
    const floorText = asText(findValueByKey(payload, /floor|층|총층|total_floor|층수/i));
    const roomCountText = asText(findValueByKey(payload, /roomCount|room_count|방수|roomType|룸수|구조/i));
    const roomCount = parseRoom(roomCountText || title);
    const imageCandidates = Array.from(collectValuesByKey(payload, /image|img|photo|thumbnail|thumb/i, new Set(), 7, 0, new Set(), 25));
    const images = dedupeStrings([
      ...normalizeToAbsoluteList(imageCandidates),
      ...extractImageUrls(html).slice(0, 8),
    ]);
    const hasAnySignal = /원룸|투룸|빌라|연립|다가구|단독|오피스텔|월세|보증금|m2|㎡|㎡|평/i.test(`${title} ${addressText} ${areaText} ${rentText} ${depositText}`);
    if (!hasAnySignal) {
      continue;
    }

    return {
      title: title || 'MISSING',
      monthly_rent: price.monthlyRent,
      deposit: price.deposit,
      exclusive_m2: areaParse.area.exclusive_m2 ?? areaFromNumeric.area.exclusive_m2 ?? null,
      gross_m2: areaParse.area.gross_m2 ?? areaFromNumeric.area.gross_m2 ?? null,
      area_type: areaParse.area.area_type || 'estimated',
      area_raw: areaParse.area_raw || unitAreaText,
      address_text: address.address_raw,
      sido: address.sido,
      sigungu: address.sigungu,
      dong: address.dong,
      address_code: address.address_code,
      floor: parseFloor(floorText).floor,
      total_floor: parseFloor(floorText).total_floor,
      room_count: roomCount,
      bathroom_count: null,
      listing_type: /오피스텔|빌라|연립|단독|다가구|원룸|투룸|쓰리룸/.test(title) ? parseRoom(title) ? '원룸/투룸' : '월세' : '월세',
      images,
      area_raw_text: areaText,
    };
  }

  return null;
}

function buildParsedFromRawFields(sourceUrl, raw) {
  return buildParsedRecord(sourceUrl, {
    title: raw?.title || 'MISSING',
    monthly_rent: raw?.monthly_rent,
    deposit: raw?.deposit,
    exclusive_m2: raw?.exclusive_m2,
    gross_m2: raw?.gross_m2,
    area_type: raw?.area_type || 'estimated',
    area_exclusive_m2_min: raw?.area_exclusive_m2_min,
    area_exclusive_m2_max: raw?.area_exclusive_m2_max,
    area_gross_m2_min: raw?.area_gross_m2_min,
    area_gross_m2_max: raw?.area_gross_m2_max,
    area_raw: raw?.area_raw || raw?.area_raw_text || '',
    address_text: raw?.address_text || '',
    sido: raw?.sido || '서울',
    sigungu: raw?.sigungu || '',
    dong: raw?.dong || '',
    address_code: raw?.address_code || null,
    floor: raw?.floor ?? null,
    total_floor: raw?.total_floor ?? null,
    room_count: raw?.room_count ?? null,
    bathroom_count: raw?.bathroom_count ?? null,
    listing_type: raw?.listing_type || '월세',
    images: raw?.images || [],
    raw_text: raw?.raw_text || '',
  });
}

function parsePriceFallback(listingText, title, listingTypeHint = '') {
  const combined = [listingText, title].filter(Boolean).join('\n');
  return parseRentDeposit(combined, listingTypeHint);
}

function parseListing(platform, html, sourceUrl) {
  if (isBlockedContent(html)) {
    const violations = ['SOURCE_BLOCKED_CONTENT'];
    return {
      sourceUrl,
      raw: {
        title: 'MISSING',
        price: { monthly_rent: null, deposit: null },
        area: {
          area_type: 'estimated',
          exclusive_m2: null,
          gross_m2: null,
          area_exclusive_m2_min: null,
          area_exclusive_m2_max: null,
          area_gross_m2_min: null,
          area_gross_m2_max: null,
          area_raw: '',
        },
        address: {
          address_raw: '',
          sido: '',
          sigungu: '',
          dong: '',
        },
        building: { floor: null, total_floor: null },
        unit: { room_count: null, bathroom_count: null },
        listing_type: null,
        images: [],
        raw_text: '',
      },
      normalized: {
        area_exclusive_m2: null,
        area_exclusive_m2_min: null,
        area_exclusive_m2_max: null,
        area_gross_m2: null,
        area_gross_m2_min: null,
        area_gross_m2_max: null,
        address_text: '',
        address_code: null,
        rent_amount: null,
        deposit_amount: null,
        room_count: null,
        floor: null,
        total_floor: null,
        lease_type: '기타',
        quality_flags: violations,
      },
      requiredFields: false,
      violations,
      area_raw: '',
    };
  }

  const embeddedParsed = extractListingFromEmbeddedPayload(html);
  if (embeddedParsed && embeddedParsed.title !== 'MISSING') {
    const parsed = buildParsedFromRawFields(sourceUrl, embeddedParsed);
    if (parsed?.requiredFields) {
      return parsed;
    }
  }

  const rawText = asText(html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const title = asText(extractTitle(html));
  const images = extractImageUrls(html).slice(0, 20);

  const addressObj = normalizeAddress(
    /주소\s*[:：]?\s*([^\n\r]+)/.exec(rawText)?.[1] ||
    /([가-힣]+시\s*[가-힣]+구\s*[가-힣0-9-]+동\s*[0-9-]*)/.exec(rawText)?.[1] ||
    title
  );

  const priceFromText = parsePriceFallback(rawText, title);
  const areaParse = parseArea(rawText);
  const floorParse = parseFloor(rawText);
  const roomCount = parseRoom(rawText) ?? parseRoom(title);

  return buildParsedFromRawFields(sourceUrl, {
    title: title || 'MISSING',
    monthly_rent: priceFromText.monthlyRent,
    deposit: priceFromText.deposit,
    area_type: areaParse.area.area_type,
    exclusive_m2: areaParse.area.exclusive_m2,
    gross_m2: areaParse.area.gross_m2,
    area_exclusive_m2_min: areaParse.area.area_exclusive_m2_min,
    area_exclusive_m2_max: areaParse.area.area_exclusive_m2_max,
    area_gross_m2_min: areaParse.area.area_gross_m2_min,
    area_gross_m2_max: areaParse.area.area_gross_m2_max,
    area_raw: areaParse.area_raw,
    address_text: addressObj.address_raw,
    sido: addressObj.sido,
    sigungu: addressObj.sigungu,
    dong: addressObj.dong,
    floor: floorParse.floor,
    total_floor: floorParse.total_floor,
    room_count: roomCount,
    listing_type: /원룸/.test(rawText) ? '원룸' : /투룸/.test(rawText) ? '투룸' : '월세',
    images,
    raw_text: asText(rawText.slice(0, 1200)),
  });

}

function summarizeViolationCount(violations) {
  return violations.length > 0;
}

function buildSample(platform, target, parsed, pageInfo) {
  const row = {
    sample_status: pageInfo.sample_status || (pageInfo.parse_error ? 'FAILED' : 'SUCCESS'),
    source_id: target.source_id || target.id || '',
    source_url: target.source_url || '',
    mode: target.mode || 'STEALTH_AUTOMATION',
    requiredFields: parsed.requiredFields ? 'Y' : 'N',
    rent_raw: `${parsed.raw.price.monthly_rent ?? ''}`,
    rent_norm: parsed.raw.price.monthly_rent,
    deposit_raw: `${parsed.raw.price.deposit ?? ''}`,
    deposit_norm: parsed.raw.price.deposit,
    area_raw: parsed.area_raw || '',
    area_type: parsed.raw.area.area_type || 'estimated',
    area_norm_m2: parsed.normalized.area_exclusive_m2 ?? parsed.normalized.area_gross_m2 ?? null,
    address_raw: parsed.raw.address.address_raw || '',
    address_norm_code: parsed.normalized.address_code || null,
    room_count: parsed.normalized.room_count ?? null,
    floor: parsed.normalized.floor ?? null,
    total_floor: parsed.normalized.total_floor ?? null,
    images_cnt: parsed.raw.images.length,
    images_valid_cnt: safeArray(parsed.raw.images).filter((u) => isAbsoluteUrl(u)).length,
    images_duplicate_cnt: Math.max(0, parsed.raw.images.length - new Set(parsed.raw.images).size),
    contract_violations: summarizeViolationCount(parsed.violations),
    parse_error: pageInfo.parse_error || (!parsed.requiredFields && 'required_field_missing'),
    sample_note: pageInfo.note || '',
    sample_platform: platform,
    http_status: pageInfo.status,
    fetched_at: pageInfo.fetchedAt,
    collected_mode: target.mode || 'STEALTH_AUTOMATION',
    raw_hash_preview: pageInfo.rawHash,
  };
  return row;
}

function simpleHash(v) {
  const raw = String(v || '');
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) {
    h = (h * 131 + raw.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const STEALTH_HOME_BY_CODE = {
  zigbang: 'https://www.zigbang.com',
  dabang: 'https://www.dabangapp.com',
  naver: 'https://new.land.naver.com',
  r114: 'https://www.r114.com',
  peterpanz: 'https://www.peterpanz.com',
  nemo: 'https://www.nemoapp.kr',
  hogangnono: 'https://hogangnono.com',
};

function safeDecodeURIComponent(raw) {
  if (typeof raw !== 'string') return '';
  if (!raw.includes('%')) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function normalizeMoneyValue(v) {
  const num = toLocaleInt(v, null);
  if (num === null) return null;
  // Peterpanz filter values are mostly in KRW(원), while query hints use 만원.
  // Treat values above a 6-digit manwon threshold as KRW and normalize to 만원.
  return num > 100000 ? Math.floor(num / 10000) : num;
}

function normalizeKoreanWonAsMan(v) {
  const num = toNumberOrNull(v);
  if (num === null) return null;
  if (num >= 100000) return Math.floor(num / 10000);
  return num;
}

function buildPeterpanzSeedUrlFromQueryHint(queryHint = {}, home = '') {
  const { query } = buildPeterpanzFilterFilterFromHint(queryHint, '');
  const baseUrl = `${(home || 'https://www.peterpanz.com').replace(/\/$/, '')}/villa`;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined || v === '') continue;
    params.set(k, String(v));
  }
  if (!params.size) {
    return baseUrl;
  }
  return `${baseUrl}?${params.toString()}`;
}

function buildPeterpanzCenterFromFilter(filter = '') {
  try {
    const parsed = safeJsonParse(filter);
    if (parsed && typeof parsed === 'object' && parsed !== null) {
      return {
        y: toLocaleInt(parsed.y, 37.566628),
        _lat: toLocaleInt(parsed._lat, 37.566628),
        x: toLocaleInt(parsed.x, 126.978038),
        _lng: toLocaleInt(parsed._lng, 126.978038),
      };
    }
  } catch {}

  return {
    y: 37.566628,
    _lat: 37.566628,
    x: 126.978038,
    _lng: 126.978038,
  };
}

function extractPeterpanzDongFromParent(parentText = '') {
  const text = asText(parentText).trim();
  if (!text) return '';
  const parts = text.split(/\s+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const candidate = parts[i];
    if (/동$/.test(candidate) || /읍$/.test(candidate) || /면$/.test(candidate)) {
      return candidate;
    }
  }
  return parts.length ? parts[parts.length - 1] : '';
}

function resolvePeterpanzApiHost(home = '') {
  try {
    const baseHost = new URL(home || 'https://www.peterpanz.com').hostname.toLowerCase();
    return baseHost.includes('peterpanz.com') ? 'https://api.peterpanz.com' : home || 'https://www.peterpanz.com';
  } catch {
    return 'https://api.peterpanz.com';
  }
}

async function collectPeterpanzDongCandidates(home = '', queryHint = {}, sourceUrl = '') {
  const explicit = asText(queryHint.dong || parsePeterpanzSourceUrl(sourceUrl).dong || '');
  if (explicit) return [explicit];

  const gungu = asText(queryHint.gungu || queryHint.sigungu || '');
  if (!gungu) return [];

  const filterInfo = buildPeterpanzFilterFilterFromHint(queryHint, sourceUrl);
  const center = buildPeterpanzCenterFromFilter(filterInfo.query.center);

  const host = resolvePeterpanzApiHost(home);
  const regionParams = new URLSearchParams();
  regionParams.set('zoomLevel', '16');
  regionParams.set('center', JSON.stringify({
    y: center.y,
    _lat: center._lat,
    x: center.x,
    _lng: center._lng,
  }));
  regionParams.set('dong', '');
  regionParams.set('gungu', gungu);
  if (filterInfo.query.filter) {
    regionParams.set('filter', filterInfo.query.filter);
  }
  regionParams.set('filter_version', '5.1');

  const regionUrl = `${host}/getRegionV2?${regionParams.toString()}`;

  try {
    const region = await fetchJsonPayload(regionUrl);
    if (!region.ok || !Array.isArray(region.payload)) return [];

    const seen = new Set();
    const dongCandidates = [];
    for (const item of region.payload) {
      const parent = item && typeof item === 'object'
        ? asText(item.parent || '')
        : '';
      const dong = extractPeterpanzDongFromParent(parent);
      if (!dong || seen.has(dong)) continue;
      if (!/동$/.test(dong)) continue;
      seen.add(dong);
      dongCandidates.push(dong);
      if (dongCandidates.length >= 12) break;
    }
    return dongCandidates;
  } catch {
    return [];
  }
}

function ensureImageUrlList(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) {
    return rawValue.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        if (item.path) return item.path;
        if (item.url) return item.url;
        if (item.imageUrl) return item.imageUrl;
        if (item.photo_url) return item.photo_url;
        if (item.src) return item.src;
      }
      return '';
    }).filter(Boolean);
  }
  if (typeof rawValue === 'object') {
    const objectItems = [];
    const objectKeys = ['S', 'path', 'url', 'imageUrl', 'photo_url', 'src', 'thumbnail', 'img', 'image'];
    for (const key of objectKeys) {
      if (!rawValue[key]) continue;
      const value = rawValue[key];
      if (Array.isArray(value)) {
        objectItems.push(...value);
      } else {
        objectItems.push(value);
      }
    }
    return ensureImageUrlList(objectItems);
  }
  if (typeof rawValue === 'string') return [rawValue];
  return [];
}

function normalizePeterpanzRoomType(valueText) {
  const text = asText(valueText);
  if (!text) return [];
  const normalized = text.replace(/^\[/, '').replace(/\]$/, '');
  const fromJson = (() => {
    try {
      const parsed = JSON.parse(normalized);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return null;
    }
  })();

  const raw = fromJson !== null
    ? fromJson
    : normalized.split(',').map((item) => item.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
  const out = [];
  for (const it of raw) {
    if (typeof it === 'string') {
      const cleaned = asText(it.replace(/^["']|["']$/g, ''));
      if (cleaned) out.push(cleaned);
    } else if (it !== null && it !== undefined) {
      out.push(asText(it));
    }
  }
  return dedupeStrings(out);
}

function parsePeterpanzFilter(rawFilter) {
  const decodedFilter = safeDecodeURIComponent(asText(rawFilter));
  if (!decodedFilter) return {};
  const result = {};
  for (const item of decodedFilter.split('||')) {
    const trimmed = asText(item);
    if (!trimmed) continue;
    const delimiter = trimmed.includes(';') ? ';' : ':';
    const idx = trimmed.indexOf(delimiter);
    if (idx === -1) continue;
    const key = asText(trimmed.slice(0, idx));
    const value = asText(trimmed.slice(idx + 1));
    if (!key) continue;
    if (key === 'latitude' || key === 'longitude') {
      const [minValue, maxValue] = value.split('~');
      result[key] = { min: toLocaleInt(minValue, null), max: toLocaleInt(maxValue, null) };
      continue;
    }
    if (key === 'checkDeposit' || key === 'checkMonth' || key === 'checkRealSize') {
      const [minValue, maxValue] = value.split('~');
      result[key] = { min: normalizeMoneyValue(minValue), max: normalizeMoneyValue(maxValue) };
      continue;
    }
    if (key === 'contractType' || key === 'roomType' || key === 'buildingType') {
      result[key] = normalizePeterpanzRoomType(value);
      continue;
    }
    result[key] = safeDecodeURIComponent(value);
  }
  return result;
}

function parsePeterpanzSourceUrl(url) {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    if (!/peterpanz\.com$/i.test(parsed.hostname)) return {};
    const filter = parsePeterpanzFilter(parsed.searchParams.get('filter') || '');
    const centerRaw = safeDecodeURIComponent(parsed.searchParams.get('center') || '');
    const zoomLevel = toLocaleInt(parsed.searchParams.get('zoomLevel'), 12);
    const dong = asText(parsed.searchParams.get('dong'));
    const gungu = asText(parsed.searchParams.get('gungu'));
    const pageIndexRaw = parsed.searchParams.get('pageIndex');
    const pageSizeRaw = parsed.searchParams.get('pageSize');
    const pageIndex = pageIndexRaw ? toLocaleInt(pageIndexRaw, null) : null;
    const pageSize = pageSizeRaw ? toLocaleInt(pageSizeRaw, null) : null;

    let center = null;
    if (centerRaw) {
      const normalizedCenter = safeDecodeURIComponent(centerRaw);
      if (normalizedCenter) {
        try {
          const parsedCenter = JSON.parse(normalizedCenter);
          if (parsedCenter && typeof parsedCenter === 'object') {
            center = {
              y: toLocaleInt(parsedCenter.y, null),
              x: toLocaleInt(parsedCenter.x, null),
              _lat: toLocaleInt(parsedCenter._lat, null),
              _lng: toLocaleInt(parsedCenter._lng, null),
            };
          }
        } catch {
          center = null;
        }
      }
    }
    return {
      filter,
      center,
      zoomLevel,
      dong,
      gungu,
      pageIndex,
      pageSize,
    };
  } catch {
    return {};
  }
}

function inferPeterpanzBuildingTypesFromQueryHint(queryHint = {}) {
  const source = [];
  if (queryHint.buildingType) source.push(asText(queryHint.buildingType));
  if (queryHint.building_types) source.push(asText(queryHint.building_types));
  if (queryHint.propertyType) source.push(asText(queryHint.propertyType));
  if (queryHint.propertyTypeText) source.push(asText(queryHint.propertyTypeText));
  if (queryHint.property_type) source.push(asText(queryHint.property_type));
  if (queryHint.property_types) source.push(asText(queryHint.property_types));
  if (Array.isArray(queryHint.propertyTypes)) source.push(...queryHint.propertyTypes.map((v) => asText(v)));
  if (Array.isArray(queryHint.property_types_arr)) source.push(...queryHint.property_types_arr.map((v) => asText(v)));

  const values = [];
  for (const raw of source) {
    if (!raw) continue;
    const parsed = normalizePeterpanzRoomType(raw);
    if (parsed.length) values.push(...parsed);
  }

  const out = new Set();
  for (const value of values) {
    if (!value) continue;
    if (/빌라|연립|다세대|빌라주택|villa/.test(value)) out.add('빌라/주택');
    if (/단독|다가구/.test(value)) out.add('단독/다가구');
    if (/주택|빌라주택|villa/.test(value)) out.add('빌라/주택');
  }
  return Array.from(out);
}

function buildPeterpanzFilterFilterFromHint(queryHint = {}, sourceUrl = '') {
  const source = parsePeterpanzSourceUrl(sourceUrl);
  const sourceFilter = source.filter || {};
  const minAreaM2 = asLocaleInt(queryHint.minAreaM2, sourceFilter.checkRealSize?.min ?? null);
  const rentMax = normalizeMoneyValue(asLocaleInt(queryHint.rentMax, sourceFilter.checkMonth?.max ?? null));
  const rentMin = normalizeMoneyValue(asLocaleInt(queryHint.rentMin, sourceFilter.checkMonth?.min ?? null));
  const depositMax = normalizeMoneyValue(asLocaleInt(queryHint.depositMax, sourceFilter.checkDeposit?.max ?? null));
  const depositMin = normalizeMoneyValue(asLocaleInt(queryHint.depositMin, sourceFilter.checkDeposit?.min ?? null));
  const lease = asText(queryHint.leaseType || '월세');
  const requestedRoomTypes = normalizePeterpanzRoomType(asText(queryHint.roomType || queryHint.roomTypeText || ''));
  const sourceRoomType = Array.isArray(sourceFilter.roomType) ? sourceFilter.roomType : [];
  const roomTypes = dedupeStrings([
    ...requestedRoomTypes,
    ...sourceRoomType,
  ]).filter(Boolean);
  const contractTypes = dedupeStrings([
    ...normalizePeterpanzRoomType(asText(queryHint.contractType || (lease ? lease : ''))),
    ...normalizePeterpanzRoomType(sourceFilter.contractType || []),
  ]).filter(Boolean);
  const buildingTypes = dedupeStrings([
    ...inferPeterpanzBuildingTypesFromQueryHint(queryHint),
    ...normalizePeterpanzRoomType(sourceFilter.buildingType || []),
  ]).filter(Boolean);
  const hasExplicitFilter = Boolean(Object.keys(sourceFilter).length) || requestedRoomTypes.length || contractTypes.length || buildingTypes.length || queryHint.roomType || queryHint.buildingType || queryHint.contractType || minAreaM2 !== null || rentMax !== null || depositMax !== null;
  const useFilter = {
    latitude: sourceFilter.latitude || null,
    longitude: sourceFilter.longitude || null,
    checkDeposit: {
      min: sourceFilter.checkDeposit?.min ?? 999,
      max: (depositMax === null ? (sourceFilter.checkDeposit?.max ?? 60000000) : (depositMax * 10000)),
    },
    checkMonth: {
      min: sourceFilter.checkMonth?.min ?? 999,
      max: (rentMax === null ? (sourceFilter.checkMonth?.max ?? 800000) : (rentMax * 10000)),
    },
    checkRealSize: {
      min: sourceFilter.checkRealSize?.min ?? minAreaM2 ?? 40,
      max: sourceFilter.checkRealSize?.max ?? 999,
    },
    contractType: contractTypes.length ? contractTypes : [lease],
    roomType: roomTypes,
    buildingType: buildingTypes.length ? buildingTypes : ['빌라/주택'],
  };

  const filterParts = [];
  if (useFilter.latitude) filterParts.push(`latitude:${useFilter.latitude.min}~${useFilter.latitude.max}`);
  if (useFilter.longitude) filterParts.push(`longitude:${useFilter.longitude.min}~${useFilter.longitude.max}`);
  filterParts.push(`checkDeposit:${useFilter.checkDeposit.min}~${useFilter.checkDeposit.max}`);
  filterParts.push(`checkMonth:${useFilter.checkMonth.min}~${useFilter.checkMonth.max}`);
  filterParts.push(`checkRealSize:${useFilter.checkRealSize.min}~${useFilter.checkRealSize.max}`);
  if (useFilter.contractType.length) filterParts.push(`contractType;${JSON.stringify(useFilter.contractType)}`);
  if (useFilter.roomType.length) filterParts.push(`roomType;${JSON.stringify(useFilter.roomType)}`);
  if (useFilter.buildingType.length) filterParts.push(`buildingType;${JSON.stringify(useFilter.buildingType)}`);

  const zoomLevel = toLocaleInt(source.zoomLevel, 12);
  const center = source.center || {
    y: 37.566628,
    _lat: 37.566628,
    x: 126.978038,
    _lng: 126.978038,
  };
  const centerText = JSON.stringify({
    y: center.y,
    _lat: center._lat,
    x: center.x,
    _lng: center._lng,
  });
  const query = {
    filter: filterParts.join('||'),
    zoomLevel,
    center: centerText,
    dong: asText(queryHint.dong || source.dong),
    gungu: asText(queryHint.gungu || source.gungu),
    pageIndex: source.pageIndex ?? null,
    pageSize: source.pageSize ?? null,
  };
  return { query, explicitSourceFilter: hasExplicitFilter };
}

function parseTargetRoomCounts(queryHint = {}) {
  const roomTypeHint = asText(queryHint.roomType || queryHint.roomTypeText || '');
  const values = [
    ...normalizePeterpanzRoomType(roomTypeHint),
    ...Array.isArray(queryHint.roomTypes) ? queryHint.roomTypes : [],
  ].concat(Array.isArray(queryHint.room_type) ? queryHint.room_type : []);
  const out = new Set();
  for (const value of values) {
    const text = asText(value);
    if (!text) continue;
    if (/원룸/.test(text)) out.add(1);
    if (/투룸/.test(text)) out.add(2);
    if (/쓰리룸|3룸/.test(text)) out.add(3);
  }
  return Array.from(out);
}

const ZIGBANG_GEOHASH_BY_SIGUNGU = {
  노원: 'wydq5',
  노원구: 'wydq5',
  중랑: 'wydmu',
  중랑구: 'wydmu',
  동대문: 'wydmf',
  동대문구: 'wydmf',
  광진: 'wydme',
  광진구: 'wydme',
  성북: 'wydmf',
  성북구: 'wydmf',
  성동: 'wydmd',
  성동구: 'wydmd',
  중구: 'wydm9',
  중구구: 'wydm9',
  종로: 'wydmc',
  종로구: 'wydmc',
};

function asLocaleInt(v, fallback = null) {
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}

function toLocaleInt(v, fallback = null) {
  return asLocaleInt(v, fallback);
}

function normalizeSigunguName(value = '') {
  return asText(value)
    .replace(/시$/g, '')
    .replace(/구$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function buildZigbangGeohashCandidates(queryHint = {}) {
  const candidates = new Set();

  const explicit = firstDefined(queryHint.geohash, '');
  if (explicit && String(explicit).trim()) {
    const explicitList = String(explicit).split(/[,\s;|]/).map((v) => asText(v)).filter(Boolean);
    for (const item of explicitList) candidates.add(item);
  }

  const names = [];
  if (queryHint.sigungu) names.push(queryHint.sigungu);
  if (Array.isArray(queryHint.sigunguList)) {
    names.push(...queryHint.sigunguList);
  }

  const fallbackSido = asText(queryHint.sido || queryHint.region || queryHint.city || '');
  if (fallbackSido && /서울/.test(fallbackSido) && !names.length) {
    names.push('서울');
  }

  for (const rawName of names) {
    const normalized = normalizeSigunguName(rawName);
    const mapped = ZIGBANG_GEOHASH_BY_SIGUNGU[normalized]
      || ZIGBANG_GEOHASH_BY_SIGUNGU[rawName]
      || ZIGBANG_GEOHASH_BY_SIGUNGU[`${normalized}구`];
  if (mapped) {
      candidates.add(mapped);
      continue;
    }

    if (normalized.includes('서울')) {
      candidates.add('wyd');
    }
  }

  if (candidates.size === 0) {
    candidates.add('wyd');
  }

  return dedupeStrings(Array.from(candidates).filter((candidate) => asText(candidate)));
}

function resolveStealthPlatformCode(name, sourceUrl) {
  const candidate = asText(name).toLowerCase();
  if (['직방', 'zigbang', 'zigbangapp', '직방부동산'].includes(candidate)) return 'zigbang';
  if (['다방', 'dabang', 'dabangapp', '다방부동산'].includes(candidate)) return 'dabang';
  if (['네이버', '네이버 부동산', 'naver', 'naver land', 'newland', 'new land', 'new.land'].includes(candidate)) return 'naver';
  if (['피터팬', 'peterpanz', '피터팬 부동산'].includes(candidate)) return 'peterpanz';
  if (['네모', 'nemo', 'nemoapp'].includes(candidate)) return 'nemo';
  if (['부동산114', 'r114', 'r 114'].includes(candidate)) return 'r114';
  if (['호갱노노', 'hogangnono', '호갱노노닷컴'].includes(candidate)) return 'hogangnono';
  if (!sourceUrl) return '';
  const safeUrl = asText(sourceUrl).toLowerCase();
  if (safeUrl.includes('zigbang.com')) return 'zigbang';
  if (safeUrl.includes('dabangapp.com') || safeUrl.includes('dabang.com')) return 'dabang';
  if (safeUrl.includes('new.land.naver.com')) return 'naver';
  if (safeUrl.includes('r114.com')) return 'r114';
  if (safeUrl.includes('peterpanz.com')) return 'peterpanz';
  if (safeUrl.includes('nemoapp.kr')) return 'nemo';
  if (safeUrl.includes('hogangnono.com')) return 'hogangnono';
  return '';
}

function buildStealthKeyword(queryHint = {}) {
  const leaseType = asText(queryHint.leaseType || '월세');
  const parts = [
    asText(queryHint.sido || '서울시'),
    asText(queryHint.sigungu || ''),
    asText(queryHint.dong || ''),
    leaseType,
  ].filter(Boolean);

  const propertyTypes = Array.isArray(queryHint.propertyTypes)
    ? queryHint.propertyTypes.map((v) => asText(v)).filter(Boolean)
    : [];
  const rentMax = asLocaleInt(queryHint.rentMax, null);
  const depositMax = asLocaleInt(queryHint.depositMax, null);
  const minArea = asLocaleInt(queryHint.minAreaM2, asLocaleInt(queryHint.minArea, null));
  const ranges = [];
  if (rentMax !== null && rentMax >= 0) ranges.push(`최대${rentMax}만원`);
  if (depositMax !== null && depositMax >= 0) ranges.push(`보증금${depositMax}만원이하`);
  if (minArea !== null && minArea >= 0) ranges.push(`${minArea}m2이상`);
  const extras = propertyTypes.length > 0 ? [propertyTypes.join(' ')] : [];
  return asText([...parts, ...extras, ...ranges].join(' '));
}

function buildStealthSeedUrlCandidates(platformCode, sourceUrl, queryHint = {}) {
  const sourceHome = sourceUrl ? asText(sourceUrl).trim() : '';
  const home = STEALTH_HOME_BY_CODE[platformCode] || sourceHome;
  const keyword = buildStealthKeyword(queryHint);
  const encoded = encodeURIComponent(keyword);
  const encodedSigungu = encodeURIComponent(asText(queryHint.sigungu || queryHint.region || '서울시'));
  const encodedDong = encodeURIComponent(asText(queryHint.dong || ''));
  const encodedLease = encodeURIComponent(asText(queryHint.leaseType || '월세'));
  const homeCandidates = platformCode === 'peterpanz' ? [] : [home];
  const list = [];
  if (!home || !keyword) return homeCandidates;
  if (platformCode === 'zigbang') {
    const sigungu = asText(queryHint.sigungu || '');
    const dest = sigungu ? encodeURIComponent(sigungu) : '서울시';
    list.push(`${home}/search?keyword=${encoded}`, `${home}/search?search=${encoded}`, `${home}/list?keyword=${encoded}`);
    list.push(`${home}/search/destination/${dest}`);
  } else if (platformCode === 'dabang') {
    list.push(`${home}/?search_text=${encoded}`, `${home}/search?search_text=${encoded}`, `${home}/?q=${encoded}`);
  } else if (platformCode === 'naver') {
    list.push(`${home}/houses?${new URLSearchParams({ keyword }).toString()}`, `${home}/houses`);
  } else if (platformCode === 'r114') {
    list.push(
      `${home}/search/search.asp?search_word=${encodedSigungu}`,
      `${home}/search/search.asp?q=${encodedSigungu}`,
      `${home}/search/search.asp?search=${encodedSigungu}`,
      `${home}/search/search.asp?keyword=${encodedSigungu}`,
      `${home}/search/search.asp?searchType=2&search_word=${encodedSigungu}`,
      `${home}/search/search.asp?search_word=${encodedSigungu}%20${encodedDong}`,
      `${home}/search/search.asp?search_word=${encodedSigungu}&houseType=${encodedLease}`,
      `${home}/search/search.asp` ,
      `${home}/search?${new URLSearchParams({ keyword }).toString()}`,
      `${home}/?q=${encoded}`,
      `${home}/search?q=${encoded}`,
    );
  } else if (platformCode === 'peterpanz') {
    const sourceParsed = parsePeterpanzSourceUrl(sourceUrl);
    const peterpanzSeedUrl = buildPeterpanzSeedUrlFromQueryHint(queryHint, home);
    if (sourceParsed.filter && Object.keys(sourceParsed.filter).length) {
      list.push(sourceUrl);
    }
    if (peterpanzSeedUrl) {
      list.push(peterpanzSeedUrl);
    }
    list.push(
      `${home}/villa`,
      `${home}/villa?search=${encoded}`,
    );
    list.push(
      `${home}/search/search?search_word=${encodedSigungu}`,
      `${home}/search?q=${encoded}`,
      `${home}/search?query=${encoded}`,
      `${home}/search?search=${encoded}`,
      `${home}/search/search?keyword=${encodedSigungu}`,
      `${home}/api/search?search_word=${encodedSigungu}`,
    );
  } else if (platformCode === 'nemo') {
    list.push(
      `${home}/search/search?search_word=${encodedSigungu}`,
      `${home}/search?q=${encoded}`,
      `${home}/search?query=${encoded}`,
      `${home}/search?keyword=${encoded}`,
      `${home}/api/store/search-list?search_word=${encodedSigungu}`,
      `${home}/store/search?search_word=${encodedSigungu}`,
      `${home}/?q=${encoded}`,
    );
  } else if (platformCode === 'hogangnono') {
    list.push(`${home}/`, `${home}/search?q=${encoded}`, `${home}/search?keyword=${encoded}`);
  } else {
    list.push(`${home}/?q=${encoded}`);
  }
  return dedupeStrings([...homeCandidates, ...list]);
}

function buildStealthSeedUrl(platformCode, sourceUrl, queryHint = {}) {
  const candidates = buildStealthSeedUrlCandidates(platformCode, sourceUrl, queryHint);
  return candidates[0] || asText(sourceUrl) || '';
}

function normalizeListingUrl(baseUrl, href) {
  if (!href || typeof href !== 'string') return '';
  const trimmed = href.trim();
  if (!trimmed || trimmed === '#' || trimmed.startsWith('javascript:')) return '';
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return '';
  }
}

function isLikelyListingUrl(platformCode, url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const lower = url.toLowerCase();
  let parsed;
  try {
    parsed = new URL(lower);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const allowedHosts = {
    zigbang: ['zigbang.com'],
    dabang: ['dabangapp.com'],
    naver: ['new.land.naver.com'],
    r114: ['r114.com'],
    peterpanz: ['peterpanz.com'],
    nemo: ['nemoapp.kr'],
    hogangnono: ['hogangnono.com'],
  };
  const hostWhitelist = allowedHosts[platformCode] || [];
  const hostMatch = hostWhitelist.length === 0 ? true : hostWhitelist.some((allowed) => host.endsWith(allowed));
  if (!hostMatch) return false;

  if (/(?:css|js|png|jpg|jpeg|gif|svg|woff|ico|woff2)(?:\?|#|$)/i.test(lower)) return false;
  const hasListingPath = /(\/(item|items|article|articles|room|rooms|house|houses|property|listing|detail|complex|apt|officetel|rent|deal|villa|officetel|aptdeal|house-detail|house_detail|apart)[/?#]|\?id=|item_id=|article_id=|item_no=|house_no=|house_id=|property_id=|no=)/i.test(lower);
  const hasR114Path = /(\/(house|villa|officetel|rent|rent_room)\/((detail|house_detail|house-detail)\/?|\d+))/i.test(lower);
  const hasAnyId = /[/?#]\w*?(?:\d{4,}|[a-f0-9-]{10,})/.test(lower);
  const hasLegacyDetail = /\/(house|apt|officetel|villa|room)\//i.test(lower);
  if (platformCode === 'r114') {
    return hasR114Path || hasAnyId || hasListingPath;
  }
  if (platformCode === 'peterpanz' || platformCode === 'nemo') {
    const hasNemoPath = /(\/(store|house|room|detail|property)\/(?:\d+|[^/?#]+)[/?#]?)/i.test(lower);
    if (hasNemoPath) return true;
  }
  return hasListingPath || hasLegacyDetail || (platformCode !== 'naver' && hasAnyId);
}

function extractListingUrlsFromHtml(platformCode, html, pageUrl) {
  const candidates = new Set();
  const text = String(html || '');
  const patterns = [
    /https?:\/\/[^"'<>\\s]*?(?:item|article|room|house|property|listing|complex|apt|officetel)[^"'<>\\s]*?(?:\?|#)?/gi,
    /\/(?:[^"'<>\\s]*?(?:item|article|room|house|property|listing|complex|apt|officetel)[^"'<>\\s]*?)(?:\?|#)?/gi,
    /\/[^"'<>\\s]*?\d{4,}[^"'<>\\s]*/gi,
  ];
  for (const pattern of patterns) {
    let match = null;
    while ((match = pattern.exec(text)) !== null) {
      const normalized = normalizeListingUrl(pageUrl, match[0]);
      if (isLikelyListingUrl(platformCode, normalized)) {
        candidates.add(normalized);
      }
      if (candidates.size >= 80) break;
    }
    if (candidates.size >= 80) break;
  }
  return Array.from(candidates);
}

function dedupeStrings(values) {
  const result = [];
  const seen = new Set();
  for (const item of values) {
    const normalized = asText(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function safeJsonParse(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === 'string') {
    const cleaned = v.replace(/,/g, '').trim();
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function firstDefined(...values) {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const s = asText(v);
    if (s.length > 0) return s;
  }
  return '';
}

function collectDedupeList(value) {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const it of items) {
    if (typeof it !== 'string') continue;
    const normalized = asText(it);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseAreaFieldM2(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return toNumberOrNull(v);
  if (typeof v === 'object') {
    if (v === null) return null;
    if (v.m2 !== undefined) return toNumberOrNull(v.m2);
    if (v.p !== undefined) {
      const py = toNumberOrNull(v.p);
      return py === null ? null : py * 3.3058;
    }
  }
  const raw = asText(v);
  if (!raw) return null;
  const parsedFromText = parseArea(raw).area.exclusive_m2;
  return parsedFromText === null ? toNumberOrNull(raw) : parsedFromText;
}

function extractAddressPartsFromCandidate(candidate, fallback = {}) {
  const addressRaw = firstDefined(
    candidate.address1,
    candidate.address,
    candidate.address_text,
    candidate.addressText,
    candidate.fullAddress,
    candidate.addressTextOnly,
    candidate.title,
    candidate.randomLocation?.fullText,
    candidate.randomLocation?.addressText,
    fallback.address,
  );
  const normalized = normalizeAddress(addressRaw || fallback.address || '');
  const rawAddressObj = candidate.addressOrigin || candidate.randomLocation || {};
  const sido = asText(rawAddressObj.local1 || normalized.sido || '').replace(/^서울특별시$/, '서울시');
  const sigungu = asText(rawAddressObj.local2 || normalized.sigungu || '');
  const dong = asText(rawAddressObj.local3 || normalized.dong || '');
  return {
    address: normalized.address_raw || addressRaw || '',
    sido: sido || normalized.sido || '서울',
    sigungu,
    dong,
    address_code: normalized.address_code || hashAddressCode(addressRaw || normalized.address_raw || ''),
  };
}

function parseAreaFromPayload(payloadItem) {
  const byKeys = parseArea(asText(payloadItem?.area_text || payloadItem?.areaDesc || payloadItem?.roomDesc || ''));
  const firstExclusive = parseAreaFieldM2(
    firstDefined(
      payloadItem?.area?.exclusive_m2,
      payloadItem?.exclusiveArea,
      payloadItem?.areaExclusive,
      payloadItem?.size_exclusive,
      payloadItem?.전용면적,
      payloadItem?.size_m2,
    ),
  );
  const firstGross = parseAreaFieldM2(
    firstDefined(
      payloadItem?.area?.gross_m2,
      payloadItem?.grossArea,
      payloadItem?.areaGross,
      payloadItem?.size_gross,
      payloadItem?.공급면적,
    ),
  );
  const areaCandidate = firstExclusive ?? firstGross ?? byKeys.area.exclusive_m2 ?? byKeys.area.gross_m2;
  const areaType = firstExclusive !== null ? 'exclusive' : firstGross !== null ? 'gross' : byKeys.area_type || 'estimated';
  return {
    area: {
      exclusive_m2: firstExclusive,
      gross_m2: firstGross,
      area_type: areaType,
      area_exclusive_m2_min: null,
      area_exclusive_m2_max: null,
      area_gross_m2_min: null,
      area_gross_m2_max: null,
    },
    area_raw: byKeys.area_raw,
    area_candidate_raw: byKeys.area_raw,
  };
}

function buildParsedRecord(sourceUrl, parsed) {
  const raw = {
    title: parsed.title || 'MISSING',
    price: {
      monthly_rent: parsed.monthly_rent,
      deposit: parsed.deposit,
    },
    area: {
      area_type: parsed.area_type || 'estimated',
      exclusive_m2: parsed.exclusive_m2 ?? null,
      gross_m2: parsed.gross_m2 ?? null,
      area_exclusive_m2_min: parsed.area_exclusive_m2_min ?? null,
      area_exclusive_m2_max: parsed.area_exclusive_m2_max ?? null,
      area_gross_m2_min: parsed.area_gross_m2_min ?? null,
      area_gross_m2_max: parsed.area_gross_m2_max ?? null,
      area_raw: parsed.area_raw || '',
    },
    address: {
      address_raw: parsed.address_text || '',
      sido: parsed.sido || '서울',
      sigungu: parsed.sigungu || '',
      dong: parsed.dong || '',
    },
    building: {
      floor: parsed.floor ?? null,
      total_floor: parsed.total_floor ?? null,
    },
    unit: {
      room_count: parsed.room_count ?? null,
      bathroom_count: parsed.bathroom_count ?? null,
    },
    listing_type: parsed.listing_type || null,
    images: parsed.images || [],
    raw_text: asText((parsed.raw_text || '').slice(0, 1200)),
    address_code: parsed.address_code || null,
  };

  const areaCandidate = raw.area.exclusive_m2 ?? raw.area.gross_m2;
  const requiredFields = Boolean(
    raw.title !== 'MISSING' &&
      (raw.price.monthly_rent !== null || raw.price.deposit !== null) &&
      areaCandidate !== null &&
      raw.address.address_raw &&
      sourceUrl,
  );

  const violations = [];
  if (raw.price.monthly_rent === null && raw.price.deposit === null) violations.push('PRICE_PARSE_FAIL');
  if (raw.area.exclusive_m2 === null && raw.area.gross_m2 === null) violations.push('AREA_PARSE_FAIL');
  if (!raw.address.address_raw) violations.push('ADDRESS_NORMALIZE_FAIL');
  if (!raw.images.length) violations.push('IMAGE_URL_INVALID');

  return {
    sourceUrl,
    raw,
    normalized: {
      area_exclusive_m2: raw.area.exclusive_m2,
      area_exclusive_m2_min: raw.area.area_exclusive_m2_min,
      area_exclusive_m2_max: raw.area.area_exclusive_m2_max,
      area_gross_m2: raw.area.gross_m2,
      area_gross_m2_min: raw.area.area_gross_m2_min,
      area_gross_m2_max: raw.area.area_gross_m2_max,
      area_claimed: raw.area.area_type || 'estimated',
      address_text: raw.address.address_raw,
      address_code: raw.address_code || raw.address.address_raw ? hashAddressCode(raw.address.address_raw) : null,
      rent_amount: raw.price.monthly_rent,
      deposit_amount: raw.price.deposit,
      room_count: raw.unit.room_count,
      floor: raw.building.floor,
      total_floor: raw.building.total_floor,
      lease_type: raw.listing_type ? '월세' : '기타',
      quality_flags: violations,
      sido: raw.address.sido,
      sigungu: raw.address.sigungu,
      dong: raw.address.dong,
    },
    requiredFields,
    violations,
    area_raw: raw.area.area_raw,
  };
}

function buildParsedAddressFallback(queryHint = {}) {
  const sido = asText(queryHint.sido || queryHint.city || queryHint.region || '서울시').replace(/(특별시|광역시)$/g, '시').trim();
  const sigungu = asText(queryHint.sigungu || queryHint.district || '');
  const dong = asText(queryHint.dong || '');
  return {
    address: [sido, sigungu, dong].filter(Boolean).join(' ').trim(),
    sido,
    sigungu,
    dong,
  };
}

function buildParsedRecordFromPayload(platformCode, sourceUrl, payloadItem, options = {}) {
  const fallback = options.fallback || {};
  const addressFallback = {
    address: asText(fallback.address || ''),
    sido: asText(fallback.sido || ''),
    sigungu: asText(fallback.sigungu || ''),
    dong: asText(fallback.dong || ''),
  };
  if (!payloadItem || typeof payloadItem !== 'object') return null;

  if (platformCode === 'peterpanz') {
    const title = firstDefined(
      payloadItem.title,
      payloadItem.roomTitle,
      payloadItem.house_title,
      payloadItem.name,
      payloadItem.headline,
      payloadItem.location?.address?.text,
      payloadItem.location?.address,
      payloadItem.address,
      payloadItem.address_text,
    );
    const roomTypeText = asText(firstDefined(
      payloadItem.info?.room_type,
      payloadItem.info?.roomType,
      payloadItem.type?.room_type,
      payloadItem.type?.roomType,
      payloadItem.roomType,
      payloadItem.room_type_name,
      payloadItem.room_type,
      payloadItem.title,
    ));
    const roomCount = parseRoom(roomTypeText);
    const suppliedSize = parseAreaFieldM2(
      firstDefined(
        payloadItem.info?.supplied_size,
        payloadItem.supplied_size,
        payloadItem.size_m2,
        payloadItem.areaEx,
      ),
    );
    const areaParsed = parseArea(firstDefined(
      asText(payloadItem.info?.supplied_size),
      asText(payloadItem.supplied_size),
      payloadItem.area_text,
      payloadItem.areaText,
      payloadItem.area?.supplied_size,
      payloadItem.area?.m2,
      payloadItem.area,
    ));
    const addrText = firstDefined(
      payloadItem.location?.address?.text,
      payloadItem.location?.address?.fullText,
      payloadItem.location?.address,
      payloadItem.address,
      payloadItem.address_text,
      payloadItem.addressText,
    );
    const peterAddress = extractAddressPartsFromCandidate(payloadItem, {
      ...addressFallback,
      address: asText(addrText),
    });
    const floorParsed = parseFloor(firstDefined(
      payloadItem.floor?.target,
      payloadItem.floor?.targetFloor,
      payloadItem.floorText,
      payloadItem.floor_text,
      payloadItem.floor,
      payloadItem.floor_no,
      payloadItem.floorNum,
      payloadItem.floor_text_desc,
    ));
    const contractType = asText(firstDefined(
      payloadItem.type?.contract_type,
      payloadItem.contractType,
      payloadItem.trade_type,
      payloadItem.type?.tradeType,
      payloadItem.priceType,
      payloadItem.price_type,
    ));
    const listingType = /월세/.test(contractType)
      ? '월세'
      : /전세/.test(contractType)
        ? '전세'
        : /매매/.test(contractType)
          ? '매매'
          : roomTypeText || asText(payloadItem.type?.room_type_name) || '월세';

    const rawMonthly = firstDefined(
      payloadItem.price?.monthly_fee,
      payloadItem.price?.monthlyFee,
      payloadItem.price?.monthly,
      payloadItem.monthlyRent,
      payloadItem.monthly_rent,
      payloadItem.month,
      payloadItem.price,
    );
    const rawDeposit = firstDefined(
      payloadItem.price?.deposit,
      payloadItem.price?.deposit_fee,
      payloadItem.deposit,
      payloadItem.deposit_fee,
      payloadItem.deposit_price,
      payloadItem.depositAmount,
    );
    const imagesFromPayload = [
      ...ensureImageUrlList(payloadItem.image),
      ...ensureImageUrlList(payloadItem.image_url),
      ...ensureImageUrlList(payloadItem.imageUrl),
      ...ensureImageUrlList(payloadItem.thumbnail),
      ...ensureImageUrlList(payloadItem.mainPhoto),
      ...ensureImageUrlList(payloadItem.photo),
      ...ensureImageUrlList(payloadItem.pic),
      ...ensureImageUrlList(payloadItem.picUrl),
      ...ensureImageUrlList(payloadItem.imgUrlList),
      ...ensureImageUrlList(payloadItem.imageList),
      ...ensureImageUrlList(payloadItem.photoList),
      ...ensureImageUrlList(payloadItem.images),
    ];

    return buildParsedRecord(sourceUrl, {
      title,
      monthly_rent: normalizeKoreanWonAsMan(rawMonthly),
      deposit: normalizeKoreanWonAsMan(rawDeposit),
      exclusive_m2: suppliedSize ?? areaParsed.area.exclusive_m2,
      gross_m2: areaParsed.area.gross_m2,
      area_type: suppliedSize !== null ? 'exclusive' : areaParsed.area.area_type,
      area_exclusive_m2_min: areaParsed.area.area_exclusive_m2_min,
      area_exclusive_m2_max: areaParsed.area.area_exclusive_m2_max,
      area_gross_m2_min: areaParsed.area.area_gross_m2_min,
      area_gross_m2_max: areaParsed.area.area_gross_m2_max,
      address_text: peterAddress.address,
      sido: peterAddress.sido || '서울',
      sigungu: peterAddress.sigungu,
      dong: peterAddress.dong,
      address_code: peterAddress.address_code,
      floor: floorParsed.floor,
      total_floor: floorParsed.total_floor,
      room_count: roomCount,
      bathroom_count: null,
      listing_type: listingType,
      images: dedupeStrings(imagesFromPayload),
      area_raw: areaParsed.area_raw || asText(payloadItem.info?.supplied_size) || asText(payloadItem.supplied_size),
      raw_text: firstDefined(
        payloadItem.description,
        payloadItem.roomDesc,
        payloadItem.location?.address?.text,
        roomTypeText,
        asText(payloadItem.title),
      ),
    });
  }

  const title = firstDefined(
    payloadItem.title,
    payloadItem.itemTitle,
    payloadItem.roomTitle,
    payloadItem.subject,
    payloadItem.name,
    payloadItem.headline,
  );
  const address = extractAddressPartsFromCandidate(payloadItem, addressFallback);

  if (platformCode === 'zigbang') {
    const priceText = firstDefined(
      payloadItem.sales_title,
      payloadItem.salesType,
      payloadItem.priceType,
      payloadItem.price_title,
      payloadItem.priceTitle,
    );
    const rentFromPayload = toNumberOrNull(payloadItem.rent || payloadItem.monthly_rent);
    const depositFromPayload = toNumberOrNull(payloadItem.deposit || payloadItem.depositPrice || payloadItem['보증금']);
    const areaParse = parseAreaFromPayload(payloadItem);
    const fallbackPrice = parsePriceFallback(priceText, title, payloadItem.priceType || payloadItem.price_type || payloadItem.priceTypeName || payloadItem.tradeType || '월세');
    const parsedPrice = {
      monthly_rent: rentFromPayload ?? fallbackPrice.monthlyRent,
      deposit: depositFromPayload ?? fallbackPrice.deposit,
    };
    const areaCandidate = parseAreaFieldM2(payloadItem.size_m2) ?? areaParse.area.exclusive_m2 ?? areaParse.area.gross_m2;
    const areaType = areaCandidate === areaParse.area.exclusive_m2 ? 'exclusive' : areaCandidate === areaParse.area.gross_m2 ? 'gross' : areaParse.area.area_type;
    const areaRaw = firstDefined(payloadItem.roomDesc, payloadItem.areaDesc, areaParse.area_raw, payloadItem.desc, payloadItem.description);
    const areaMinMax = parseArea(firstDefined(areaRaw, priceText));
    const images = dedupeStrings([payloadItem.images_thumbnail, payloadItem.thumbnail, payloadItem.image_url, payloadItem.imageUrl, payloadItem.image, payloadItem.photo, ...collectDedupeList(payloadItem.imageList)]);
    const roomCount = parseRoom(asText(payloadItem.room_type_title || payloadItem.service_type || payloadItem.room_type || ''));
    const floorParsed = parseFloor(firstDefined(payloadItem.floor_string, payloadItem.floor, payloadItem.floorInfo));
    return buildParsedRecord(sourceUrl, {
      title,
      monthly_rent: parsedPrice.monthly_rent,
      deposit: parsedPrice.deposit,
      exclusive_m2: toNumberOrNull(payloadItem.size_m2) ?? areaParse.area.exclusive_m2,
      gross_m2: areaParse.area.gross_m2,
      area_type: areaType,
      area_exclusive_m2_min: areaMinMax.area_exclusive_m2_min,
      area_exclusive_m2_max: areaMinMax.area_exclusive_m2_max,
      area_gross_m2_min: areaMinMax.area_gross_m2_min,
      area_gross_m2_max: areaMinMax.area_gross_m2_max,
      address_text: address.address,
      sido: address.sido,
      sigungu: address.sigungu,
      dong: address.dong,
      address_code: address.address_code,
      floor: floorParsed.floor,
      total_floor: floorParsed.total_floor,
      room_count: roomCount,
      bathroom_count: null,
      listing_type: '월세',
      images,
      area_raw: areaRaw,
      raw_text: firstDefined(payloadItem.desc, payloadItem.description, payloadItem.roomDesc, priceText),
    });
  }

  const listingTypeRaw = firstDefined(
    payloadItem.listing_type,
    payloadItem.tradeType,
    payloadItem.trade_type,
    payloadItem.type,
    payloadItem.useType,
    payloadItem.houseType,
    payloadItem.itemType,
    payloadItem.priceType,
    payloadItem.price_type,
    payloadItem.priceTypeName,
  );
  const priceText = firstDefined(
    payloadItem.priceTitle,
    payloadItem.price_type,
    payloadItem.priceType,
    payloadItem.text,
    payloadItem.description,
    payloadItem.desc,
    payloadItem.price,
    payloadItem.prices,
    payloadItem.saleTitle,
    payloadItem.sale_title,
  );
  const areaText = firstDefined(
    payloadItem.roomDesc,
    payloadItem.areaText,
    payloadItem.area,
    payloadItem.description,
    payloadItem.area_text,
    payloadItem.areaTextOnly,
    payloadItem.floorText,
  );
  const priceFallback = parsePriceFallback(priceText, title, listingTypeRaw);
  const baseRent = toNumberOrNull(
    payloadItem.monthlyRent || payloadItem.monthly_rent || payloadItem.rent || payloadItem.wolse || payloadItem['월세금액'],
  );
  const baseDeposit = toNumberOrNull(
    payloadItem.deposit || payloadItem.depositPrice || payloadItem.deposit_price || payloadItem['보증금'] || payloadItem['보증금금액'],
  );
  const parsedPrice = {
    monthly_rent: baseRent ?? priceFallback.monthlyRent,
    deposit: baseDeposit ?? priceFallback.deposit,
  };
  const areaParsed = parseArea(firstDefined(
    areaText,
    payloadItem.area_m2,
    payloadItem.areaSize,
    payloadItem.areaSizeM2,
    payloadItem.area_exclusive,
    payloadItem.exclusive_area,
    payloadItem.exclusiveArea,
  ));
  const areaField = parseAreaFieldM2(
    firstDefined(
      payloadItem.area_m2,
      payloadItem.areaSize,
      payloadItem.size_m2,
      payloadItem.area_m2_exclusive,
      payloadItem.areaExclusive,
      payloadItem.전용면적,
    ),
  ) ?? parseAreaFieldM2(payloadItem.area_gross) ?? areaParsed.area_exclusive_m2 ?? areaParsed.area_gross_m2;
  const images = dedupeStrings([
    payloadItem.imgUrlList,
    payloadItem.thumbnail,
    payloadItem.images_thumbnail,
    payloadItem.image,
    payloadItem.photoUrl,
    payloadItem.photo,
    payloadItem.pic,
    payloadItem.picUrl,
    payloadItem.mainPhoto,
    payloadItem.mainPhotoUrl,
    payloadItem.photo_url,
    payloadItem.image_url_list,
    ...collectDedupeList(payloadItem.images),
    ...collectDedupeList(payloadItem.imageList),
    ...collectDedupeList(payloadItem.photoList),
  ]);
  const floorParsed = parseFloor(firstDefined(payloadItem.floor_text, payloadItem.floor, payloadItem.floorInfo, payloadItem.floorName, payloadItem.floor_no, payloadItem.floorNum, payloadItem.floor_text_desc));
  const roomCount = parseRoom(asText(
    payloadItem.roomTypeName ||
      payloadItem.room_type_name ||
      payloadItem.room_type ||
      payloadItem.roomCount ||
      payloadItem.room_cnt ||
      payloadItem.room_count ||
      payloadItem.title,
  ));
  const areaTextRaw = areaText || areaParsed.area_raw;
  const normalizedAddress = extractAddressPartsFromCandidate(payloadItem, {
    ...addressFallback,
    address: address.address,
  });
  const listingType = listingTypeRaw ? /원룸/.test(asText(listingTypeRaw)) ? '원룸' : /투룸/.test(asText(listingTypeRaw)) ? '투룸' : /쓰리룸/.test(asText(listingTypeRaw)) ? '쓰리룸' : asText(listingTypeRaw) : '월세';
  return buildParsedRecord(sourceUrl, {
    title,
    monthly_rent: parsedPrice.monthly_rent,
    deposit: parsedPrice.deposit,
    exclusive_m2: areaField ?? areaParsed.area_exclusive_m2,
    gross_m2: areaParsed.area_gross_m2,
    area_type: areaParsed.area_type,
    area_exclusive_m2_min: areaParsed.area_exclusive_m2_min,
    area_exclusive_m2_max: areaParsed.area_exclusive_m2_max,
    area_gross_m2_min: areaParsed.area_gross_m2_min,
    area_gross_m2_max: areaParsed.area_gross_m2_max,
    address_text: normalizedAddress.address || address.address,
    sido: normalizedAddress.sido,
    sigungu: normalizedAddress.sigungu,
    dong: normalizedAddress.dong,
    address_code: normalizedAddress.address_code || address.address_code,
    floor: floorParsed.floor,
    total_floor: floorParsed.total_floor,
    room_count: roomCount,
    bathroom_count: null,
    listing_type: /월세|월세매물|월세방/.test(asText(listingTypeRaw || '월세')) ? '월세' : listingType || '월세',
    images,
    area_raw: areaTextRaw,
    raw_text: firstDefined(areaTextRaw, priceText, payloadItem.desc, payloadItem.description),
  });
}

function parseZigbangSectionIds(payload) {
  const sections = safeJsonParse(payload?.sections ? JSON.stringify(payload.sections) : JSON.stringify(payload?.payload?.sections || []));
  if (!sections || !Array.isArray(sections)) return [];
  const ids = [];
  for (const sec of sections) {
    if (!sec || !Array.isArray(sec.ids)) continue;
    for (const id of sec.ids) {
      const itemId = String(id).trim();
      if (/^\d+$/.test(itemId)) ids.push(itemId);
    }
  }
  return dedupeStrings(ids);
}

function extractPayloadListingItems(payload) {
  const items = findListingArray(payload);
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && typeof item === 'object');
}

function buildDabangFilterPayload(queryHint = {}) {
  const rentMax = toNumberOrNull(queryHint.rentMax);
  const depositMax = toNumberOrNull(queryHint.depositMax);
  return {
    sellingTypeList: ['MONTHLY_RENT', 'LEASE'],
    depositRange: {
      min: 0,
      max: depositMax === null ? 999999 : depositMax,
    },
    priceRange: {
      min: 0,
      max: rentMax === null ? 999999 : rentMax,
    },
    tradeRange: {
      min: 0,
      max: rentMax === null ? 999999 : rentMax,
    },
    isIncludeMaintenance: false,
  };
}

function buildDabangMapCategoryTypes(queryHint = {}) {
  const raw = Array.isArray(queryHint.propertyTypes)
    ? queryHint.propertyTypes.map((v) => asText(v))
    : [];
  const hasVilla = raw.some((v) => /빌라|연립|다세대|다가구|단독|villa/i.test(v));
  const hasOfficetel = raw.some((v) => /오피스텔|원룸|투룸|쓰리룸|원|투|officetel/i.test(v));

  const out = new Set(['ONE_TWO_ROOM']);
  if (!raw.length || hasOfficetel) {
    out.add('ONE_TWO_ROOM');
    out.add('OFFICETEL');
  }
  if (!raw.length || hasVilla) {
    out.add('HOUSE_VILLA');
  }
  return dedupeStrings(Array.from(out));
}

async function collectDabangPayloadCandidates(home, queryHint = {}) {
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    accept: 'application/json,text/plain,*/*;q=0.8',
    'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
    'd-api-version': '5.0.0',
    'd-app-version': '1',
    'd-call-type': 'web',
    csrf: 'token',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
  };

  const filters = encodeURIComponent(JSON.stringify(buildDabangFilterPayload(queryHint)));
  const queryForRegion = asText(queryHint.sigungu || queryHint.region || queryHint.sido || '서울시');
  const locKeyword = queryForRegion
    .trim()
    .replace(/\s+/g, ' ')
    .trim();

  const regionIds = new Set();
  try {
    const locResp = await fetchJsonPayload(
      `${home}/api/v5/loc/search?columnList=REGION&searchKeyword=${encodeURIComponent(locKeyword)}`,
      { headers },
    );
    const locPayload = locResp.payload || {};
    const regionList = (
      safeArray(locPayload?.result?.regionList)
      || safeArray(locPayload.regionList)
      || safeArray(locPayload?.result?.regions)
      || safeArray(locPayload.regions)
      || []
    );
    for (const region of regionList.slice(0, 3)) {
      const gid = region?.gid || region?.regionGid || region?.regionId || region?.id || region?.code;
      if (gid) regionIds.add(String(gid));
    }
  } catch {
    // keep regionIds empty and continue with fallback IDs
  }

  if (!regionIds.size) {
    const fallbackRegionId = String(queryHint.regionId || queryHint.region_gid || queryHint.regionCode || '').trim();
    if (fallbackRegionId) regionIds.add(fallbackRegionId);
  }

  const mapCategoryTypes = buildDabangMapCategoryTypes(queryHint);
  const out = [];
  const seen = new Set();

  for (const rawRegionId of regionIds) {
    const regionId = encodeURIComponent(String(rawRegionId));
    for (const mapCategoryType of mapCategoryTypes) {
      const listUrl = `${home}/api/v5/room-list/recommend/home-ai/region?id=${regionId}&mapCategoryType=${encodeURIComponent(mapCategoryType)}&page=0&size=40&curationType=REGION_ROOM&useMap=naver&filters=${filters}`;
      try {
        const listResp = await fetchJsonPayload(listUrl, { headers });
        if (!listResp.ok || !listResp.payload) continue;
        const list = safeArray(listResp.payload?.result?.list);
        for (const item of list) {
          if (!item || typeof item !== 'object') continue;
          const itemId = asText(item.id || item.roomNo || item.room_id || item.houseId || item.house_id || item.item_id || item.itemNo || item.article_id || item.articleNo);
          const dedupeKey = itemId || JSON.stringify(item);
          if (!itemId && seen.has(dedupeKey)) continue;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          out.push({ ...item, __dabangMapCategoryType: mapCategoryType, __dabangRegionId: rawRegionId });
        }
      } catch {
        continue;
      }
    }
  }
  return out;
}

async function fetchZigbangListItems(itemIds) {
  const uniqueIds = dedupeStrings((itemIds || []).map((id) => String(id).trim()).filter((x) => x.length > 0));
  const collected = [];
  for (let i = 0; i < uniqueIds.length; i += 15) {
    const chunk = uniqueIds.slice(i, i + 15);
    if (!chunk.length) continue;
    const resp = await fetchJsonPayload('https://apis.zigbang.com/house/property/v1/items/list', {
      method: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0',
        'content-type': 'application/json',
        accept: 'application/json,text/plain,*/*;q=0.8',
      },
      body: JSON.stringify({ itemIds: chunk.map((id) => Number(id)) }),
    });
    if (!resp.ok || !resp.payload) continue;
    const items = findListingArray(resp.payload);
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item && typeof item === 'object') collected.push(item);
      }
    }
  }
  return collected;
}

async function collectZigbangPayloadCandidates(queryHint = {}) {
  const geohashCandidates = buildZigbangGeohashCandidates(queryHint);
  const minArea = asLocaleInt(queryHint.minAreaM2, asLocaleInt(queryHint.minArea, null));
  const hasAreaFilter = minArea !== null && minArea >= 35;
  const geohashLabel = geohashCandidates.join(',');
  const params = new URLSearchParams();
  if (queryHint.rentMax !== undefined && queryHint.rentMax !== null) params.set('rentMax', String(queryHint.rentMax));
  if (queryHint.depositMax !== undefined && queryHint.depositMax !== null) params.set('depositMax', String(queryHint.depositMax));
  params.set('tradeType', '월세');
  if (hasAreaFilter) params.set('area_m2_min', String(minArea));
  const propertyTypes = Array.isArray(queryHint.propertyTypes) && queryHint.propertyTypes.length > 0
    ? new Set(queryHint.propertyTypes.map((v) => asText(v)))
    : new Set(['원룸', '빌라/연립', '단독/다가구']);

  const endpoints = [];
  if (propertyTypes.has('원룸') || propertyTypes.has('빌라/연립') || propertyTypes.has('단독/다가구')) {
    endpoints.push('onerooms');
  }
  if (propertyTypes.has('빌라/연립') || propertyTypes.has('단독/다가구')) {
    endpoints.push('villas');
  }
  endpoints.push('officetels');
  const endpointOrder = hasAreaFilter
    ? ['officetels', 'villas', 'onerooms']
    : ['onerooms', 'villas', 'officetels'];
  const requestGeohashes = geohashCandidates.length > 0 ? geohashCandidates : ['wyd'];
  const endpointBuckets = {
    onerooms: [],
    villas: [],
    officetels: [],
  };

  const idSet = new Set();
  for (const endpoint of endpoints) {
    for (const geohash of requestGeohashes) {
      const requestUrl = `https://apis.zigbang.com/house/property/v1/items/${endpoint}?geohash=${encodeURIComponent(geohash)}&${params.toString()}`;
      const response = await fetchJsonPayload(requestUrl);
      if (!response.ok || !response.payload) continue;
      const sectionIds = parseZigbangSectionIds(response.payload);
      for (const id of sectionIds) endpointBuckets[endpoint].push(String(id));
      const rawItems = findListingArray(response.payload);
      if (Array.isArray(rawItems) && rawItems.length > 0) {
        for (const item of rawItems) {
          if (item && item.item_id !== undefined) endpointBuckets[endpoint].push(String(item.item_id));
          if (item && item.id !== undefined) endpointBuckets[endpoint].push(String(item.id));
        }
      }
    }
  }

  const orderedIds = [];
  for (const endpoint of endpointOrder) {
    const list = endpointBuckets[endpoint] || [];
    for (const id of list) {
      if (id && !idSet.has(id)) idSet.add(id);
      orderedIds.push(id);
    }
  }
  const ids = dedupeStrings(orderedIds).slice(0, 240);
  if (!ids.length) return [];
  const parsedItems = await fetchZigbangListItems(ids);
  return parsedItems.map((item) => ({ ...item, __zigbangGeohashes: geohashLabel, __zigbangEndpoints: endpoints.join(',') }));
}

function pickPayloadRecordSourceUrl(home, platformCode, payloadItem) {
  const urls = pickListingUrl(home, platformCode, payloadItem);
  if (urls.length) return urls[0];
  const fallbackId = asText(payloadItem?.item_id || payloadItem?.id || payloadItem?.roomNo || payloadItem?.room_id);
  if (!fallbackId) return '';
  if (platformCode === 'peterpanz') {
    return `${home}/house/${encodeURIComponent(fallbackId)}`;
  }
  return `${home}/item/${encodeURIComponent(fallbackId)}`;
}

function collectPayloadParsedCandidates(platformCode, home, queryHint = {}, payloadItems = []) {
  if (!Array.isArray(payloadItems) || payloadItems.length === 0) return [];
  const payloadFallback = buildParsedAddressFallback(queryHint);
  const out = [];
  const isDebug = process.env.DEBUG_PETERP_API === '1';
  let debugCount = 0;
  const areaForSort = (item) => getParsedAreaValue(item.parsed) || -1;
  for (const item of payloadItems) {
    if (!item || typeof item !== 'object') continue;
    const urls = pickListingUrl(home, platformCode, item);
    const sourceUrl = pickPayloadRecordSourceUrl(home, platformCode, item);
    const parsed = buildParsedRecordFromPayload(platformCode, sourceUrl, item, {
      fallback: payloadFallback,
    });
    if (!parsed) continue;
    const matched = matchesQueryForParsed(parsed, queryHint);
    if (isDebug && platformCode === 'peterpanz' && debugCount < 8) {
      const normalized = parsed.normalized || {};
      console.log(
        'DEBUG:PETERP_CANDIDATE',
        JSON.stringify({
          sourceUrl,
          matched,
          title: parsed.raw?.title,
          titleLen: asText(parsed.raw?.title).length,
          address: normalized.address_text,
          area_exclusive_m2: normalized.area_exclusive_m2,
          rent_amount: normalized.rent_amount,
          deposit_amount: normalized.deposit_amount,
          room_count: normalized.room_count,
          requiredFields: parsed.requiredFields,
        }),
      );
      debugCount += 1;
    }
    if (!matched) continue;
    out.push({
      parsed,
      urls,
      sourceUrl,
    });
  }
  out.sort((a, b) => {
    const aArea = areaForSort(a);
    const bArea = areaForSort(b);
    if (aArea !== bArea) return bArea - aArea;
    return bArea < 0 ? 0 : 0;
  });
  return out;
}

function matchesQueryForParsed(parsed, queryHint = {}) {
  if (!parsed || !parsed.normalized) return false;
  const normalized = parsed.normalized;
  const raw = parsed.raw;
  const minArea = toNumberOrNull(queryHint.minAreaM2);
  const rentMax = toNumberOrNull(queryHint.rentMax);
  const depositMax = toNumberOrNull(queryHint.depositMax);
  const targetRoomCounts = parseTargetRoomCounts(queryHint);

  const areaValue = normalized.area_exclusive_m2 ?? normalized.area_gross_m2;
  const rentValue = normalized.rent_amount;
  const depositValue = normalized.deposit_amount;
  if (minArea !== null && areaValue !== null && areaValue < minArea) return false;
  if (rentMax !== null && rentValue !== null && rentValue > rentMax) return false;
  if (depositMax !== null && depositValue !== null && depositValue > depositMax) return false;

  const roomCount = toLocaleInt(normalized.room_count, null);
  if (targetRoomCounts.length && roomCount !== null && !targetRoomCounts.includes(roomCount)) return false;
  if (targetRoomCounts.length && roomCount === null) {
    const candidateText = asText(`${raw?.raw_text || ''} ${raw?.title || ''}`);
    const inferredRoomCount = parseRoom(candidateText);
    if (inferredRoomCount !== null && !targetRoomCounts.includes(inferredRoomCount)) return false;
  }

  const textAddress = `${normalized.address_text || ''}${raw?.address?.address_raw || ''}`;
  const sigungu = asText(queryHint.sigungu);
  if (sigungu) {
    const normalizedSigungu = sigungu.replace(/시|구$/g, '');
    const normalizedAddress = asText(textAddress).replace(/시|구$/g, '');
    if (normalizedAddress && !normalizedAddress.includes(normalizedSigungu)) return false;
  }
  return true;
}

function getParsedAreaValue(parsed) {
  const normalized = parsed?.normalized || {};
  return normalized.area_exclusive_m2
    ?? normalized.area_gross_m2
    ?? normalized.area_exclusive_m2_min
    ?? normalized.area_gross_m2_min
    ?? null;
}

function findListingArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (payload?.houses?.recommend?.image && Array.isArray(payload.houses.recommend.image)) return payload.houses.recommend.image;
  if (payload?.houses?.recommend?.list && Array.isArray(payload.houses.recommend.list)) return payload.houses.recommend.list;
  if (payload?.houses?.withoutFee?.image && Array.isArray(payload.houses.withoutFee.image)) return payload.houses.withoutFee.image;
  if (payload?.houses?.withFee?.image && Array.isArray(payload.houses.withFee.image)) return payload.houses.withFee.image;
  if (payload?.houses?.withoutFee?.list && Array.isArray(payload.houses.withoutFee.list)) return payload.houses.withoutFee.list;
  if (payload?.houses?.withFee?.list && Array.isArray(payload.houses.withFee.list)) return payload.houses.withFee.list;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result?.items)) return payload.result.items;
  if (Array.isArray(payload?.result?.list)) return payload.result.list;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.listings)) return payload.listings;
  if (Array.isArray(payload?.rooms)) return payload.rooms;

  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

function extractListingId(item) {
  if (!item || typeof item !== 'object') return '';
  return asText(
    item.hidx || item.itemNo || item.articleNo || item.article_id || item.item_id || item.id || item._id || item.roomNo || item.room_id || item.idKey ||
      item.articleNo || item.article_number || item.articleNumber || item.houseId || item.house_id || item.houseNo || item.propertyId || item.property_id || item.idx,
  );
}

function pickListingUrl(home, platformCode, item) {
  const directUrls = dedupeStrings([
    item?.url,
    item?.link,
    item?.href,
    item?.detailUrl,
    item?.detail_url,
    item?.articleUrl,
    item?.article_url,
    item?.routeUrl,
  ]);
  const id = extractListingId(item);
  const pathTemplates =
    platformCode === 'dabang'
        ? ['/room/', '/rooms/', '/article/', '/articles/', '/house/', '/detail/']
        : platformCode === 'r114'
          ? ['/house-detail.asp', '/house_detail.asp', '/house-detail/', '/house_detail/', '/house/', '/villa/', '/officetel/', '/detail/', '/apartments/', '/apt/']
          : platformCode === 'peterpanz'
            ? ['/house/', '/house-detail/', '/room/', '/detail/', '/property/', '/item/', '/items/', '/apt/']
            : platformCode === 'nemo'
              ? ['/room/', '/rooms/', '/house/', '/house-detail/', '/item/', '/detail/', '/property/', '/search/detail/', '/apart/']
              : platformCode === 'hogangnono'
                ? ['/house/', '/house-detail/', '/item/', '/detail/', '/officetel/', '/rooms/', '/villa/']
                : ['/item/', '/items/', '/apartments/', '/apart/', '/detail/'];

  const builtFromId = id
    ? pathTemplates
      .map((prefix) => `${home}${prefix}${encodeURIComponent(id)}`)
      .concat([`${home}/detail/${encodeURIComponent(id)}`])
    : [];

  return dedupeStrings(directUrls.concat(builtFromId))
    .map((candidate) => normalizeListingUrl(home, candidate))
    .filter(Boolean);
}

function extractListingUrlsFromPayload(platformCode, home, payload) {
  const items = findListingArray(payload);
  if (!Array.isArray(items) || items.length === 0) return [];
  const urls = [];
  for (const item of items) {
    urls.push(...pickListingUrl(home, platformCode, item));
  }
  return dedupeStrings(urls);
}

async function fetchJsonPayload(url, options = {}) {
  const requestInit = {
    method: options.method || 'GET',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      accept: 'application/json,text/plain,*/*;q=0.8',
      'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
      ...(options.headers || {}),
    },
    redirect: 'follow',
  };

  if (options.body) {
    requestInit.body = options.body;
  }
  const res = await fetch(url, {
    ...requestInit,
  });

  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    text,
    payload: safeJsonParse(text),
    finalUrl: res.url,
  };
}

async function collectPlatformApiCandidates(platformCode, home, queryHint = {}, sourceUrl = '') {
  const keyword = buildStealthKeyword(queryHint);
  const minArea = asLocaleInt(queryHint.minAreaM2, asLocaleInt(queryHint.minArea, null));
  const rentMax = asLocaleInt(queryHint.rentMax, null);
  const depositMax = asLocaleInt(queryHint.depositMax, null);
  const sido = asText(queryHint.sido);
  const sigungu = asText(queryHint.sigungu);
  const geoKey = asText(queryHint.sigungu || queryHint.region || '서울시');
  const result = {
    urls: [],
    parsedCandidates: [],
  };
  const isDebug = process.env.DEBUG_PETERP_API === '1';
  const recordParsed = (platformCodeInner, payload) => {
    const items = extractPayloadListingItems(payload);
    const itemCount = Array.isArray(items) ? items.length : 0;
    let parsedCount = 0;
    for (const candidate of collectPayloadParsedCandidates(platformCodeInner, home, queryHint, items)) {
      parsedCount += 1;
      result.parsedCandidates.push(candidate.parsed);
      for (const url of candidate.urls) {
        result.urls.push(url);
      }
      if (!candidate.urls.length && candidate.sourceUrl) {
        result.urls.push(candidate.sourceUrl);
      }
    }
    if (isDebug) {
      console.log(`DEBUG:PETERP_API platform=${platformCodeInner} items=${itemCount} parsed=${parsedCount}`);
    }
  };

  if (platformCode === 'zigbang') {
    const payloadItems = await collectZigbangPayloadCandidates(queryHint);
    const payloadParsed = collectPayloadParsedCandidates(platformCode, home, queryHint, payloadItems);
    for (const item of payloadParsed) {
      for (const u of item.urls) {
        if (u) result.urls.push(u);
      }
      if (!item.urls.length && item.sourceUrl) result.urls.push(item.sourceUrl);
    }
    if (!result.urls.length) {
      for (const fallback of payloadItems) {
        const fallbackUrl = pickPayloadRecordSourceUrl(home, platformCode, fallback);
        if (fallbackUrl) result.urls.push(fallbackUrl);
      }
    }
    return {
      urls: dedupeStrings(result.urls),
      parsedCandidates: payloadParsed.map((item) => item.parsed).filter(Boolean),
    };
  }

  if (platformCode === 'dabang') {
    const payloadItems = await collectDabangPayloadCandidates(home, queryHint);
    const payloadParsed = collectPayloadParsedCandidates(platformCode, home, queryHint, payloadItems);
    for (const item of payloadParsed) {
      for (const u of item.urls) {
        if (u) result.urls.push(u);
      }
      if (!item.urls.length && item.sourceUrl) {
        result.urls.push(item.sourceUrl);
      }
    }
    if (!result.urls.length) {
      for (const payloadItem of payloadItems) {
        const fallbackUrl = pickPayloadRecordSourceUrl(home, platformCode, payloadItem);
        if (fallbackUrl) {
          result.urls.push(fallbackUrl);
        }
      }
    }
    return {
      urls: dedupeStrings(result.urls),
      parsedCandidates: payloadParsed.map((item) => item.parsed).filter(Boolean),
    };
  }

  const peterpanzApiHost = resolvePeterpanzApiHost(home);

  const r114Endpoints = [
    `${home}/z/depot/search/search.keyword.info.ajax.asp`,
    `${home}/search/search.asp`,
    `${home}/search/search.ajax`,
    `${home}/search/search.keyword.info.ajax.asp`,
    `${home}/houses/search`,
  ];
  const peterpanzEndpoints = [
    `${home}/api/geo/addr_dong`,
    `${peterpanzApiHost}/houses/area/pc`,
    `${peterpanzApiHost}/getRegionV2`,
    `${home}/api/search`,
    `${home}/search/list`,
  ];
  const nemoEndpoints = [
    `${home}/api/store/search-list`,
    `${home}/api/store/search-count`,
    `${home}/api/map/grid`,
    `${home}/api/store/search`,
    `${home}/api/region`,
  ];
  const genericEndpoints = [
    `${home}/api/search`,
    `${home}/search`,
    `${home}/api/v1/search`,
    `${home}/api/v2/search`,
    `${home}/api/v1/listings`,
    `${home}/api/listings`,
    `${home}/api/items`,
    `${home}/api/v1/items`,
    `${home}/api/v2/items`,
    `${home}/property/search`,
    `${home}/houses/search`,
  ];

  const endpoints =
    platformCode === 'r114' ? r114Endpoints
        : platformCode === 'peterpanz' ? peterpanzEndpoints
          : platformCode === 'nemo' ? nemoEndpoints
            : genericEndpoints;

  const queryTemplates = [
    { q: keyword, keyword, rentType: '월세', minAreaM2: minArea, depositMax, sido, sigungu },
    { keyword, query: keyword, trade_type: '월세', area_m2_min: minArea, deposit_max: depositMax, bnd: '126.764,37.479:127.183,37.703', sido, sigungu },
    { q: keyword, areaMin: minArea, page: 1, size: 30, sido, sigungu },
  ];
  const r114Templates = [
    { q: geoKey, sido, sigungu, keyword, houseType: 'all', page: 1, size: 20 },
    { keyword: keyword, search_word: geoKey, area: minArea || '', houseType: '월세', page: 1, size: 20, sido },
    { searchTerm: `${keyword} ${geoKey}`.trim(), bnd: '126.764,37.479:127.183,37.703', sido, sigungu },
  ];
  const peterpanzTemplates = [
    { search: geoKey, sido: asText(queryHint.sigungu), dong: asText(queryHint.dong), sort: 'date' },
    { q: geoKey, rent: asLocaleInt(rentMax, ''), deposit: asLocaleInt(depositMax, ''), area: minArea || '' },
    { search_word: asText(queryHint.sigungu), trade_type: '월세', page: 1, size: 20 },
  ];
  const peterpanzAreaFilter = buildPeterpanzFilterFilterFromHint(queryHint, sourceUrl);
  const peterpanzBaseUrl = new URL(`${peterpanzApiHost}/houses/area/pc`);
  const explicitDong = asText(queryHint.dong || parsePeterpanzSourceUrl(sourceUrl).dong || '');
  const peterpanzDongCandidates = explicitDong
    ? [explicitDong]
    : await collectPeterpanzDongCandidates(home, queryHint, sourceUrl);
  const peterpanzQueryDongValues = peterpanzDongCandidates.length
    ? peterpanzDongCandidates
    : [asText(peterpanzAreaFilter.query.dong)];
  const peterpanzApiQueries = [];
  const peterpanzPages = [1, 2, 3];
  for (const pageIndex of peterpanzPages) {
    for (const queryDong of peterpanzQueryDongValues) {
      const params = new URLSearchParams();
      params.set('search', '');
      params.set('response_version', '5.3');
      params.set('filter_version', '5.1');
      params.set('order_by', 'random');
      const requestedPageSize = queryHint.pageSize != null
        ? queryHint.pageSize
        : asLocaleInt(queryHint.limit, 60);
      params.set('pageSize', String(Math.min(80, toLocaleInt(requestedPageSize, 50))));
      params.set('pageIndex', String(pageIndex));
      if (asText(queryDong)) params.set('dong', asText(queryDong));
      if (peterpanzAreaFilter.query.gungu) params.set('gungu', peterpanzAreaFilter.query.gungu);
      if (peterpanzAreaFilter.query.filter) params.set('filter', peterpanzAreaFilter.query.filter);
      if (peterpanzAreaFilter.query.center) params.set('center', peterpanzAreaFilter.query.center);
      if (peterpanzAreaFilter.query.zoomLevel) params.set('zoomLevel', String(peterpanzAreaFilter.query.zoomLevel));
      const sourcePageSize = Number(peterpanzAreaFilter.query.pageSize);
      if (Number.isFinite(sourcePageSize) && sourcePageSize > 0) {
        params.set('pageSize', String(Math.min(80, sourcePageSize)));
      }
      const sourcePageIndex = Number(peterpanzAreaFilter.query.pageIndex);
      if (Number.isFinite(sourcePageIndex) && sourcePageIndex > 0) {
        params.set('pageIndex', String(sourcePageIndex));
      }
      peterpanzApiQueries.push({
        url: `${peterpanzBaseUrl.toString()}?${params.toString()}`,
      });
    }
  }
  const nemoTemplates = [
    { search_word: geoKey, sido: sido, sigungu },
    { keyword: geoKey, rent_type: '월세', page: 1, size: 20 },
    { sido: sido, city: asText(queryHint.sigungu), area_min: minArea || '' },
  ];
  const templates =
    platformCode === 'r114' ? r114Templates
      : platformCode === 'peterpanz' ? peterpanzTemplates
        : platformCode === 'nemo' ? nemoTemplates
          : queryTemplates;

  const endpointProbe = async (method, requestUrl, body) => {
    const response = await fetchJsonPayload(requestUrl, body ? { method, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body } : { method });
    if (!response.ok || !response.payload) return;
    const payload = safeJsonParse(response.text);
    if (!payload) return;
    if (isDebug) {
      const rootKeys = Array.isArray(payload) ? ['[array]'] : Object.keys(payload || {});
      const listingItems = Array.isArray(findListingArray(payload)) ? findListingArray(payload).length : 0;
      console.log(`DEBUG:PETERP_API_RESPONSE platform=${platformCode} url=${requestUrl} status=${response.status} keys=${rootKeys.join(',')} items=${listingItems}`);
    }
    const urls = extractListingUrlsFromPayload(platformCode, home, payload);
    for (const url of urls) {
      result.urls.push(url);
    }
    recordParsed(platformCode, payload);
  };

  const peterpanzSpecificQueries = platformCode === 'peterpanz' ? peterpanzApiQueries : null;
  const targets = platformCode === 'peterpanz' ? peterpanzSpecificQueries : endpoints.flatMap((endpoint) => templates.map((query) => ({ endpoint, query })));

  for (const targetItem of targets) {
    const endpoint = platformCode === 'peterpanz' ? targetItem.url : targetItem.endpoint;
    const query = platformCode === 'peterpanz' ? null : targetItem.query;
    try {
      if (platformCode === 'peterpanz') {
        await endpointProbe('GET', endpoint);
        continue;
      }
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === null || v === undefined || v === '') continue;
        params.set(k, String(v));
      }
      const queryString = params.toString();
      const requestUrl = queryString ?
        (endpoint.includes('?') ? `${endpoint}&${queryString}` : `${endpoint}?${queryString}`)
        : endpoint;
      await endpointProbe('GET', requestUrl);
      if (platformCode === 'r114' && endpoint.includes('search.keyword.info.ajax.asp')) {
        const body = new URLSearchParams({
          searchType: 'home',
          searchWord: String(query.search_word || query.keyword || keyword || geoKey),
          area: minArea || '',
        }).toString();
        await endpointProbe('POST', `${home}/z/depot/search/search.keyword.info.ajax.asp`, body);
      }
    } catch {
      continue;
    }
  }

  return {
    urls: dedupeStrings(result.urls),
    parsedCandidates: result.parsedCandidates,
  };
}

async function collectStealthSeedUrl(target) {
  const isDebug = process.env.DEBUG_PETERP_API === '1';
  const pageInfo = {
    status: null,
    parse_error: null,
    sample_status: null,
    note: '',
    fetchedAt: new Date().toISOString(),
    rawHash: null,
  };

  const platformCode = resolveStealthPlatformCode(target.platform_code || target.platform, target.source_url);
  if (platformCode === 'naver') {
    return collectNaverStealthCandidate(target.query_hint || {
      sigungu: asText(target.sigungu || target.region || ''),
      sido: asText(target.sido || target.regionProvince || '서울시'),
      leaseType: asText(target.leaseType || '월세'),
      rentMax: asLocaleInt(target.rentMax, asLocaleInt(target.rent_max, null)),
      depositMax: asLocaleInt(target.depositMax, asLocaleInt(target.deposit_max, null)),
      minAreaM2: asLocaleInt(target.minAreaM2, asLocaleInt(target.minArea, 40)),
      minArea: asLocaleInt(target.minArea, asLocaleInt(target.min_area, 40)),
      propertyTypes: safeArray(target.propertyTypes),
    });
  }

  const seedUrl = buildStealthSeedUrl(platformCode, target.source_url, target.query_hint || {});
  if (!seedUrl) {
    pageInfo.parse_error = 'stealth_seed_missing_url';
    pageInfo.sample_status = 'FAILED';
    return { parsed: null, pageInfo };
  }

  const queryHint = target.query_hint || {};
  const keyword = buildStealthKeyword(queryHint);
  const home = STEALTH_HOME_BY_CODE[platformCode] || asText(target.source_url);
  const listingUrlSet = new Set();
  let fallbackParsed = null;
  let apiCandidates = [];
  let apiParsedCandidates = [];

  try {
    const apiProbe = await collectPlatformApiCandidates(platformCode, home, queryHint, target.source_url || seedUrl);
    apiCandidates = dedupeStrings(Array.isArray(apiProbe?.urls) ? apiProbe.urls : []);
    const unwrapParsedCandidate = (candidate) => (candidate && candidate.parsed ? candidate.parsed : candidate);
    apiParsedCandidates = Array.isArray(apiProbe?.parsedCandidates)
      ? apiProbe.parsedCandidates.map((candidate) => ({
          parsed: unwrapParsedCandidate(candidate),
          sourceUrl: candidate?.sourceUrl || candidate?.parsed?.sourceUrl || '',
        })).filter((candidate) => candidate?.parsed && typeof candidate.parsed === 'object')
      : [];
    if (process.env.DEBUG_PETERP_API === '1') {
      const querySigungu = asText(queryHint.sigungu || queryHint.region);
      const queryRoomType = Array.isArray(queryHint.roomType) ? queryHint.roomType.join(',') : asText(queryHint.roomType);
      const queryDebug = [querySigungu, queryRoomType, asLocaleInt(queryHint.minAreaM2, queryHint.minArea)].filter(Boolean).join('|');
      console.log(`DEBUG:PETERP_COLLECT platform=${platformCode} debug_query="${queryDebug}" raw_candidates=${apiProbe?.parsedCandidates?.length || 0} apiCandidates=${apiCandidates.length}`);
      const firstParsed = apiParsedCandidates[0];
      console.log(`DEBUG:PETERP_RAW_TYPE=${Array.isArray(apiParsedCandidates) ? 'array' : typeof apiParsedCandidates} firstCandidateKeys=${firstParsed ? Object.keys(firstParsed).join('|') : ''}`);
      if (apiProbe?.parsedCandidates?.length) {
        const required = apiParsedCandidates.filter((candidate) => candidate?.parsed?.requiredFields);
        console.log(`DEBUG:PETERP_PARSED platform=${platformCode} parsed=${apiParsedCandidates.length} required=${required.length}`);
      }
    }
    apiParsedCandidates = apiParsedCandidates
      .filter((candidate) => {
        if (process.env.DEBUG_PETERP_API === '1' && platformCode === 'peterpanz') {
          const debugMatchState = candidate?.parsed ? matchesQueryForParsed(candidate.parsed, queryHint) : null;
          console.log(
            `DEBUG:PETERP_FILTER_STEP`,
            JSON.stringify({
              sourceUrl: candidate?.sourceUrl || candidate?.parsed?.sourceUrl || '',
              hasParsed: Boolean(candidate?.parsed),
              match: debugMatchState,
              required: Boolean(candidate?.parsed?.requiredFields),
              area: candidate?.parsed?.normalized?.area_exclusive_m2,
            }),
          );
          if (!debugMatchState) {
            const normalized = candidate?.parsed?.normalized || {};
            console.log('DEBUG:PETERP_FILTER_DROP', JSON.stringify({
              sourceUrl: candidate?.sourceUrl || candidate?.parsed?.sourceUrl || '',
              address: normalized.address_text,
              sigunguQuery: asText(queryHint.sigungu),
              room: normalized.room_count,
            }));
          }
          return Boolean(debugMatchState);
        }
        if (!candidate?.parsed) return false;
        const match = matchesQueryForParsed(candidate.parsed, queryHint);
        if (process.env.DEBUG_PETERP_API === '1' && platformCode === 'peterpanz' && !match) {
          const normalized = candidate.parsed.normalized || {};
          const raw = candidate.parsed.raw || {};
          console.log('DEBUG:PETERP_FILTER_DROP', JSON.stringify({
            sourceUrl: candidate.sourceUrl || candidate.parsed.sourceUrl || '',
            area: normalized.area_exclusive_m2,
            rent: normalized.rent_amount,
            deposit: normalized.deposit_amount,
            sigunguQuery: asText(queryHint.sigungu),
            addressText: normalized.address_text,
            room: normalized.room_count,
            roomHint: parseTargetRoomCounts(queryHint),
          }));
        }
        return match;
      })
      .sort((a, b) => {
        const aArea = getParsedAreaValue(a?.parsed) || -1;
        const bArea = getParsedAreaValue(b?.parsed) || -1;
        if (aArea !== bArea) return bArea - aArea;
        return 0;
      });
    if (process.env.DEBUG_PETERP_API === '1') {
      console.log(`DEBUG:PETERP_FILTER platform=${platformCode} filtered=${apiParsedCandidates.length} first_required=${Boolean(apiParsedCandidates[0]?.parsed?.requiredFields)}`);
    }
    if (process.env.DEBUG_PETERP_API === '1') {
      console.log(`DEBUG:PETERP_BRANCH_CHECK platform=${platformCode} length=${apiParsedCandidates.length}`);
    }
    const firstRequired = apiParsedCandidates.find((candidate) => candidate?.parsed?.requiredFields);
    if (!fallbackParsed && firstRequired) {
      fallbackParsed = firstRequired.parsed;
    }

    if (platformCode === 'peterpanz' && apiParsedCandidates.length) {
      console.log('DEBUG:PETERP_BRANCH_ENTER');
      const first = apiParsedCandidates[0];
      const parsedType = first && typeof first === 'object' ? typeof first.parsed : typeof first;
      console.log(`DEBUG:PETERP_BRANCH_FIRST type=${parsedType} source=${first?.sourceUrl || ''}`);
      if (isDebug) {
        console.log('DEBUG:PETERP_BRANCH_FIRST_KEYS', JSON.stringify(first ? Object.keys(first) : []));
      }
      const apiRequired = apiParsedCandidates.find((candidate) => candidate?.parsed?.requiredFields);
      if (isDebug) {
        const apiRequiredCount = apiParsedCandidates.filter((candidate) => candidate?.parsed?.requiredFields).length;
        console.log(`DEBUG:PETERP_API_BRANCH platform=${platformCode} apiParsed=${apiParsedCandidates.length} required=${apiRequiredCount}`);
      }
      if (apiRequired?.parsed) {
        console.log('DEBUG:PETERP_BRANCH_RETURN_REQUIRED');
        pageInfo.sample_status = 'SUCCESS';
        pageInfo.parse_error = null;
        pageInfo.note = pageInfo.note ? `${pageInfo.note};peterpanz_api_required` : 'peterpanz_api_required';
        return { parsed: apiRequired.parsed, pageInfo };
      }
      const apiPartial = apiParsedCandidates[0]?.parsed;
      if (apiPartial) {
        console.log('DEBUG:PETERP_BRANCH_RETURN_PARTIAL');
        pageInfo.sample_status = 'FAILED';
        pageInfo.parse_error = 'STEALTH_LISTING_PARTIAL_PARSE';
        pageInfo.note = pageInfo.note ? `${pageInfo.note};peterpanz_api_partial` : 'peterpanz_api_partial';
        return { parsed: apiPartial, pageInfo };
      }
    }
  } catch {
    // keep using browser path if API 후보 수집이 실패하더라도 진행
  }

  if (platformCode === 'zigbang') {
    try {
      const payloadItems = await collectZigbangPayloadCandidates(queryHint);
      const payloadCandidates = collectPayloadParsedCandidates(platformCode, home, queryHint, payloadItems);
      if (payloadCandidates.length) {
        for (const candidate of payloadCandidates) {
          for (const listingUrlCandidate of candidate.urls) {
            if (isLikelyListingUrl(platformCode, listingUrlCandidate)) {
              listingUrlSet.add(listingUrlCandidate);
            }
          }
          if (
            candidate.sourceUrl
            && isLikelyListingUrl(platformCode, candidate.sourceUrl)
            && !listingUrlSet.has(candidate.sourceUrl)
          ) {
            listingUrlSet.add(candidate.sourceUrl);
          }
          if (!fallbackParsed) fallbackParsed = candidate.parsed;
          if (candidate.parsed.requiredFields) {
            pageInfo.sample_status = 'SUCCESS';
            pageInfo.parse_error = null;
            pageInfo.note = `zigbang_payload_required:${payloadCandidates.length}`;
            pageInfo.rawHash = simpleHash(candidate.sourceUrl || '');
            return { parsed: candidate.parsed, pageInfo };
          }
        }
        pageInfo.note = `zigbang_payload_${payloadItems.length}`;
      } else {
        pageInfo.note = 'zigbang_payload_empty';
      }
    } catch {
      pageInfo.note = pageInfo.note ? `${pageInfo.note};zigbang_payload_error` : 'zigbang_payload_error';
    }
  }

  const shouldHandleResponse = (responseUrl) => {
    if (!responseUrl) return false;
    if (platformCode === 'dabang') {
      return responseUrl.includes('/api/v5/loc/search')
        || responseUrl.includes('/api/v5/room-list/recommend/home-ai/region')
        || responseUrl.includes('/api/v5/room-list/category/house-villa')
        || responseUrl.includes('/api/v5/markers/category/house-villa');
    }
    if (platformCode === 'r114') {
      if (responseUrl.includes('/search/search.asp') || responseUrl.includes('dq_common.js')) return true;
      if (/search\.keyword\.info\.ajax\.asp/i.test(responseUrl)) return true;
    }
    if (platformCode === 'zigbang') {
      return responseUrl.includes('/house/property/v1/items');
    }
    if (/\/.+\/api\//i.test(responseUrl) || /\/.+\.json/i.test(responseUrl)) return true;
    return false;
  };

  const onResponse = (response) => {
    const responseUrl = response.url();
    if (!shouldHandleResponse(responseUrl)) return;
    if (!response.ok()) return;
    void (async () => {
      try {
        const text = await response.text();
        const payload = safeJsonParse(text);
        if (!payload) return;
        const urls = extractListingUrlsFromPayload(platformCode, home, payload);
        for (const u of urls) listingUrlSet.add(u);

        const payloadItems = findListingArray(payload);
        const parsedPayloads = collectPayloadParsedCandidates(platformCode, home, queryHint, payloadItems);
        if (parsedPayloads.length > 0) {
          if (!fallbackParsed) {
            const firstRequired = parsedPayloads.find((v) => v.parsed.requiredFields);
            fallbackParsed = (firstRequired || parsedPayloads[0]).parsed;
          }
        }
      } catch {
        return;
      }
    })();
  };

  const closeInterruptions = async (pageInstance) => {
    const candidates = [
      '[id*="modal"] [id*="close" i]',
      '[class*="modal"] [class*="close" i]',
      '[id*="popup"] [id*="close" i]',
      '[class*="popup"] [class*="close" i]',
      '[class*="layer-pop"] [class*="btn-close"]',
      '[class*="ad"] [class*="close" i]',
      '[aria-label="close"]',
      '[aria-label="닫기"]',
      '.ico-close',
      '.close-pop',
      'button:has-text("닫기")',
    ];
    for (const selector of candidates) {
      try {
        const locator = pageInstance.locator(selector);
        const count = await locator.count();
        for (let i = 0; i < count; i += 1) {
          const node = locator.nth(i);
          if (await node.isVisible({ timeout: 300 })) {
            await node.click({ timeout: 600 });
          }
        }
      } catch {
        // ignore
      }
    }
    try {
      await pageInstance.keyboard.press('Escape');
    } catch {
      // ignore
    }
  };

  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      locale: 'ko-KR',
      viewport: { width: 1280, height: 900 },
      timezoneId: 'Asia/Seoul',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    page.on('response', onResponse);

    const seedCandidates = dedupeStrings([
      ...buildStealthSeedUrlCandidates(platformCode, target.source_url, queryHint),
      ...(target.source_url ? [target.source_url] : []),
    ]);
    let seedHtml = '';
    let usedSeedUrl = '';
    for (const attemptUrl of seedCandidates) {
      const seedResponse = await page.goto(attemptUrl, { waitUntil: 'domcontentloaded' });
      const status = seedResponse?.status?.() ?? null;
      if (status === 404) {
        continue;
      }
      usedSeedUrl = attemptUrl;
      pageInfo.status = status;
      seedHtml = await page.content();
      if (isBlockedContent(seedHtml)) {
        pageInfo.note = `blocked_seed:${attemptUrl}`;
        seedHtml = '';
        continue;
      }
      await closeInterruptions(page);
      pageInfo.rawHash = simpleHash(attemptUrl + seedHtml.slice(0, 1000));
      break;
    }
    if (!seedHtml) {
      if (fallbackParsed && fallbackParsed.requiredFields) {
        pageInfo.sample_status = 'SUCCESS';
        pageInfo.parse_error = null;
        pageInfo.note = 'stealth_seed_all_attempts_failed;api_parsed_fallback';
        return { parsed: fallbackParsed, pageInfo };
      }
        if (apiCandidates.length) {
        for (const listingUrl of apiCandidates.slice(0, 8)) {
          try {
            const fetched = await fetchJsonPayload(listingUrl);
            if (!fetched.ok || !fetched.payload) {
              const htmlRes = await fetchHtml(listingUrl);
              if (!htmlRes || htmlRes.blocked) continue;
              const parsed = parseListing(platformCode, htmlRes.text, listingUrl);
              if (!matchesQueryForParsed(parsed, queryHint)) continue;
              if (!fallbackParsed) fallbackParsed = parsed;
              if (parsed.requiredFields) {
                pageInfo.sample_status = 'SUCCESS';
                pageInfo.parse_error = null;
                pageInfo.note = 'stealth_seed_all_attempts_failed;api_listing_fallback';
                return { parsed, pageInfo };
              }
              continue;
            }
            const payloadItems = extractPayloadListingItems(fetched.payload);
            for (const item of payloadItems) {
              const parsedCandidate = buildParsedRecordFromPayload(platformCode, listingUrl, item, {
                fallback: buildParsedAddressFallback(queryHint),
              });
              if (!parsedCandidate) continue;
              if (!matchesQueryForParsed(parsedCandidate, queryHint)) continue;
              if (!fallbackParsed) fallbackParsed = parsedCandidate;
              if (parsedCandidate.requiredFields) {
                pageInfo.sample_status = 'SUCCESS';
                pageInfo.parse_error = null;
                pageInfo.note = `stealth_seed_all_attempts_failed;api_json_listing_fallback:${parsedCandidate.sourceUrl || listingUrl}`;
                return { parsed: parsedCandidate, pageInfo };
              }
            }
          } catch {
            continue;
          }
        }
      }
      if (apiParsedCandidates.length) {
        const fallbackParsedOnly = (apiParsedCandidates.find((candidate) => candidate?.parsed?.requiredFields) || apiParsedCandidates[0])?.parsed;
        if (fallbackParsedOnly && !matchesQueryForParsed(fallbackParsedOnly, queryHint)) {
          pageInfo.parse_error = 'STEALTH_NO_VALID_SEED_RESPONSE';
          pageInfo.sample_status = 'FAILED';
          pageInfo.note = 'stealth_seed_all_attempts_failed;api_candidates_query_miss';
          return { parsed: fallbackParsed, pageInfo };
        }
        if (fallbackParsedOnly) {
          pageInfo.sample_status = fallbackParsedOnly.requiredFields ? 'SUCCESS' : 'FAILED';
          pageInfo.parse_error = fallbackParsedOnly.requiredFields ? null : 'STEALTH_LISTING_PARTIAL_PARSE';
          pageInfo.note = 'stealth_seed_all_attempts_failed;api_candidates_partial';
          return { parsed: fallbackParsedOnly, pageInfo };
        }
      }
      pageInfo.parse_error = 'STEALTH_NO_VALID_SEED_RESPONSE';
      pageInfo.sample_status = 'FAILED';
      pageInfo.note = 'stealth_seed_all_attempts_failed';
      return { parsed: fallbackParsed, pageInfo };
    }

    try {
      if (platformCode === 'dabang') {
        const mapInput = page.getByPlaceholder(/검색/);
        const directInput = page.locator('#search-input');
        const targetInput = (await directInput.count()) > 0 ? directInput : mapInput;
        if (await targetInput.count()) {
          await targetInput.first().fill(keyword || '서울 월세');
          await targetInput.first().press('Enter');
          await page.waitForTimeout(1200);
        }
      }

      if (platformCode === 'r114') {
        const termInput = page.locator('#dqSearchTerm, #searchTerm, input[name="searchWord" i], input[name="search_word" i], input[placeholder*="지역" i], input[placeholder*="검색" i]');
        if (await termInput.count()) {
          await termInput.first().fill(keyword || '서울 월세');
          const form = page.locator('#dqSearchForm');
          if (await form.count()) {
            try {
              await form.first().evaluate((node) => {
                if (node && node.reportValidity) {
                  node.reportValidity();
                }
                node.submit();
              });
            } catch {
              await termInput.first().press('Enter');
            }
          } else {
            await termInput.first().press('Enter');
          }
          await page.waitForTimeout(1400);
        }
      }

      if (platformCode === 'zigbang') {
        const searchInput = page.locator('input[type="search"], input[placeholder*="검색"]');
        if (await searchInput.count()) {
          await searchInput.first().fill(keyword || '서울 월세');
          await searchInput.first().press('Enter');
          await page.waitForTimeout(1200);
        }
      }

      if (platformCode !== 'dabang' && platformCode !== 'zigbang') {
        const genericInput = page.locator('input[type="search"], input[placeholder*="검색"], input[name*="search" i], input[id*="search" i], textarea[placeholder*="검색"]');
        if (await genericInput.count()) {
          await genericInput.first().fill(keyword || '서울 월세');
          await genericInput.first().press('Enter');
          await page.waitForTimeout(1200);
        }
      }
    } catch {
      // keep going if search interaction fails
    }

    for (let i = 0; i < 3; i += 1) {
      await page.waitForTimeout(900);
      await page.mouse.wheel(0, 500);
    }
    await page.waitForTimeout(1800);

    for (const url of apiCandidates) listingUrlSet.add(url);
    for (const candidate of apiParsedCandidates) {
      const parsedCandidate = candidate?.parsed;
      if (!fallbackParsed && parsedCandidate?.requiredFields && matchesQueryForParsed(parsedCandidate, queryHint)) {
        fallbackParsed = parsedCandidate;
      }
    }

    const domLinks = await page.$$eval('a[href]', (nodes) => nodes
      .map((node) => {
        const text = (node.textContent || '').trim();
        return { href: node.getAttribute('href') || '', text };
      })
      .filter((x) => x.href && x.text));

    for (const item of domLinks) {
      const href = normalizeListingUrl(usedSeedUrl || seedUrl, item.href);
      if (isLikelyListingUrl(platformCode, href)) listingUrlSet.add(href);
    }
    for (const href of extractListingUrlsFromHtml(platformCode, seedHtml, usedSeedUrl || seedUrl)) {
      if (isLikelyListingUrl(platformCode, href)) listingUrlSet.add(href);
    }

    if (platformCode === 'dabang' && listingUrlSet.size < 3 && home) {
      const fallbackTargets = [`${home}/map/house?q=${encodeURIComponent(keyword)}`, `${home}/map/house`];
      for (const fallbackTarget of fallbackTargets) {
        try {
          const fallbackResponse = await page.goto(fallbackTarget, { waitUntil: 'domcontentloaded' });
          const fallbackStatus = fallbackResponse?.status?.() ?? null;
          pageInfo.status = pageInfo.status || fallbackStatus;
          const fallbackHtml = await page.content();
          const fallbackLinks = await page.$$eval('a[href]', (nodes) => nodes
            .map((node) => ({ href: node.getAttribute('href') || '', text: (node.textContent || '').trim() }))
            .filter((x) => x.href && x.text));
          for (const item of fallbackLinks) {
            const href = normalizeListingUrl(fallbackTarget, item.href);
            if (isLikelyListingUrl(platformCode, href)) listingUrlSet.add(href);
          }
          for (const href of extractListingUrlsFromHtml(platformCode, fallbackHtml, fallbackTarget)) {
            if (isLikelyListingUrl(platformCode, href)) listingUrlSet.add(href);
          }
        } catch {
          continue;
        }
      }
    }

    const urlCandidates = Array.from(listingUrlSet)
      .filter((href) => isLikelyListingUrl(platformCode, href))
      .slice(0, 10);

    if (fallbackParsed && fallbackParsed.requiredFields) {
      pageInfo.sample_status = 'SUCCESS';
      pageInfo.parse_error = null;
      pageInfo.note = `${pageInfo.note ? `${pageInfo.note};` : ''}fallback_api_required:${fallbackParsed.sourceUrl}`;
      return { parsed: fallbackParsed, pageInfo };
    }

    if (!urlCandidates.length) {
      if (fallbackParsed) {
        pageInfo.sample_status = fallbackParsed.requiredFields ? 'SUCCESS' : 'FAILED';
        pageInfo.parse_error = fallbackParsed.requiredFields
          ? null
          : (pageInfo.parse_error || 'STEALTH_LISTING_PARTIAL_PARSE');
        pageInfo.note = `${pageInfo.note ? `${pageInfo.note};` : ''}stealth_seed_links:0`;
        return { parsed: fallbackParsed, pageInfo };
      }
      pageInfo.parse_error = 'STEALTH_NO_LISTING_LINKS';
      pageInfo.sample_status = 'FAILED';
      pageInfo.note = 'stealth_seed_has_no_listing_links';
      return { parsed: null, pageInfo };
    }

    pageInfo.note = `stealth_seed_links:${urlCandidates.length}`;
    for (let i = 0; i < urlCandidates.length; i += 1) {
      const listingUrl = urlCandidates[i];
      try {
        const detailRes = await page.goto(listingUrl, { waitUntil: 'domcontentloaded' });
        const detailStatus = detailRes?.status?.() ?? null;
        if (detailStatus && detailStatus >= 400) {
          continue;
        }
        const detailHtml = await page.content();
        if (isBlockedContent(detailHtml)) {
          pageInfo.note = `detail_blocked:${listingUrl}`;
          continue;
        }
        const parsed = parseListing(target.platform || platformCode, detailHtml, listingUrl);
        if (!matchesQueryForParsed(parsed, queryHint)) {
          continue;
        }
        if (!fallbackParsed) fallbackParsed = parsed;
        if (parsed.requiredFields) {
          pageInfo.sample_status = 'SUCCESS';
          pageInfo.parse_error = null;
          pageInfo.status = detailStatus || pageInfo.status;
          return { parsed, pageInfo };
        }
      } catch {
        continue;
      }
    }

    if (!fallbackParsed) {
      pageInfo.parse_error = 'STEALTH_LISTING_PARSE_FAIL';
      pageInfo.sample_status = 'FAILED';
      return { parsed: null, pageInfo };
    }

    pageInfo.sample_status = fallbackParsed.requiredFields ? 'SUCCESS' : 'FAILED';
    pageInfo.parse_error = fallbackParsed.requiredFields ? null : 'STEALTH_LISTING_PARTIAL_PARSE';
    return { parsed: fallbackParsed, pageInfo };
  } catch (e) {
    pageInfo.parse_error = `STEALTH_BROWSER_ERROR:${e?.message || String(e)}`;
    pageInfo.sample_status = 'FAILED';
    return { parsed: null, pageInfo };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
      referer: new URL(url).origin,
    },
    redirect: 'follow',
  });
  const status = res.status;
  const text = await res.text();
  return { status, text, finalUrl: res.url, blocked: status === 403 || status === 429 || /bot|차단|forbidden|access denied/i.test(text.slice(0, 16000)) };
}

async function collectOne(target) {
  const pageInfo = {
    status: null,
    parse_error: null,
    sample_status: null,
    note: '',
    fetchedAt: new Date().toISOString(),
    rawHash: null,
  };
  try {
    let source = target.source_url || '';
    const sourceType = target.source_type || target.sourceType || '';
    const sourceMode = asText(target.mode || '').toUpperCase();
    const shouldUseStealth = new Set(['stealth_seed_url', 'blocked_seed_url', 'query_probe_url']).has(sourceType) ||
      sourceMode === 'STEALTH_AUTOMATION';

    if (shouldUseStealth && target.query_hint) {
      const stealthResult = await collectStealthSeedUrl(target);
      return {
        parsed: stealthResult.parsed,
        pageInfo: stealthResult.pageInfo,
      };
    }

    let html = '';
    if (!isAbsoluteUrl(source)) {
      if (!target.snapshot_file) {
        pageInfo.parse_error = 'invalid_url';
        return {
          parsed: null,
          pageInfo: pageInfo,
        };
      }
      source = `snapshot://${target.snapshot_file}`;
      pageInfo.status = 200;
    }

    if (target.snapshot_file) {
      const p = path.resolve(path.dirname(inputPath), target.snapshot_file);
      html = fs.readFileSync(p, 'utf8');
      pageInfo.note = `snapshot:${target.snapshot_file}`;
      pageInfo.status = 200;
    } else {
      const fetchResult = await fetchHtml(source);
      pageInfo.status = fetchResult.status;
      html = fetchResult.text;
      if (fetchResult.blocked) {
        pageInfo.parse_error = 'SOURCE_ACCESS_BLOCKED';
        pageInfo.note = 'blocked_or_403';
        pageInfo.sample_status = 'FAILED';
        return {
          parsed: null,
          pageInfo,
        };
      }
    }

    pageInfo.rawHash = simpleHash(source + html.slice(0, 1000));
    const parsed = parseListing(target.platform, html, source);
    pageInfo.sample_status = parsed?.requiredFields ? 'SUCCESS' : 'FAILED';
    if (!parsed?.requiredFields && !pageInfo.parse_error) {
      pageInfo.parse_error = 'required_field_missing';
    }
    const platform = target.platform || target.platform_code || '';
    return { parsed, pageInfo };
  } catch (e) {
    pageInfo.parse_error = `collect_failed:${e.message || String(e)}`;
    pageInfo.sample_status = 'FAILED';
    return { parsed: null, pageInfo };
  }
}

async function main() {
  const inputRaw = fs.readFileSync(inputPath, 'utf8');
  const input = JSON.parse(inputRaw);
  const targets = Array.isArray(input.targets) ? input.targets : [];
  const modeGroups = new Map();

  for (const target of targets) {
    if (!target.platform) continue;
    const list = modeGroups.get(target.platform) || [];
    if (Number.isFinite(sampleCap) && list.length >= sampleCap) continue;
    list.push(target);
    modeGroups.set(target.platform, list);
  }

  const result = {
    runMeta: {
      ...(input.runMeta || defaultRunMeta),
    },
    thresholds: input.thresholds || {
      requiredFieldsRate: 0.85,
      violationRate: 0.08,
      parseFailRate: 0.08,
      imageValidRate: 0.9,
    },
    platforms: [],
  };

  const discoveredPlatformOrder = Array.from(
    new Set(
      targets
        .map((t) => t.platform)
        .filter((v) => typeof v === 'string' && v.length > 0),
    ),
  );
  const platformOrder = discoveredPlatformOrder.length > 0
    ? discoveredPlatformOrder
    : ['직방', '다방', '네이버 부동산'];
  for (const platform of platformOrder) {
    const samples = [];
    const list = modeGroups.get(platform) || [];
    for (const target of list) {
      const platformName = target.platform;
      const { parsed, pageInfo } = await collectOne(target);
      if (!parsed) {
        samples.push({
          sample_status: pageInfo.sample_status || 'FAILED',
          source_id: target.source_id || '',
          source_url: target.source_url || '',
        mode: target.mode || 'STEALTH_AUTOMATION',
          requiredFields: 'N',
          rent_raw: '',
          rent_norm: null,
          deposit_raw: '',
          deposit_norm: null,
          area_raw: '',
          area_type: 'estimated',
          area_norm_m2: null,
          address_raw: '',
          address_norm_code: null,
          room_count: null,
          floor: null,
          total_floor: null,
          images_cnt: 0,
          images_valid_cnt: 0,
          images_duplicate_cnt: 0,
          contract_violations: true,
          parse_error: pageInfo.parse_error || 'parse_failed',
          sample_note: pageInfo.note || '',
          sample_platform: platformName,
          http_status: pageInfo.status,
          collected_mode: target.mode || 'STEALTH_AUTOMATION',
          fetched_at: pageInfo.fetchedAt,
          raw_hash_preview: pageInfo.rawHash,
        });
        continue;
      }
      samples.push(buildSample(platformName, target, parsed, pageInfo));
      await sleep(requestDelayMs);
    }
    result.platforms.push({ name: platform, mode: list[0]?.mode || 'STEALTH_AUTOMATION', samples });
  }

  // include declared platforms not in input order (with zero samples)
  const expectedOrder = platformOrder;
  for (const p of expectedOrder) {
    if (!result.platforms.find((x) => x.name === p)) {
      result.platforms.push({ name: p, mode: 'STEALTH_AUTOMATION', samples: [] });
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ written: outPath, platforms: result.platforms.map((p) => ({ name: p.name, sampled: p.samples.length })) }, null, 2));
}

main().catch((err) => {
  console.error('collect failed', err?.message || err);
  process.exit(1);
});
