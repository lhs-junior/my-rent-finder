import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(__dirname, "..");

describe("run_listing_adapters CLI filters", () => {
  it("drops naver listings whose exclusive area is below the requested min area", { timeout: 60000 }, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-listing-adapters-"));
    const inputPath = path.join(tmpDir, "naver_raw.jsonl");
    const outputPath = path.join(tmpDir, "naver_normalized.json");

    const rawRecord = {
      platform_code: "naver",
      collected_at: "2026-03-23T15:10:43.823Z",
      source_url: "https://new.land.naver.com/houses?ms=37.5898527,127.0249857,15&a=DDDGG:JWJT:SGJT:VL&e=RETAIL",
      request_url:
        "https://new.land.naver.com/api/articles?markerId=21221031333&markerType=LGEOHASH_MIX_ARTICLE&tradeType=B2&rentPriceMax=80&priceMax=6000&areaMin=40",
      payload_json: {
        isMoreData: false,
        articleList: [
          {
            articleNo: "2614770740",
            articleName: "단독",
            realEstateTypeCode: "DDDGG",
            tradeTypeCode: "B2",
            tradeTypeName: "월세",
            floorInfo: "2/3",
            rentPrc: "20",
            dealOrWarrantPrc: "3,000",
            area1: 50,
            area2: 13,
            direction: "남서향",
            representativeImgUrl: "/20260319_35/1773898312136LJQ2L_JPEG/2614770740_20260319143149456998.jpg",
            buildingName: "단독",
            cpPcArticleUrl: "http://rter2.com/naver/rd?UID=2614770740",
            latitude: "37.590171",
            longitude: "127.020749",
            realtorName: "골드시티부동산공인중개사사무소",
          },
          {
            articleNo: "2611646028",
            articleName: "단독",
            realEstateTypeCode: "DDDGG",
            tradeTypeCode: "B2",
            tradeTypeName: "월세",
            floorInfo: "2/3",
            rentPrc: "50",
            dealOrWarrantPrc: "500",
            area1: 143,
            area2: 44,
            direction: "남동향",
            representativeImgUrl: "/20260314_227/1773455604772gICmC_JPEG/2611646028_20260314111204256341.jpg",
            buildingName: "단독",
            cpPcArticleUrl: "https://www.serve.co.kr/redirect/nland?UID=2611646028",
            latitude: "37.590137",
            longitude: "127.021418",
            realtorName: "케이(K)공인중개사사무소",
          },
        ],
      },
    };

    fs.writeFileSync(inputPath, `${JSON.stringify(rawRecord)}\n`, "utf8");

    const result = spawnSync(
      "node",
      [
        "scripts/run_listing_adapters.mjs",
        "--platform",
        "naver",
        "--input",
        inputPath,
        "--out",
        outputPath,
        "--max-items",
        "10",
        "--min-area",
        "40",
      ],
      {
        cwd: workspace,
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr).toBe(0);

    const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const ids = output.items.map((item) => item.external_id);

    expect(ids).toContain("2611646028");
    expect(ids).not.toContain("2614770740");
    expect(output.filteredByCondition).toBe(1);
  });
});
