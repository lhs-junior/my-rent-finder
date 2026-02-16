#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.findIndex((v) => v === name || v.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split('=').slice(1).join('=') ?? fallback;
}

function getBoolArg(name, fallback = false) {
  if (args.includes(name)) {
    const idx = args.findIndex((v) => v === name);
    const next = args[idx + 1];
    if (!next || next.startsWith('--')) return true;
  }
  const raw = getArg(name, null);
  if (raw === null) return fallback;
  if (typeof raw === 'boolean') return raw;
  return ['1', 'true', 'y', 'yes'].includes(String(raw).toLowerCase());
}

const inputPath = getArg('--conditions', path.join(process.cwd(), 'scripts/platform_search_conditions.json'));
const probeOutPath = getArg('--probe-out', path.join(process.cwd(), 'scripts/platform_query_probe_results.json'));
const targetsOutPath = getArg('--targets-out', path.join(process.cwd(), 'scripts/platform_sampling_targets.json'));
const timeoutMs = Number(getArg('--timeout-ms', '12000'));
const delayMs = Number(getArg('--delay-ms', '700'));
const userAgent = getArg(
  '--ua',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
);
const doWriteTargets = getBoolArg('--write-targets', true);
const sampleCapDefault = 100;
function normalizeSampleCap(raw, fallback = sampleCapDefault) {
  const parsed = Number(raw);
  if (raw === null || raw === undefined || Number.isNaN(parsed)) return fallback;
  if (parsed < 0) return fallback;
  if (!Number.isFinite(parsed) || parsed === 0) return Number.POSITIVE_INFINITY;
  return Math.floor(parsed);
}
function sliceLimit(cap, totalCount) {
  if (!Number.isFinite(cap)) return totalCount;
  return Math.max(1, cap);
}
const sampleCap = normalizeSampleCap(getArg('--sample-cap', String(sampleCapDefault)));
const inputSourceName = getArg('--condition-source', 'platform_search_conditions.json');
const condSido = getArg('--sido');
const condSigungu = getArg('--sigungu');
const condDong = getArg('--dong');
const condLeaseType = getArg('--lease-type');
const condRentMin = getArg('--rent-min');
const condRentMax = getArg('--rent-max');
const condDepositMax = getArg('--deposit-max');
const condMinArea = getArg('--min-area');
const condPropertyTypes = getArg('--property-types'); // comma-separated list
const outputConditionOnly = getBoolArg('--print-condition-only', false);

const defaults = {
  runMeta: {
    runId: `query_probe_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    createdAt: new Date().toISOString(),
    owner: 'my-rent-finder',
  },
  thresholds: {
    requiredFieldsRate: 0.85,
    violationRate: 0.08,
    parseFailRate: 0.08,
    imageValidRate: 0.9,
  },
};

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function toText(v) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toLine(v) {
  return String(v || '').trim();
}

function toSafeNumber(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeQueryConditions(target) {
  const t = target || {};
  const regionList = Array.isArray(t.sigunguList)
    ? t.sigunguList.map((x) => toText(x)).filter(Boolean)
    : [];
  const propertyTypes = Array.isArray(t.propertyTypes)
    ? t.propertyTypes.map((x) => toText(x)).filter(Boolean)
    : [];
  const minAreaM2 = toSafeNumber(t.minAreaM2, 0) || toSafeNumber(t.minArea, 0);
  return {
    sido: toText(t.sido || '서울시'),
    sigungu: toText(t.sigungu || ''),
    dong: toText(t.dong || ''),
    sigunguList: regionList,
    rentMin: toSafeNumber(t.rentMin, 0),
    rentMax: toSafeNumber(t.rentMax, 0),
    depositMax: toSafeNumber(t.depositMax, 0),
    minAreaM2,
    propertyTypes,
    leaseType: toText(t.leaseType || '월세'),
  };
}

function buildSearchKeyword(cond) {
  const typeText = Array.isArray(cond.propertyTypes) && cond.propertyTypes.length > 0
    ? cond.propertyTypes.join(' ')
    : '';
  const parts = [cond.sido, cond.sigungu, cond.dong, cond.leaseType]
    .concat(typeText ? [typeText] : [])
    .filter(Boolean)
    .filter((v) => v.length > 0);
  const rentItems = [];
  if (cond.rentMin) {
    rentItems.push(`최소${cond.rentMin}만원`);
  }
  if (cond.rentMax) {
    rentItems.push(`최대${cond.rentMax}만원`);
  }
  if (cond.depositMax) {
    rentItems.push(`보증금${cond.depositMax}만원이하`);
  }
  const rent = rentItems.join(' ');
  const area = cond.minAreaM2 ? `${cond.minAreaM2}m2이상` : '';
  const range = [rent, area].filter(Boolean).join(' ');
  return toText([...parts, range].join(' '));
}

function escapePathRule(value) {
  return value
    .replace(/[/^$()*+?.\\[\]{}|]/g, '\\$&')
    .replace(/\\\*/g, '.*');
}

function ruleMatches(rule, pathname) {
  if (!rule || !pathname) return false;
  const normalized = rule.startsWith('/') ? rule : `/${rule}`;
  const escaped = escapePathRule(normalized);
  const regexBody = normalized.endsWith('$') ? escaped : `${escaped}.*`;
  const regex = new RegExp(`^${regexBody}`, 'i');
  return regex.test(pathname);
}

function longestMatch(rules, pathname) {
  if (!Array.isArray(rules)) return 0;
  let max = 0;
  for (const rawRule of rules) {
    const rule = toText(rawRule);
    if (!rule) continue;
    if (!ruleMatches(rule, pathname)) continue;
    max = Math.max(max, rule.length);
  }
  return max;
}

function isBlockedByRobots(ruleSet, pathname) {
  const disallow = longestMatch(ruleSet.disallow, pathname);
  const allow = longestMatch(ruleSet.allow, pathname);
  if (disallow === 0) return false;
  return disallow >= allow;
}

function parseRobots(text) {
  const lines = String(text || '').split(/\r?\n/);
  const rules = { allow: [], disallow: [] };
  let isTargetGroup = false;

  for (const line of lines) {
    const raw = toLine(line.split('#')[0]);
    if (!raw) continue;
    const pair = raw.split(':');
    const name = toText(pair.shift());
    const value = toLine(pair.join(':'));
    if (/^user-agent$/i.test(name)) {
      isTargetGroup = value === '*' || value.toLowerCase() === 'all';
      continue;
    }
    if (!isTargetGroup) continue;
    if (/^disallow$/i.test(name)) {
      rules.disallow.push(value);
      continue;
    }
    if (/^allow$/i.test(name)) {
      rules.allow.push(value);
    }
  }

  return rules;
}

async function requestWithTimeout(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': userAgent,
        referer: new URL(url).origin,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ko-KR,ko;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, finalUrl: res.url, text, error: null };
  } catch (err) {
    return { status: null, finalUrl: url, text: '', error: String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

function classifyBody(text) {
  const body = toText(text).toLowerCase().slice(0, 32000);
  const blockKeywords = /(captcha|too many requests|access denied|403 forbidden|429 too many|request blocked|service unavailable|cloudflare|접근이 제한|요청이 차단|비정상적인 접근|권한이 없습니다|차단되었습니다)/;
  return {
    blockedText: blockKeywords.test(body),
    hasContent: text && text.length > 600,
    htmlLike: /<html/i.test(body),
  };
}

const PLATFORM_MATRIX = [
  {
    platform: '직방',
    platform_code: 'zigbang',
    home_url: 'https://www.zigbang.com',
    collection_mode: 'STEALTH_AUTOMATION',
    queryBuilder: (base, keyword) => `${base}/search?keyword=${encodeURIComponent(keyword)}`,
    seedBuilder: (base) => `${base}/`,
    fallbackPaths: ['/'],
    notes: '검색 경로는 동적 변화 가능성 있음. 실패 시 수동/브라우저 방식으로 전환.',
  },
  {
    platform: '다방',
    platform_code: 'dabang',
    home_url: 'https://www.dabangapp.com',
    collection_mode: 'STEALTH_AUTOMATION',
    queryBuilder: (base, keyword) => `${base}/search?search_text=${encodeURIComponent(keyword)}`,
    seedBuilder: (base, keyword) => `${base}/?q=${encodeURIComponent(keyword)}`,
    fallbackPaths: ['/'],
    notes: 'robots가 검색 경로를 강하게 제약할 가능성 높음.',
  },
  {
    platform: '네이버 부동산',
    platform_code: 'naver',
    home_url: 'https://new.land.naver.com',
    collection_mode: 'STEALTH_AUTOMATION',
    queryBuilder: (base, keyword) => `${base}/houses?${new URLSearchParams({ keyword }).toString()}`,
    seedBuilder: (base, keyword) => `${base}/houses?${new URLSearchParams({ keyword }).toString()}`,
    fallbackPaths: ['/houses'],
    notes: '검색 페이지 접근 안정성이 낮을 수 있어 STEALTH_AUTOMATION 우선.',
  },
  {
    platform: '피터팬',
    platform_code: 'peterpanz',
    home_url: 'https://www.peterpanz.com',
    collection_mode: 'STEALTH_AUTOMATION',
    queryBuilder: (base, keyword) => `${base}/villa?search=${encodeURIComponent(keyword)}`,
    seedBuilder: (base, keyword) => `${base}/villa?search=${encodeURIComponent(keyword)}`,
    fallbackPaths: ['/villa'],
    notes: '검색 URL 구조가 자주 바뀔 수 있어 STEALTH_AUTOMATION 우선.',
  },
  {
    platform: '부동산114',
    platform_code: 'r114',
    home_url: 'https://www.r114.com',
    collection_mode: 'STEALTH_AUTOMATION',
    queryBuilder: (base, keyword) => `${base}/?q=${encodeURIComponent(keyword)}`,
    seedBuilder: (base, keyword) => `${base}/?q=${encodeURIComponent(keyword)}`,
    fallbackPaths: ['/'],
    notes: '쿼리 파라미터 반영이 약할 수 있어 STEALTH_AUTOMATION 우선.',
  },
  {
    platform: '네모',
    platform_code: 'nemo',
    home_url: 'https://www.nemoapp.kr',
    collection_mode: 'STEALTH_AUTOMATION',
    queryBuilder: (base, keyword) => `${base}/?q=${encodeURIComponent(keyword)}`,
    seedBuilder: (base, keyword) => `${base}/?q=${encodeURIComponent(keyword)}`,
    fallbackPaths: ['/'],
    notes: '서비스 성격 차이로 필드 누락 가능성 높음.',
  },
  {
    platform: '호갱노노',
    platform_code: 'hogangnono',
    home_url: 'https://hogangnono.com',
    collection_mode: 'BLOCKED',
    queryBuilder: (base, keyword) => `${base}/search?keyword=${encodeURIComponent(keyword)}`,
    seedBuilder: (base) => `${base}/`,
    fallbackPaths: ['/'],
    notes: 'robots에서 일반 크롤러 전면 차단 경향.',
  },
];

function pickTargetCondition(cond) {
  return {
    sido: cond.sido,
    sigungu: cond.sigungu,
    dong: cond.dong,
    sigunguList: cond.sigunguList || [],
    leaseType: cond.leaseType,
    rentMin: cond.rentMin,
    rentMax: cond.rentMax,
    depositMax: cond.depositMax,
    minAreaM2: cond.minAreaM2,
    propertyTypes: cond.propertyTypes || [],
  };
}

function buildRegionContexts(condition) {
  const list = Array.isArray(condition.sigunguList) ? condition.sigunguList : [];
  if (list.length === 0) {
    return [pickTargetCondition(condition)];
  }
  return list.map((sigungu) => ({
    ...pickTargetCondition(condition),
    sigungu,
    dong: '',
  }));
}

async function probePlatform(platform, keyword, cond, opts) {
  const probe = {
    platform: platform.platform,
    platform_code: platform.platform_code,
    home_url: platform.home_url,
    collection_mode: platform.collection_mode,
    candidates: [],
  };

  const base = platform.home_url.replace(/\/$/, '');
  let robotsRules = { allow: [], disallow: [] };
  const robotsUrl = `${base}/robots.txt`;
  const robotsResult = await requestWithTimeout(robotsUrl, opts.timeoutMs);

  if (robotsResult.status === 200) {
    robotsRules = parseRobots(robotsResult.text);
    probe.robots = {
      status: robotsResult.status,
      disallow_count: robotsRules.disallow.length,
      allow_count: robotsRules.allow.length,
      blocked_query_path: isBlockedByRobots(robotsRules, '/search'),
      error: null,
    };
  } else if (robotsResult.status === 403) {
    probe.robots = {
      status: robotsResult.status,
      disallow_count: 0,
      allow_count: 0,
      blocked_query_path: true,
      error: robotsResult.error,
    };
  } else {
    probe.robots = {
      status: robotsResult.status,
      disallow_count: 0,
      allow_count: 0,
      blocked_query_path: false,
      error: robotsResult.error,
    };
  }

  const queryUrl = platform.queryBuilder(base, keyword, cond);
  const fallbackPaths = Array.isArray(platform.fallbackPaths) ? platform.fallbackPaths : ['/'];
  const fallbackUrls = fallbackPaths.map((p) => `${base}${p.startsWith('/') ? p : `/${p}`}`);
  const attempts = [queryUrl, ...fallbackUrls];
  let selectedUrl = '';
  let selectedIndex = -1;
  let access = 'STEALTH_AUTOMATION';
  const reasons = [];

  for (const attemptUrl of attempts) {
    const uri = new URL(attemptUrl);
    const path = uri.pathname || '/';
    const blockedByRobot = isBlockedByRobots(robotsRules, path);
    let candidate = {
      query_url: attemptUrl,
      path,
      robots_blocked: blockedByRobot,
      http_status: null,
      blocked_text: false,
      has_content: false,
      html_like: false,
      access: 'UNKNOWN',
      error: null,
    };

    if (blockedByRobot) {
      candidate.access = 'BLOCKED_BY_ROBOTS';
      candidate.error = 'robots_disallow';
      probe.candidates.push(candidate);
      continue;
    }

    const res = await requestWithTimeout(attemptUrl, opts.timeoutMs);
    candidate.http_status = res.status;
    candidate.error = res.error;
    if (res.status && !res.error) {
      const bodyFlags = classifyBody(res.text);
      candidate.blocked_text = bodyFlags.blockedText;
      candidate.has_content = bodyFlags.hasContent;
      candidate.html_like = bodyFlags.htmlLike;
    }

    if (res.error) {
      candidate.access = 'FETCH_FAILED';
      reasons.push(`fetch_failed:${res.error}`);
    } else if ([401, 403, 429].includes(res.status)) {
      candidate.access = 'BLOCKED_HTTP_STATUS';
      reasons.push(`status_${res.status}`);
    } else if (candidate.blocked_text) {
      candidate.access = 'BLOCKED_TEXT';
      reasons.push('blocked_by_content');
    } else if (res.status >= 200 && res.status < 300 && candidate.has_content) {
      candidate.access = 'AUTO_OK';
      if (!selectedUrl) selectedUrl = attemptUrl;
      if (selectedIndex === -1) selectedIndex = attempts.indexOf(attemptUrl);
      access = 'AUTO_OK';
    } else if (res.status >= 500) {
      candidate.access = 'ERROR_5XX';
      reasons.push(`status_${res.status}`);
    } else if (res.status && res.status >= 300 && res.status < 400) {
      candidate.access = 'REDIRECT';
      reasons.push(`status_${res.status}`);
    } else {
      candidate.access = 'NO_DATA';
      reasons.push('insufficient_content');
    }

    probe.candidates.push(candidate);
    if (res.status && [401, 403, 429].includes(res.status)) {
      continue;
    }
    if (candidate.access === 'AUTO_OK') {
      break;
    }
    await sleep(opts.delayMs);
  }

  if (access === 'AUTO_OK' && selectedIndex === 0 && !(probe.robots?.blocked_query_path)) {
    probe.status = 'AUTO_OK';
    probe.selected_query_url = selectedUrl;
    probe.recommendation = {
      collect_mode: platform.collection_mode,
      target_reason: 'query_page_accessible',
    };
  } else if (access === 'AUTO_OK' && (selectedIndex > 0 || probe.robots?.blocked_query_path)) {
    probe.status = 'STEALTH_AUTOMATION';
    probe.selected_query_url = selectedUrl;
    probe.recommendation = {
      collect_mode: 'STEALTH_AUTOMATION',
      target_reason: 'fallback_path_only',
    };
    reasons.unshift('query_path_not_verified');
  } else if (probe.robots?.blocked_query_path || reasons.some((r) => /403|429|robots|blocked/.test(r))) {
    probe.status = 'BLOCKED';
    probe.recommendation = {
      collect_mode: 'BLOCKED',
      target_reason: 'robots_or_http_block_detected',
    };
    reasons.unshift('needs_stealth_seed_flow');
  } else {
    probe.status = 'STEALTH_AUTOMATION';
    probe.recommendation = {
      collect_mode: 'STEALTH_AUTOMATION',
      target_reason: 'query_page_not_stable',
    };
  }

  probe.reasons = Array.from(new Set(reasons.filter(Boolean)));
  return probe;
}

async function main() {
  const input = readJson(inputPath);
  const sourceCondition = input.target || {};
  const propertyTypesOverride = condPropertyTypes
    ? String(condPropertyTypes).split(',').map((x) => toText(x)).filter(Boolean)
    : null;
  const mergedCondition = {
    sido: condSido || sourceCondition.sido,
    sigungu: condSigungu || sourceCondition.sigungu,
    dong: condDong || sourceCondition.dong,
    leaseType: condLeaseType || sourceCondition.leaseType,
    rentMin: condRentMin !== null ? Number(condRentMin) : sourceCondition.rentMin,
    rentMax: condRentMax !== null ? Number(condRentMax) : sourceCondition.rentMax,
    depositMax: condDepositMax !== null ? Number(condDepositMax) : sourceCondition.depositMax,
    minArea: condMinArea !== null ? Number(condMinArea) : sourceCondition.minArea,
    minAreaM2: condMinArea !== null ? Number(condMinArea) : sourceCondition.minAreaM2,
    sigunguList: Array.isArray(sourceCondition.sigunguList) ? sourceCondition.sigunguList : [],
    propertyTypes: propertyTypesOverride || (Array.isArray(sourceCondition.propertyTypes) ? sourceCondition.propertyTypes : []),
  };
  const condition = normalizeQueryConditions(mergedCondition);
  const keyword = buildSearchKeyword(condition);
  const regionContexts = buildRegionContexts(condition);
  const source = {
    file: inputPath,
    sourceName: inputSourceName,
    override: !!(condSido || condSigungu || condDong || condLeaseType || condRentMin || condRentMax || condDepositMax || condMinArea || condPropertyTypes),
  };
  const out = {
    ...defaults,
    condition_input: {
      source: source.override ? 'cli_flags' : input.version ? 'platform_search_conditions' : 'custom',
    target: condition,
    keyword,
    region_count: regionContexts.length,
      options: {
        timeoutMs,
        delayMs,
        sampleCap,
        userAgent,
      },
      origin: source,
    },
    probes: [],
    targets: [],
  };

  console.log(JSON.stringify({
    step: 'condition_loaded',
    source: source,
    target: condition,
    query_keyword: keyword,
    regions: regionContexts.map((x) => x.sigungu || ''),
  }, null, 2));

  if (outputConditionOnly) {
    fs.mkdirSync(path.dirname(probeOutPath), { recursive: true });
    fs.writeFileSync(
      probeOutPath,
      JSON.stringify({
        ...out,
        probes: [],
        targets: [],
      }, null, 2),
      'utf8',
    );
    console.log(JSON.stringify({
      probe_file: probeOutPath,
      message: 'condition_only',
      condition,
    }, null, 2));
    return;
  }

  for (const platform of PLATFORM_MATRIX) {
    const firstContext = regionContexts[0] || pickTargetCondition(condition);
    const firstKeyword = buildSearchKeyword(firstContext);
    const probe = await probePlatform(platform, firstKeyword, firstContext, { timeoutMs, delayMs });
    out.probes.push(probe);
    const firstCandidate = probe.candidates[0] || {};
    console.log(
      JSON.stringify({
        step: 'platform_probe',
        platform: platform.platform,
        status: probe.status,
        selected_query_url: probe.selected_query_url || null,
        first_candidate_status: firstCandidate.http_status || null,
        first_candidate_access: firstCandidate.access || null,
        robots_blocked: firstCandidate.robots_blocked || false,
        recommendation: probe.recommendation,
      }, null, 2),
    );
    if (probe.status === 'AUTO_OK' || probe.status === 'STEALTH_AUTOMATION') {
      const contextLimit = sliceLimit(sampleCap, regionContexts.length);
      const contexts = regionContexts.slice(0, contextLimit);
      const mode = probe.status === 'AUTO_OK' ? platform.collection_mode : 'STEALTH_AUTOMATION';
      contexts.forEach((ctx, idx) => {
        const kw = buildSearchKeyword(ctx);
        const sourceUrl = probe.status === 'AUTO_OK'
          ? platform.queryBuilder(platform.home_url.replace(/\/$/, ''), kw, ctx)
          : (platform.seedBuilder
              ? platform.seedBuilder(platform.home_url.replace(/\/$/, ''), kw, ctx)
              : platform.home_url);
        out.targets.push({
          platform: platform.platform,
          platform_code: platform.platform_code,
          source_id: `${platform.platform_code}_${String(idx + 1).padStart(3, '0')}_${out.runMeta.runId}`,
          source_url: sourceUrl,
          mode,
          source_type: probe.status === 'AUTO_OK' ? 'query_probe_url' : 'stealth_seed_url',
          notes: platform.notes,
          leaseType: condition.leaseType,
          query_hint: ctx,
        });
      });
    } else {
      const contextLimit = sliceLimit(sampleCap, regionContexts.length);
      const contexts = regionContexts.slice(0, contextLimit);
      const sourceBase = platform.home_url.replace(/\/$/, '');
      contexts.forEach((ctx, idx) => {
        const kw = buildSearchKeyword(ctx);
        const sourceUrl = platform.seedBuilder
          ? platform.seedBuilder(sourceBase, kw, ctx)
          : sourceBase;
        out.targets.push({
          platform: platform.platform,
          platform_code: platform.platform_code,
          source_id: `${platform.platform_code}_blocked_${String(idx + 1).padStart(3, '0')}_${out.runMeta.runId}`,
          source_url: sourceUrl,
          mode: 'BLOCKED',
          source_type: 'blocked_seed_url',
          notes: platform.notes,
          leaseType: condition.leaseType,
          probe_status: probe.status,
          query_hint: ctx,
        });
      });
    }
  }

  out.summary = {
    total_platforms: out.probes.length,
    auto_ok: out.probes.filter((p) => p.status === 'AUTO_OK').length,
    stealth_only: out.probes.filter((p) => p.status === 'STEALTH_AUTOMATION').length,
    blocked: out.probes.filter((p) => p.status === 'BLOCKED').length,
    collectable_platforms: out.probes.filter((p) => p.status === 'AUTO_OK' || p.status === 'STEALTH_AUTOMATION').length,
    targets_generated: out.targets.length,
    generated_at: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(probeOutPath), { recursive: true });
  fs.writeFileSync(probeOutPath, JSON.stringify(out, null, 2), 'utf8');
  if (doWriteTargets) {
    fs.writeFileSync(
      targetsOutPath,
      JSON.stringify({
        runMeta: out.runMeta,
        thresholds: out.thresholds,
        targets: out.targets,
      }, null, 2),
      'utf8',
    );
  }

  console.log(
    JSON.stringify(
      {
        probe_file: probeOutPath,
        targets_file: doWriteTargets ? targetsOutPath : null,
        summary: out.summary,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error('query probe failed', e?.message || e);
  process.exit(1);
});
