import { describe, it, expect } from "vitest";
import { ServeListingAdapter, isServeListingImage } from "../scripts/adapters/serve_listings_adapter.mjs";

const ARTICLE = "https://newimg.serve.co.kr/article_photo/2026/04/21/13805569/332121841_20260421130548775.jpg";
const PROFILE = "https://newimg.serve.co.kr/member_profile/2017/06/27/13817378/20170627105643.jpg";
const FOREIGN = "https://example.com/some.jpg";

describe("isServeListingImage — URL 화이트리스트", () => {
  it("article_photo 경로는 매물 사진으로 허용", () => {
    expect(isServeListingImage(ARTICLE)).toBe(true);
  });
  it("member_profile 경로는 중개사 프로필이므로 거부", () => {
    expect(isServeListingImage(PROFILE)).toBe(false);
  });
  it("외부 host는 거부", () => {
    expect(isServeListingImage(FOREIGN)).toBe(false);
  });
  it("null/empty/비문자열 거부", () => {
    expect(isServeListingImage(null)).toBe(false);
    expect(isServeListingImage("")).toBe(false);
    expect(isServeListingImage(123)).toBe(false);
  });
  it("/article_photo/ 가 hostname이 serve.co.kr 가 아니면 거부 (사칭 방어)", () => {
    expect(isServeListingImage("https://evil.com/article_photo/x.jpg")).toBe(false);
  });
});

function rawWithPhotos(photoUrls, extra = {}) {
  return {
    atclNo: "332121841",
    dealKindCd: "B2",
    sidoNm: "서울특별시", sggNm: "성동구", emdNm: "성수동1가",
    bscTnthWuntAmt: "1000", addTnthWuntAmt: "60",
    area1: "30", area2: "30", laCrd: 37.55, loCrd: 127.04,
    flr1: "3", flr2: "5", roomNcnt: "1", toilCnt: "1",
    drcCdNm: "남",
    photoList: photoUrls.map((url, i) => ({ imageData: url, fileNm: `f${i}.jpg`, atclNo: "332121841" })),
    ...extra,
  };
}

describe("ServeListingAdapter.normalizeFromRawRecord — image_urls 필터", () => {
  const adapter = new ServeListingAdapter();

  it("photoList의 매물 사진만 통과, 프로필/외부는 차단", () => {
    const raw = rawWithPhotos([ARTICLE, PROFILE, FOREIGN, ARTICLE.replace("775", "776")]);
    const items = adapter.normalizeFromRawRecord({ payload_json: raw });
    expect(items).toHaveLength(1);
    expect(items[0].image_urls).toEqual([
      ARTICLE,
      "https://newimg.serve.co.kr/article_photo/2026/04/21/13805569/332121841_20260421130548776.jpg",
    ]);
  });

  it("expsrImgFileUrl(중개사 프로필)이 raw에 있어도 image_urls에 포함되지 않음", () => {
    const raw = rawWithPhotos([ARTICLE], { expsrImgFileUrl: PROFILE });
    const items = adapter.normalizeFromRawRecord({ payload_json: raw });
    expect(items[0].image_urls).toEqual([ARTICLE]);
  });

  it("photoList가 없거나 비어 있으면 image_urls = []", () => {
    const r1 = rawWithPhotos([], { expsrImgFileUrl: PROFILE });
    expect(adapter.normalizeFromRawRecord({ payload_json: r1 })[0].image_urls).toEqual([]);
    const r2 = rawWithPhotos([]);
    delete r2.photoList;
    r2.expsrImgFileUrl = PROFILE;
    expect(adapter.normalizeFromRawRecord({ payload_json: r2 })[0].image_urls).toEqual([]);
  });

  it("동일 URL 중복은 제거", () => {
    const raw = rawWithPhotos([ARTICLE, ARTICLE, ARTICLE]);
    const items = adapter.normalizeFromRawRecord({ payload_json: raw });
    expect(items[0].image_urls).toEqual([ARTICLE]);
  });

  it("모든 사진이 프로필/외부면 image_urls = []", () => {
    const raw = rawWithPhotos([PROFILE, FOREIGN, "not-a-url"]);
    const items = adapter.normalizeFromRawRecord({ payload_json: raw });
    expect(items[0].image_urls).toEqual([]);
  });
});
