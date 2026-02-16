#!/usr/bin/env node

import { BaseListingAdapter } from "./base_listing_adapter.mjs";

export class StubListingAdapter extends BaseListingAdapter {
  constructor({ platformCode, platformName, collectionMode = "BLOCKED" } = {}) {
    super({ platformCode, platformName, collectionMode });
  }

  normalizeFromRawRecord() {
    return [];
  }
}
