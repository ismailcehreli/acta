import { describe, expect, it } from "vitest";

import { rollupByOrgUnit } from "@/server/reports/rollup";

interface Counters {
  total: number;
}

describe("rollupByOrgUnit", () => {
  it("kök, alt birim ve boş sayaçları bağımsız olarak toplar", () => {
    const units = [
      { id: "root", parentId: null },
      { id: "child", parentId: "root" },
      { id: "empty", parentId: "root" },
      { id: "grandchild", parentId: "child" },
      { id: "outside", parentId: null },
    ];
    const direct = new Map<string, Counters>([
      ["root", { total: 1 }],
      ["child", { total: 2 }],
      ["grandchild", { total: 3 }],
    ]);

    const totals = rollupByOrgUnit(units, "root", direct, {
      createEmpty: () => ({ total: 0 }),
      clone: (value) => ({ ...value }),
      merge: (target, source) => {
        target.total += source.total;
      },
    });

    expect(totals.get("grandchild")).toEqual({ total: 3 });
    expect(totals.get("child")).toEqual({ total: 5 });
    expect(totals.get("empty")).toEqual({ total: 0 });
    expect(totals.get("root")).toEqual({ total: 6 });
    expect(totals.has("outside")).toBe(false);
    expect(direct).toEqual(
      new Map([
        ["root", { total: 1 }],
        ["child", { total: 2 }],
        ["grandchild", { total: 3 }],
      ]),
    );
  });
});
