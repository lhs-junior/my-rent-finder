#!/usr/bin/env node

import fs from 'node:fs';

const args = process.argv.slice(2);
function getArg(name, fallback = null) {
  const idx = args.findIndex((it) => it === name || it.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split('=').slice(1).join('=') ?? fallback;
}

const input = getArg('--input', 'scripts/data_contract_sample_raw.json');
const strict = getArg('--strict', 'false') === 'true';

const raw = fs.readFileSync(input, 'utf8');
const obj = JSON.parse(raw);

const errors = [];

function add(code, message, path, level = 'ERROR') {
  errors.push({ code, level, path, message });
}

function isUrl(v) {
  if (typeof v !== 'string') return false;
  return /^https?:\/\/.+/.test(v);
}

function isIso(v) {
  if (typeof v !== 'string') return false;
  return !Number.isNaN(Date.parse(v));
}

function isNumberOrNull(v) {
  return v === null || typeof v === 'number';
}

function ensure(cond, code, message, path, level = 'ERROR') {
  if (!cond) add(code, message, path, level);
}

// Raw contract
ensure(typeof obj.schema_version === 'string' && obj.schema_version.length > 0, 'REQ_FIELD_MISSING', 'schema_version required', '/schema_version');
ensure(typeof obj.collection_run_id === 'string' && obj.collection_run_id.length > 0, 'REQ_FIELD_MISSING', 'collection_run_id required', '/collection_run_id');
ensure(typeof obj.platform_code === 'string' && obj.platform_code.length > 0, 'REQ_FIELD_MISSING', 'platform_code required', '/platform_code');
ensure(typeof obj.external_id === 'string' && obj.external_id.length > 0, 'REQ_FIELD_MISSING', 'external_id required', '/external_id');
ensure(isUrl(obj.source_url), 'URL_INVALID', 'source_url must be absolute url', '/source_url');
ensure(isIso(obj.collected_at), 'REQ_FIELD_TYPE_MISMATCH', 'collected_at must be ISO date', '/collected_at');
ensure(typeof obj.payload === 'object' && obj.payload !== null, 'REQ_FIELD_TYPE_MISMATCH', 'payload must be object', '/payload');

const p = obj.payload || {};
if (typeof p.title !== 'string') add('REQ_FIELD_MISSING', 'payload.title is recommended', '/payload/title', 'WARN');
if (!Number.isFinite(Number(p?.price?.monthly_rent))) add('PRICE_PARSE_FAIL', 'price.monthly_rent parse failed', '/payload/price/monthly_rent', 'WARN');
if (!Number.isFinite(Number(p?.price?.deposit))) add('PRICE_PARSE_FAIL', 'price.deposit parse failed', '/payload/price/deposit', 'WARN');
if (!Number.isFinite(Number(p?.area?.exclusive_m2)) && !Number.isFinite(Number(p?.area?.gross_m2))) add('AREA_PARSE_FAIL', 'area parse failed', '/payload/area', 'WARN');

const n = obj.normalized;
if (!n) {
  add('REQ_FIELD_MISSING', 'normalized required', '/normalized');
} else {
  ensure(typeof n.canonical_key === 'string' && n.canonical_key.length > 0, 'REQ_FIELD_MISSING', 'normalized.canonical_key required', '/normalized/canonical_key');
  ensure(isUrl(n.source_url), 'URL_INVALID', 'normalized.source_url must be absolute url', '/normalized/source_url');
  ensure(typeof n.address_text === 'string' && n.address_text.length > 0, 'REQ_FIELD_MISSING', 'address_text required', '/normalized/address_text');
  ensure(typeof n.address_code === 'string' && n.address_code.length > 0, 'REQ_FIELD_MISSING', 'address_code required', '/normalized/address_code');
  ensure(['월세', '전세', '단기', '기타'].includes(n.lease_type), 'REQ_FIELD_TYPE_MISMATCH', 'lease_type invalid', '/normalized/lease_type');
  ensure(isNumberOrNull(n.rent_amount), 'REQ_FIELD_TYPE_MISMATCH', 'rent_amount must be number/null', '/normalized/rent_amount');
  ensure(isNumberOrNull(n.deposit_amount), 'REQ_FIELD_TYPE_MISMATCH', 'deposit_amount must be number/null', '/normalized/deposit_amount');
  ensure(isNumberOrNull(n.area_exclusive_m2), 'REQ_FIELD_TYPE_MISMATCH', 'area_exclusive_m2 must be number/null', '/normalized/area_exclusive_m2');
  ensure(n.source_ref && typeof n.source_ref === 'string', 'REQ_FIELD_MISSING', 'source_ref required', '/normalized/source_ref');
}

const imgs = Array.isArray(obj.normalized_images) ? obj.normalized_images : [];
for (let i = 0; i < imgs.length; i++) {
  const im = imgs[i] || {};
  ensure(isUrl(im.source_url), 'IMAGE_URL_INVALID', 'image.source_url must be absolute url', `/normalized_images/${i}/source_url`);
  ensure(['queued', 'downloaded', 'failed', 'skipped'].includes(im.status), 'REQ_FIELD_TYPE_MISMATCH', 'invalid image status', `/normalized_images/${i}/status`);
}

const report = {
  valid: errors.filter((e) => e.level === 'ERROR' && e.code !== 'REQ_FIELD_MISSING').length === 0,
  counts: {
    ERROR: errors.filter((e) => e.level === 'ERROR').length,
    WARN: errors.filter((e) => e.level === 'WARN').length,
  },
  errors,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.counts.ERROR > 0 ? 2 : 0);
