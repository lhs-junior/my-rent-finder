#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function getArg(key, fallback = null) {
  const idx = args.findIndex((v) => v === key || v.startsWith(`${key}=`));
  if (idx === -1) return fallback;
  if (args[idx] === key) return args[idx + 1] ?? fallback;
  return args[idx].split('=').slice(1).join('=') ?? fallback;
}

const configPath = getArg('--config', path.join(process.cwd(), 'scripts/platform_feasibility_sample.json'));
const outputPath = getArg('--out', path.join(process.cwd(), 'docs/platform_feasibility_report.md'));

const raw = fs.readFileSync(configPath, 'utf8');
const config = JSON.parse(raw);

const scenario = config.scenario;
const platforms = Array.isArray(config.platforms) ? config.platforms : [];

const modeAccessScore = {
  API: 100,
  STEALTH_AUTOMATION: 85,
  BLOCKED: 8,
};

const updateScore = {
  high: 70,
  medium: 45,
  low: 20,
};

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function scoreMode(mode) {
  const key = String(mode || '').toUpperCase();
  if (key.includes('STEALTH') || key.includes('ONLY')) return modeAccessScore.STEALTH_AUTOMATION;
  return modeAccessScore[key] ?? 30;
}

function requiredCoverageRate(fields) {
  if (!fields || typeof fields !== 'object') return 0;
  const vals = [fields.address, fields.area, fields.price, fields.floor, fields.images].map((v) => clamp01(v));
  return vals.reduce((acc, v) => acc + v, 0) / vals.length;
}

function estimateForPlatform(p) {
  const qd = scenario.queryCountPerDay;
  const rawCoverage = requiredCoverageRate(p.requiredFieldsCoverage);
  const extractRate = clamp01(p.extractSuccessRate);
  const failureRate = clamp01(p.failureRate);

  const listingsPerQuery = Math.max(0, p.pagesPerQuery * p.listingsPerPage * extractRate);
  const rawDailyListings = Math.round(qd * listingsPerQuery);
  const dailyListings = Math.min(rawDailyListings, scenario.maxDailyListings);

  const perListingDbKb = clamp01Number(p.rawKbPerListing) + clamp01Number(p.normalizedKbPerListing);
  const dailyDbGb = (dailyListings * perListingDbKb) / 1024 / 1024;
  const dailyDbRetentionGb = dailyDbGb * scenario.retentionDays;

  const savedImg = Math.max(0, Math.min(p.savedImageCount || 0, p.avgImageCount || 0));
  const dailyImageGb = (dailyListings * savedImg * (p.avgImageKb || 0)) / 1024 / 1024;
  const monthlyImageGb = dailyImageGb * scenario.retentionDays;

  const accessScore = scoreMode(p.mode);
  const fieldScore = rawCoverage * 100;
  const reliabilityScore = (1 - failureRate) * 100;
  const dbBudgetScore = clamp01(1 - Math.max(0, dailyDbGb / Math.max(0.0001, scenario.storageBudgetGb))) * 100;
  const imageBudgetScore = clamp01(1 - Math.max(0, dailyImageGb / Math.max(0.0001, scenario.imageBudgetGb))) * 100;
  const updateScoreVal = updateScore[(p.updateCadence || 'low')] || 20;

  const weights = {
    access: 25,
    field: 25,
    reliability: 20,
    db: 15,
    image: 10,
    update: 5,
  };

  let total = (weights.access * accessScore +
    weights.field * fieldScore +
    weights.reliability * reliabilityScore +
    weights.db * dbBudgetScore +
    weights.image * imageBudgetScore +
    weights.update * updateScoreVal) / 100;

  let tier = 'C';
  if (accessScore >= 70 && total >= 82) tier = 'A';
  else if (total >= 60) tier = 'B';

  const warnings = [];
  if (p.mode === 'BLOCKED') warnings.push('BLOCKED 모드: 기본 실행 불가, URL/동반 수집 검증 필요');
  if (failureRate > 0.3) warnings.push('실패율 높음(>30%), 모드 강등 감시');
  if (rawDailyListings > scenario.maxDailyListings) warnings.push('상한 적용: 일일매물이 상한값으로 캡핑됨');
  if (rawDailyListings > scenario.maxDailyListings * 0.9) warnings.push('일일 상한 임박, 쿼리 제한 필요');
  if (dailyImageGb > scenario.imageBudgetGb) warnings.push('이미지 일일 예산 초과 가능성');
  if (dailyDbGb > scenario.storageBudgetGb) warnings.push('DB 일일 예산 초과 가능성');
  if (rawCoverage < 0.7) warnings.push('필수 필드 완성도 낮음, 사용자검증 필요');

  return {
    name: p.name,
    mode: p.mode,
    estimate: {
      qpd: qd,
      listingsPerQuery: round2(listingsPerQuery),
      rawDailyListings,
      dailyListings,
      storageRetentionDays: scenario.retentionDays,
      dailyDbGb: round3(dailyDbGb),
      dailyImageGb: round3(dailyImageGb),
      monthlyDbGb: round3(dailyDbRetentionGb),
      monthlyImageGb: round3(monthlyImageGb),
    },
    scores: {
      accessScore: round1(accessScore),
      fieldScore: round1(fieldScore),
      reliabilityScore: round1(reliabilityScore),
      dbBudgetScore: round1(dbBudgetScore),
      imageBudgetScore: round1(imageBudgetScore),
      updateScore: updateScoreVal,
      total: round1(total),
      tier,
    },
    flags: {
      extractSuccessRate: extractRate,
      failureRate,
      requiredCoverageRate: round3(rawCoverage),
      savedImagePerListing: savedImg,
    },
    warnings,
  };
}

function clamp01Number(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

const results = platforms.map(estimateForPlatform).sort((a, b) => b.scores.total - a.scores.total);

const now = new Date().toISOString();
const markdownLines = [];
markdownLines.push('# 플랫폼 수집 가능성 자동 검증 결과');
markdownLines.push('');
markdownLines.push(`산출일: ${now}`);
markdownLines.push(`시나리오: ${scenario.name}`);
markdownLines.push('');
markdownLines.push(`조건: 일일 쿼리 ${scenario.queryCountPerDay}, 최소평수 ${scenario.minAreaPyeong}평, 월세 ${scenario.targetRent.min}~${scenario.targetRent.max}만원`);
markdownLines.push(`예산: DB 일일 ${scenario.storageBudgetGb}GB, 이미지 일일 ${scenario.imageBudgetGb}GB, 보관 ${scenario.retentionDays}일`);
markdownLines.push('');

markdownLines.push('| 플랫폼 | 모드 | 일일매물(원본) | 일일매물(캡핑) | 일일 DB(GB) | 일일 이미지(GB) | 월 DB(GB) | 월 이미지(GB) | 총점 | 등급 | 경고 |');
markdownLines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
for (const r of results) {
  markdownLines.push(`| ${r.name} | ${r.mode} | ${r.estimate.rawDailyListings} | ${r.estimate.dailyListings} | ${r.estimate.dailyDbGb} | ${r.estimate.dailyImageGb} | ${r.estimate.monthlyDbGb} | ${r.estimate.monthlyImageGb} | ${r.scores.total} | ${r.scores.tier} | ${r.warnings.join(' / ') || '없음'} |`);
}

markdownLines.push('');
markdownLines.push('## 추천 순위');
markdownLines.push('');
const byTier = {
  A: results.filter((r) => r.scores.tier === 'A'),
  B: results.filter((r) => r.scores.tier === 'B'),
  C: results.filter((r) => r.scores.tier === 'C'),
};
markdownLines.push(`A군(우선 구현): ${byTier.A.map((r) => r.name).join(', ') || '없음'}`);
markdownLines.push(`B군(조건부 실행): ${byTier.B.map((r) => r.name).join(', ') || '없음'}`);
markdownLines.push(`C군(보류/우회 필요): ${byTier.C.map((r) => r.name).join(', ') || '없음'}`);
markdownLines.push('');
markdownLines.push('## 계산 상세(JSON)');
markdownLines.push('');
markdownLines.push('```json');
markdownLines.push(JSON.stringify(results, null, 2));
markdownLines.push('```');

const outMd = markdownLines.join('\n');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, outMd, 'utf8');

console.log(JSON.stringify({
  scenario: scenario.name,
  generatedAt: now,
  summary: {
    total: results.length,
    a: byTier.A.length,
    b: byTier.B.length,
    c: byTier.C.length,
  },
  top: results[0]?.name || null,
}, null, 2));
console.log(`Report written: ${outputPath}`);
