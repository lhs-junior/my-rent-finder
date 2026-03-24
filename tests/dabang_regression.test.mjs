import { describe, it, expect } from "vitest";

import { DabangListingAdapter } from "../scripts/adapters/dabang_listings_adapter.mjs";
import { isLikelyActiveDabangLocation } from "../scripts/lib/api_routes/listings.mjs";

describe("dabang regressions", () => {
  it("extracts coordinates from nested randomLocation payloads", () => {
    const adapter = new DabangListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "dabang",
      source_url: "https://www.dabangapp.com/room/abc123",
      sigungu: "노원구",
      payload_json: {
        id: "abc123",
        roomTypeName: "투룸",
        roomTitle: "수유역8분 투룸 주차안됨",
        roomDesc: "저층, 42.97m², 관리비 1만",
        priceTypeName: "월세",
        priceTitle: "1000/70",
        dongName: "번동",
        imgUrlList: [
          "https://d1774jszgerdmk.cloudfront.net/512/JsOQiXF3eeY15D4itciOk",
          "https://d1774jszgerdmk.cloudfront.net/512/yu0rAk5dn2VOML52rM7my",
        ],
        randomLocation: {
          lat: 37.6417754713744,
          lng: 127.031039734738,
        },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0].source_ref).toBe("abc123");
    expect(items[0].lat).toBe(37.6417754713744);
    expect(items[0].lng).toBe(127.031039734738);
    expect(items[0].address_text).toContain("노원구");
    expect(items[0].address_text).toContain("번동");
    expect(items[0].image_urls).toEqual([
      "https://d1774jszgerdmk.cloudfront.net/512/JsOQiXF3eeY15D4itciOk",
      "https://d1774jszgerdmk.cloudfront.net/512/yu0rAk5dn2VOML52rM7my",
    ]);
  });

  it("accepts current dabang detail redirects as active", () => {
    expect(
      isLikelyActiveDabangLocation(
        "/map/onetwo?m_lat=37.5486093650137&m_lng=126.966331165204&m_zoom=16&detail_type=room&detail_id=69b8c3ebace9e01e16f5597b",
        "69b8c3ebace9e01e16f5597b",
      ),
    ).toBe(true);
  });

  it("rejects unrelated dabang redirects", () => {
    expect(
      isLikelyActiveDabangLocation(
        "/map/onetwo?m_lat=37.5&m_lng=126.9&m_zoom=16&detail_type=room&detail_id=someone-else",
        "69b8c3ebace9e01e16f5597b",
      ),
    ).toBe(false);
  });
});
