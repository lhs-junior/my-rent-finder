import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildGridProbePoints,
  extractHousesFromResponse,
  filterPeterpanzListings,
} from "../scripts/peterpanz_auto_collector.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(__dirname, "..");

describe("Peterpanz collector helpers", () => {
  it("merges duplicate house variants and keeps the richer image-bearing variant", () => {
    const items = extractHousesFromResponse({
      houses: {
        withoutFee: {
          noImage: [
            {
              hidx: 101,
              info: { subject: "no image first", real_size: 41, thumbnail: null },
              price: { deposit: 10000000, monthly_fee: 500000 },
              location: { address: { sigungu: "노원구", dong: "공릉동", text: "노원구 공릉동" } },
              images: null,
            },
          ],
          image: [
            {
              hidx: 101,
              info: { subject: "image second", real_size: 41, thumbnail: "https://img.peterpanz.com/photo/a_thumb.jpg" },
              price: { deposit: 10000000, monthly_fee: 500000 },
              location: { address: { sigungu: "노원구", dong: "공릉동", text: "노원구 공릉동" } },
              images: { S: [{ path: "https://img.peterpanz.com/photo/a_thumb.jpg" }] },
            },
          ],
        },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0].info.subject).toBe("image second");
    expect(items[0].images.S).toHaveLength(1);
  });

  it("prefers exact sigungu over coordinate fallback and still uses bbox fallback when sigungu is missing", () => {
    const filtered = filterPeterpanzListings(
      [
        {
          hidx: 1,
          info: { real_size: 45 },
          type: { contract_type: "월세" },
          price: { deposit: 30000000, monthly_fee: 700000 },
          location: {
            address: { sigungu: "종로구", dong: "숭인동", text: "종로구 숭인동" },
            coordinate: { latitude: "37.6200", longitude: "127.0722" },
          },
        },
        {
          hidx: 2,
          info: { real_size: 45 },
          type: { contract_type: "월세" },
          price: { deposit: 30000000, monthly_fee: 700000 },
          location: {
            address: { sigungu: "동대문구", dong: "용두동", text: "동대문구 용두동" },
            coordinate: { latitude: "37.5735", longitude: "126.9790" },
          },
        },
        {
          hidx: 3,
          info: { real_size: 45 },
          type: { contract_type: "월세" },
          price: { deposit: 30000000, monthly_fee: 700000 },
          location: {
            address: { text: "구 정보 없음" },
            coordinate: { latitude: "37.5735", longitude: "126.9790" },
          },
        },
      ],
      {
        sigungu: "종로구",
        bbox: { sw_lat: 37.55, sw_lng: 126.95, ne_lat: 37.60, ne_lng: 127.01 },
        rentMax: 80,
        depositMax: 6000,
        minAreaM2: 40,
      },
    );

    expect(filtered.map((item) => item.hidx)).toEqual([1, 3]);
  });

  it("builds denser probe grids without producing points outside the bbox", () => {
    const bbox = { sw_lat: 37.55, sw_lng: 126.95, ne_lat: 37.60, ne_lng: 127.01 };
    const points4 = buildGridProbePoints(bbox, 4);
    const points6 = buildGridProbePoints(bbox, 6);

    expect(points4).toHaveLength(16);
    expect(points6).toHaveLength(36);
    expect(points6.every((point) =>
      point.lat > bbox.sw_lat &&
      point.lat < bbox.ne_lat &&
      point.lng > bbox.sw_lng &&
      point.lng < bbox.ne_lng,
    )).toBe(true);
  });

  it("stays import-safe even when the host process passes a foreign sigungu arg", () => {
    const result = spawnSync(
      "node",
      [
        "--input-type=module",
        "--eval",
        `
          process.argv = ["node", "host.mjs", "--sigungu=없는구"];
          await import("./scripts/peterpanz_auto_collector.mjs");
          console.log("import-ok");
        `,
      ],
      {
        cwd: workspace,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("import-ok");
    expect(result.stderr).not.toContain("Unknown district");
  });
});
