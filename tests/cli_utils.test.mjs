import { describe, expect, it } from "vitest";

import { buildFilterArgs } from "../scripts/lib/cli_utils.mjs";

describe("cli_utils buildFilterArgs", () => {
  it("emits min-area together with rent/deposit filters", () => {
    expect(
      buildFilterArgs({
        rentMax: 80,
        depositMax: 6000,
        minAreaM2: 40,
      }),
    ).toEqual([
      "--rent-max",
      "80",
      "--deposit-max",
      "6000",
      "--min-area",
      "40",
    ]);
  });

  it("omits missing filters and floors minArea to an integer arg", () => {
    expect(
      buildFilterArgs({
        rentMax: null,
        depositMax: undefined,
        minAreaM2: 40.9,
      }),
    ).toEqual([
      "--min-area",
      "40",
    ]);
  });
});
