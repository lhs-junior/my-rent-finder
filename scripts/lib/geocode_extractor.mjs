#!/usr/bin/env node

import { toNumber } from "./db_client.mjs";

/**
 * Validates if coordinates are within South Korea bounds
 * @param {number|null} lat - Latitude
 * @param {number|null} lng - Longitude
 * @returns {boolean}
 */
export function isValidCoord(lat, lng) {
  if (lat === null || lng === null) return false;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

  // South Korea coordinate bounds
  // Latitude: 33° - 39° N
  // Longitude: 124° - 132° E
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}

/**
 * Extract coordinates from raw listing payload based on platform
 * @param {string} platformCode - Platform code (zigbang, naver, kbland, etc.)
 * @param {object} payloadJson - Raw payload JSON object
 * @returns {{lat: number|null, lng: number|null}}
 */
export function extractCoordsFromRaw(platformCode, payloadJson) {
  if (!payloadJson || typeof payloadJson !== "object") {
    return { lat: null, lng: null };
  }

  const platform = String(platformCode || "").toLowerCase();
  let lat = null;
  let lng = null;

  switch (platform) {
    case "zigbang":
      // location.lat/lng or random_location.lat/lng
      lat = toNumber(payloadJson?.location?.lat, null)
        || toNumber(payloadJson?.random_location?.lat, null);
      lng = toNumber(payloadJson?.location?.lng, null)
        || toNumber(payloadJson?.random_location?.lng, null);
      break;

    case "naver": {
      // Naver has two payload shapes:
      // 1. Object with articleList[] — each article has latitude/longitude strings
      // 2. Array of marker clusters — each element has latitude/longitude numbers
      const article = Array.isArray(payloadJson?.articleList)
        ? payloadJson.articleList[0]
        : null;
      const firstElem = Array.isArray(payloadJson) ? payloadJson[0] : null;
      lat = toNumber(article?.latitude, null)
        || toNumber(firstElem?.latitude, null)
        || toNumber(payloadJson?.latitude, null)
        || toNumber(payloadJson?.centerLat, null)
        || toNumber(payloadJson?.lat, null);
      lng = toNumber(article?.longitude, null)
        || toNumber(firstElem?.longitude, null)
        || toNumber(payloadJson?.longitude, null)
        || toNumber(payloadJson?.centerLon, null)
        || toNumber(payloadJson?.lng, null);
      break;
    }

    case "kbland":
      // Top-level lat/lng, then hscpLat/hscpLon
      lat = toNumber(payloadJson?.lat, null)
        || toNumber(payloadJson?.hscpLat, null);
      lng = toNumber(payloadJson?.lng, null)
        || toNumber(payloadJson?.hscpLon, null);
      break;

    case "dabang":
      // randomLocation.lat/lng (verified from raw data)
      lat = toNumber(payloadJson?.randomLocation?.lat, null)
        || toNumber(payloadJson?.location?.lat, null)
        || toNumber(payloadJson?.lat, null);
      lng = toNumber(payloadJson?.randomLocation?.lng, null)
        || toNumber(payloadJson?.location?.lng, null)
        || toNumber(payloadJson?.lng, null);
      break;

    case "peterpanz":
      // location.coordinate.latitude/longitude (STRING values)
      lat = toNumber(payloadJson?.location?.coordinate?.latitude, null)
        || toNumber(payloadJson?.lat, null)
        || toNumber(payloadJson?.location?.lat, null);
      lng = toNumber(payloadJson?.location?.coordinate?.longitude, null)
        || toNumber(payloadJson?.lng, null)
        || toNumber(payloadJson?.location?.lng, null);
      break;

    case "daangn":
      // Daangn has no coordinates in raw data — requires geocoding from address
      lat = toNumber(payloadJson?.lat, null)
        || toNumber(payloadJson?.location?.lat, null)
        || toNumber(payloadJson?.latitude, null);
      lng = toNumber(payloadJson?.lng, null)
        || toNumber(payloadJson?.location?.lng, null)
        || toNumber(payloadJson?.longitude, null);
      break;

    case "r114":
      lat = toNumber(payloadJson?.lat, null)
        || toNumber(payloadJson?.location?.lat, null);
      lng = toNumber(payloadJson?.lng, null)
        || toNumber(payloadJson?.location?.lng, null);
      break;

    default:
      // Generic fallback: try common field names
      lat = toNumber(payloadJson?.lat, null)
        || toNumber(payloadJson?.latitude, null)
        || toNumber(payloadJson?.location?.lat, null);
      lng = toNumber(payloadJson?.lng, null)
        || toNumber(payloadJson?.lon, null)
        || toNumber(payloadJson?.longitude, null)
        || toNumber(payloadJson?.location?.lng, null);
  }

  // Validate coordinates before returning
  if (!isValidCoord(lat, lng)) {
    return { lat: null, lng: null };
  }

  return { lat, lng };
}
