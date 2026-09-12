import { describe, expect, it } from "vitest";

import { buildQueryAddress } from "@/shared/filters/query-address";


//





describe("buildQueryAddress", () => {
  it("preserves populated parameters", () => {
    const address = buildQueryAddress("/search", { q: "mold", period: "week" });

    expect(address).toBe("/search?q=mold&period=week");
  });



  it("drops empty and undefined values", () => {
    const address = buildQueryAddress("/activities", {
      period: "all",
      status: "",
      targetOrgUnitId: undefined,
    });

    expect(address).toBe("/activities?period=all");
  });

  it("returns the bare path when no parameters remain", () => {
    expect(buildQueryAddress("/drafts", { type: "" })).toBe("/drafts");
  });

  it("extra parameters override existing values", () => {
    const address = buildQueryAddress("/activities", { page: "1" }, { page: "3" });

    expect(address).toBe("/activities?page=3");
  });



  it("does not write an omitted parameter", () => {
    const address = buildQueryAddress(
      "/feed",
      { period: "week", status: "approved" },
      {},
      ["status"],
    );

    expect(address).toBe("/feed?period=week");
  });
});
