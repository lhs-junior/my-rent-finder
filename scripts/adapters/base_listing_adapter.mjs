#!/usr/bin/env node

/**
 * 공통 Listing Adapter 기본 골격
 * - raw 수집 결과를 normalized 형식으로 변환
 * - 계약 위반/필수항목 검증
 */

import fs from "node:fs";
import readline from "node:readline";

export const ADAPTER_WARNING_LEVEL = {
  ERROR: "ERROR",
  WARN: "WARN",
};

export const ADAPTER_VALIDATION_CODES = {
  RECORD_PARSE_FAIL: "RECORD_PARSE_FAIL",
  NORMALIZE_EXCEPTION: "NORMALIZE_EXCEPTION",
  REQUIRED_MISSING: "REQ_FIELD_MISSING",
  ADDRESS_NORMALIZE_FAIL: "ADDRESS_NORMALIZE_FAIL",
  PRICE_PARSE_FAIL: "PRICE_PARSE_FAIL",
  AREA_PARSE_FAIL: "AREA_PARSE_FAIL",
  IMAGE_URL_INVALID: "IMAGE_URL_INVALID",
  SOURCE_ACCESS_BLOCKED: "SOURCE_ACCESS_BLOCKED",
};

function normalizeText(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function toFloat(v) {
  if (v === null || v === undefined) return null;
  const num = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

function hash11(v) {
  const base = normalizeText(v);
  if (!base) return null;
  let acc = 2166136261 >>> 0;
  for (let i = 0; i < base.length; i += 1) {
    acc ^= base.charCodeAt(i);
    acc = Math.imul(acc, 16777619);
  }
  return `11${String((acc >>> 0) % 900000000).padStart(9, "0")}`;
}

function requiredPass(item) {
  return (
    isNonEmptyString(item.address_text) &&
    (toFloat(item.rent_amount) !== null || toFloat(item.deposit_amount) !== null) &&
    (toFloat(item.area_exclusive_m2) !== null || toFloat(item.area_gross_m2) !== null)
  );
}

function requiredRate(items) {
  if (items.length === 0) return 0;
  const hit = items.filter(requiredPass).length;
  return hit / items.length;
}

function imageRate(items) {
  if (items.length === 0) return 0;
  const withValidImage = items.filter(
    (item) =>
      Array.isArray(item.image_urls) &&
      item.image_urls.length > 0 &&
      item.image_urls.every((url) => isValidImageUrl(url)),
  );
  return withValidImage.length / items.length;
}

function isValidImageUrl(url) {
  const s = String(url || "").trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const parsed = new URL(s);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeErrorCode(err) {
  if (err === null || err === undefined) return null;
  const message = err?.code || err?.message || String(err);
  if (Object.values(ADAPTER_VALIDATION_CODES).includes(message)) return message;
  return ADAPTER_VALIDATION_CODES.NORMALIZE_EXCEPTION;
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

export class BaseListingAdapter {
  constructor({ platformCode, platformName, collectionMode = "BLOCKED", options = {} } = {}) {
    this.platformCode = platformCode || "unknown";
    this.platformName = platformName || platformCode || "unknown";
    this.collectionMode = collectionMode;
    this.options = options;
  }

  async normalizeFromRawFile(inputPath, { maxItems = Infinity, includeRaw = true } = {}) {
    const startedAt = Date.now();
    const filePath = inputPath;
    if (!fs.existsSync(filePath)) {
      throw new Error(`RAW_FILE_NOT_FOUND: ${filePath}`);
    }

    const stream = fs.createReadStream(filePath, "utf8");
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const normalizedItems = [];
    let rawRecords = 0;
    let parsedRawRecords = 0;
    let parseFailure = 0;
    let unmappedRecords = 0;
    const violationCodeCounts = new Map();
    const contractMap = new Map();
    const samples = [];
    const maxSamples = Number.isFinite(Number(this.options.maxSamples))
      ? Math.max(20, Number(this.options.maxSamples))
      : 200;

    for await (const line of rl) {
      if (!line.trim()) continue;
      rawRecords += 1;

      let rawRecord = null;
      try {
        rawRecord = JSON.parse(line);
      } catch (err) {
        parseFailure += 1;
        increment(violationCodeCounts, ADAPTER_VALIDATION_CODES.RECORD_PARSE_FAIL);
        if (samples.length < maxSamples) {
          samples.push({
            parse_status: "fail",
            raw_snippet: line.slice(0, 120),
            error_code: ADAPTER_VALIDATION_CODES.RECORD_PARSE_FAIL,
          });
        }
        continue;
      }

      parsedRawRecords += 1;
      let items = [];
      try {
        items = (await this.normalizeFromRawRecord(rawRecord)) || [];
      } catch (err) {
        const code = normalizeErrorCode(err);
        parseFailure += 1;
        increment(violationCodeCounts, code);
        if (samples.length < maxSamples) {
          const errMessage = err?.message || String(err);
          samples.push({
            parse_status: "fail",
            raw_source: rawRecord.source_url || rawRecord.request_url || null,
            error_code: code,
            error: errMessage,
          });
        }
        continue;
      }

      if (!Array.isArray(items) || items.length === 0) {
        unmappedRecords += 1;
        continue;
      }

      for (const item of items) {
        if (normalizedItems.length >= maxItems) break;
        if (!item || typeof item !== "object") continue;

        const normalized = this.postProcess(item, rawRecord);
        if (!normalized.source_url) normalized.source_url = rawRecord.source_url || rawRecord.request_url || "";
        if (!normalized.collected_at) normalized.collected_at = rawRecord.collected_at || new Date().toISOString();
        if (!normalized.platform_code) normalized.platform_code = this.platformCode;
        if (!normalized.external_id) {
          normalized.external_id = normalized.source_ref || null;
        }
        if (!normalized.address_code) normalized.address_code = hash11(normalized.address_text || "");

        const validations = this.validateNormalized(normalized);
        normalized.validation = validations;
        normalized._raw = includeRaw ? rawRecord._raw || rawRecord.payload_json || rawRecord : undefined;

        normalizedItems.push(normalized);
        for (const v of validations) {
          increment(violationCodeCounts, v.code);
          if (v.level === ADAPTER_WARNING_LEVEL.ERROR) {
            increment(contractMap, `${v.code}:ERROR`);
          }
        }

        if (samples.length < maxSamples) {
          samples.push({
            parse_status: "ok",
            source_ref: normalized.source_ref || null,
            address: !!normalized.address_text,
            has_price: normalized.rent_amount != null || normalized.deposit_amount != null,
            has_area: normalized.area_exclusive_m2 != null || normalized.area_gross_m2 != null,
            image_count: Array.isArray(normalized.image_urls) ? normalized.image_urls.length : 0,
            validation_count: validations.length,
          });
        }
      }
    }

    const stats = {
      rawRecords,
      parsedRawRecords,
      parseFailure,
      unmappedRecords,
      normalizedItems: normalizedItems.length,
        requiredFieldsRate: requiredRate(normalizedItems),
      addressRate:
        normalizedItems.length === 0
          ? 0
          : normalizedItems.filter((i) => isNonEmptyString(i.address_text)).length /
            normalizedItems.length,
      imageRate: imageRate(normalizedItems),
      imagePresenceRate:
        normalizedItems.length === 0
          ? 0
          : normalizedItems.filter(
              (i) => Array.isArray(i.image_urls) && i.image_urls.length > 0,
            ).length / normalizedItems.length,
      priceRate:
        normalizedItems.length === 0
          ? 0
          : normalizedItems.filter(
              (i) => i.rent_amount != null || i.deposit_amount != null,
            ).length / normalizedItems.length,
      areaRate:
        normalizedItems.length === 0
          ? 0
          : normalizedItems.filter(
              (i) => i.area_exclusive_m2 != null || i.area_gross_m2 != null,
            ).length / normalizedItems.length,
      violationCodeCounts: Object.fromEntries(violationCodeCounts),
      errorCounts: Object.fromEntries(contractMap),
      durationMs: Date.now() - startedAt,
    };

    return {
      metadata: {
        platform_code: this.platformCode,
        platform_name: this.platformName,
        collection_mode: this.collectionMode,
        source_file: filePath,
        raw_records: rawRecords,
        parsed_raw_records: parsedRawRecords,
        parse_failure: parseFailure,
        unmapped_records: unmappedRecords,
        normalized_records: normalizedItems.length,
        generated_at: new Date().toISOString(),
        durationMs: stats.durationMs,
        thresholds: {
          requiredFieldsRate: this.options.requiredFieldsRate ?? 0.85,
          imageValidRate: this.options.imageValidRate ?? 0.9,
          imagePresenceRate: this.options.imagePresenceRate ?? this.options.imageValidRate ?? 0.9,
        },
      },
      stats,
      samples,
      items: normalizedItems,
    };
  }

  normalizeFromRawRecord(rawRecord) {
    throw new Error(`normalizeFromRawRecord 미구현: ${this.platformCode}`);
  }

  postProcess(item, rawRecord) {
    return item;
  }

  validateNormalized(item) {
    const violations = [];

    if (!isNonEmptyString(item.address_text)) {
      violations.push({
        level: ADAPTER_WARNING_LEVEL.WARN,
        code: ADAPTER_VALIDATION_CODES.ADDRESS_NORMALIZE_FAIL,
        message: "주소 정규화 실패",
        detail: { address_text: item.address_text || null },
      });
    }

    if (item.rent_amount == null && item.deposit_amount == null) {
      violations.push({
        level: ADAPTER_WARNING_LEVEL.WARN,
        code: ADAPTER_VALIDATION_CODES.PRICE_PARSE_FAIL,
        message: "가격 파싱 실패",
        detail: { rent_amount: item.rent_amount, deposit_amount: item.deposit_amount },
      });
    }

    if (item.area_exclusive_m2 == null && item.area_gross_m2 == null) {
      violations.push({
        level: ADAPTER_WARNING_LEVEL.WARN,
        code: ADAPTER_VALIDATION_CODES.AREA_PARSE_FAIL,
        message: "면적 파싱 실패",
        detail: {
          area_exclusive_m2: item.area_exclusive_m2,
          area_gross_m2: item.area_gross_m2,
        },
      });
    }

    if (!item.source_ref) {
      violations.push({
        level: ADAPTER_WARNING_LEVEL.WARN,
        code: ADAPTER_VALIDATION_CODES.REQUIRED_MISSING,
        message: "source_ref 누락",
        detail: { source_ref: item.source_ref || null },
      });
    }

    if (!Array.isArray(item.image_urls) || item.image_urls.length === 0) {
      violations.push({
        level: ADAPTER_WARNING_LEVEL.WARN,
        code: ADAPTER_VALIDATION_CODES.IMAGE_URL_INVALID,
        message: "이미지 URL 미수집",
        detail: { image_urls: item.image_urls || [] },
      });
    } else if (item.image_urls.some((url) => !isValidImageUrl(url))) {
      violations.push({
        level: ADAPTER_WARNING_LEVEL.WARN,
        code: ADAPTER_VALIDATION_CODES.IMAGE_URL_INVALID,
        message: "이미지 URL 형식 불일치",
        detail: { bad_urls: item.image_urls.filter((url) => !isValidImageUrl(url)) },
      });
    }

    return violations;
  }
}
