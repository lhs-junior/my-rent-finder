#!/usr/bin/env node

import { NaverListingAdapter } from "./naver_listings_adapter.mjs";
import { DabangListingAdapter } from "./dabang_listings_adapter.mjs";
import { ZigbangListingAdapter } from "./zigbang_listings_adapter.mjs";
import { R114ListingAdapter } from "./r114_listings_adapter.mjs";
import { PeterpanzListingAdapter } from "./peterpanz_listings_adapter.mjs";

export const ADAPTER_REGISTRY = {
  naver: {
    platformCode: "naver",
    platformName: "네이버 부동산",
    collectionMode: "STEALTH_AUTOMATION",
    adapterFactory: () => new NaverListingAdapter(),
    readiness: "READY",
    notes: "STEALTH 자동 캡처 raw -> adapter 정규화 동작",
  },
  zigbang: {
    platformCode: "zigbang",
    platformName: "직방",
    collectionMode: "STEALTH_AUTOMATION",
    adapterFactory: () =>
      new ZigbangListingAdapter(),
    readiness: "READY",
    notes: "STEALTH raw 정규화 파서 연결 완료(직방)",
  },
  dabang: {
    platformCode: "dabang",
    platformName: "다방",
    collectionMode: "STEALTH_AUTOMATION",
    adapterFactory: () =>
      new DabangListingAdapter(),
    readiness: "READY",
    notes: "STEALTH raw 정규화 파서 연결 완료(다방)",
  },
  r114: {
    platformCode: "r114",
    platformName: "부동산114",
    collectionMode: "STEALTH_AUTOMATION",
    adapterFactory: () =>
      new R114ListingAdapter(),
    readiness: "READY",
    notes: "STEALTH raw 정규화 파서 연결 완료(부동산114)",
  },
  peterpanz: {
    platformCode: "peterpanz",
    platformName: "피터팬",
    collectionMode: "STEALTH_AUTOMATION",
    adapterFactory: () =>
      new PeterpanzListingAdapter(),
    readiness: "READY",
    notes: "STEALTH raw 정규화 파서 연결 완료(피터팬)",
  },
};

const ADAPTER_ALIAS = {
  naver_land: "naver",
};

export function getAdapter(platformCode) {
  const raw = String(platformCode || "").toLowerCase();
  const key = ADAPTER_ALIAS[raw] || raw;
  const item = ADAPTER_REGISTRY[key];
  if (!item) {
    return null;
  }
  return item.adapterFactory();
}

export function listAdapters() {
  return Object.values(ADAPTER_REGISTRY).map((x) => ({
    platform_code: x.platformCode,
    platform_name: x.platformName,
    collection_mode: x.collectionMode,
    readiness: x.readiness,
    notes: x.notes,
  }));
}
