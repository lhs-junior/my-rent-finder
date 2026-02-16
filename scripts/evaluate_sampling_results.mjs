#!/usr/bin/env node

import fs from 'node:fs';

const args = process.argv.slice(2);
function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split('=').slice(1).join('=') ?? fallback;
}

const inputPath = getArg('--input', 'scripts/platform_sampling_results_skeleton.json');
let raw;
try {
  raw = fs.readFileSync(inputPath, 'utf8');
} catch {
  console.error(`Cannot read input file: ${inputPath}`);
  process.exit(1);
}

const report = JSON.parse(raw);

const thresholds = report.thresholds || {
  requiredFieldsRate: 0.85,
  violationRate: 0.08,
  parseFailRate: 0.08,
  imageValidRate: 0.90,
};

function safeBool(v) {
  return v === 'Y' || v === 'y' || v === true;
}

function parseFailSample(s) {
  if (s?.sample_status === 'PENDING') return false;
  return Boolean(s.parse_error) || s.contract_violations;
}

function summarize(platform) {
  const samples = Array.isArray(platform.samples) ? platform.samples : [];
  const total = samples.length;
  if (total === 0) return { platform: platform.name, total: 0, reason: 'no-samples' };

  const testSamples = samples.filter((s) => s?.sample_status !== 'PENDING');
  const testTotal = Math.max(1, testSamples.length);

  const requiredFields = testSamples.filter((s) => safeBool(s.requiredFields));
  const reqRate = requiredFields.length / testTotal;

  const violationCount = testSamples.filter((s) => s.contract_violations).length;
  const violationRate = violationCount / testTotal;

  const parseFailCount = samples.filter((s) => parseFailSample(s)).length;
  const parseFailRate = parseFailCount / testTotal;

  let imageValidOk = 0;
  let imageValidCountCandidates = 0;
  for (const s of samples) {
    if (s.sample_status === 'PENDING') continue;
    const all = Number(s.images_cnt || 0);
    const valid = Number(s.images_valid_cnt || 0);
    if (all === 0) continue;
    imageValidCountCandidates++;
    if (valid / all >= thresholds.imageValidRate) imageValidOk++;
  }
  const imageSampleCount = imageValidCountCandidates || 1;
  const imageValidRate = imageValidOk / imageSampleCount;

  const pass =
    reqRate >= thresholds.requiredFieldsRate &&
    violationRate <= thresholds.violationRate &&
    parseFailRate <= thresholds.parseFailRate &&
    imageValidRate >= thresholds.imageValidRate;

  return {
    platform: platform.name,
    total,
    mode: platform.mode,
    metrics: {
      requiredFieldsRate: round(reqRate),
      violationRate: round(violationRate),
      parseFailRate: round(parseFailRate),
      imageValidRate: round(imageValidRate),
    },
    pass,
    reasons: pass
      ? []
      : [
          reqRate < thresholds.requiredFieldsRate ? 'requiredFieldsRate' : null,
          violationRate > thresholds.violationRate ? 'violationRate' : null,
          parseFailRate > thresholds.parseFailRate ? 'parseFailRate' : null,
          imageValidRate < thresholds.imageValidRate ? 'imageValidRate' : null,
        ].filter(Boolean),
  };
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

const summaries = report.platforms.map(summarize);
const totalSample = summaries.reduce((acc, s) => acc + (s.total || 0), 0);

const out = {
  runId: report.runMeta?.runId,
  generatedAt: new Date().toISOString(),
  thresholds,
  totalSample,
  platforms: summaries,
};

console.log(JSON.stringify(out, null, 2));
process.exit(0);
