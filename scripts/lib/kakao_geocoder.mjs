#!/usr/bin/env node

import { toNumber, toText } from "./db_client.mjs";
import { isValidCoord } from "./geocode_extractor.mjs";

const KAKAO_API_BASE = "https://dapi.kakao.com/v2/local/search/address.json";
const RATE_LIMIT_DELAY_MS = 100; // 10 requests/second = 100ms between requests

/**
 * Geocode a single address using Kakao REST API
 * @param {string} addressText - Address to geocode
 * @returns {Promise<{lat: number|null, lng: number|null}>}
 */
export async function geocodeAddress(addressText) {
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    throw new Error("KAKAO_REST_API_KEY environment variable is not set");
  }

  const address = toText(addressText, "").trim();
  if (!address) {
    return { lat: null, lng: null };
  }

  try {
    const url = `${KAKAO_API_BASE}?query=${encodeURIComponent(address)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `KakaoAK ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.error(`Kakao API error: ${response.status} ${response.statusText}`);
      return { lat: null, lng: null };
    }

    const data = await response.json();
    const documents = data?.documents || [];

    if (documents.length === 0) {
      return { lat: null, lng: null };
    }

    // Use first result
    const first = documents[0];
    const lat = toNumber(first?.y, null); // Kakao uses y for latitude
    const lng = toNumber(first?.x, null); // Kakao uses x for longitude

    if (!isValidCoord(lat, lng)) {
      return { lat: null, lng: null };
    }

    return { lat, lng };
  } catch (error) {
    console.error(`Geocoding error for "${address}":`, error.message);
    return { lat: null, lng: null };
  }
}

/**
 * Batch geocode multiple addresses with rate limiting
 * @param {Array<{id: any, address: string}>} items - Array of items to geocode
 * @param {object} options - Options
 * @param {number} options.delayMs - Delay between requests in milliseconds
 * @returns {Promise<Array<{id: any, lat: number|null, lng: number|null, status: string}>>}
 */
export async function batchGeocode(items, options = {}) {
  const delayMs = options.delayMs || RATE_LIMIT_DELAY_MS;
  const results = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const { lat, lng } = await geocodeAddress(item.address);

    results.push({
      id: item.id,
      lat,
      lng,
      status: lat !== null && lng !== null ? "success" : "failed",
    });

    // Rate limiting: wait between requests (except after last item)
    if (i < items.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
