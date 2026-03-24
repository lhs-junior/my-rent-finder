import { describe, it, expect } from "vitest";

import {
  extractImageUrlsFromPayload,
  buildFallbackImageRowsFromPayload,
} from "../scripts/lib/api_helpers.mjs";

describe("api_helpers image fallback extraction", () => {
  it("extracts extensionless dabang cloudfront images from payloads", () => {
    const payload = {
      imgUrlList: [
        "https://d1774jszgerdmk.cloudfront.net/512/9a93b727-cbdb-4d5c-8650-906190790a0c",
        "https://d1774jszgerdmk.cloudfront.net/512/1f4c943d-d65f-44de-b607-58e4aa9fa25e",
      ],
    };

    expect(extractImageUrlsFromPayload(payload)).toEqual([
      "https://d1774jszgerdmk.cloudfront.net/512/9a93b727-cbdb-4d5c-8650-906190790a0c",
      "https://d1774jszgerdmk.cloudfront.net/512/1f4c943d-d65f-44de-b607-58e4aa9fa25e",
    ]);
  });

  it("builds API-friendly fallback image rows", () => {
    const payload = {
      images: [
        "https://example.com/a.jpg",
        "https://example.com/b.webp",
      ],
    };

    expect(buildFallbackImageRowsFromPayload(payload)).toEqual([
      { source_url: "https://example.com/a.jpg", status: "raw_payload", is_primary: true },
      { source_url: "https://example.com/b.webp", status: "raw_payload", is_primary: false },
    ]);
  });
});
