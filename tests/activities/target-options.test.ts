import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listTargetDepartments } from "@/server/activities/target-options";

import { createOrgUnit } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Target department options list.
// Options include all active departments, with the author's own department
// and child units prioritized at the top for convenience.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("target departments options list", () => {
  it("includes all active departments including peer departments", async () => {
    const root = await createOrgUnit({ name: "Company" });
    const ownUnit = await createOrgUnit({ name: "Tooling", parentId: root.id });
    await createOrgUnit({ name: "Planning", parentId: root.id });

    const options = await listTargetDepartments(testDb, ownUnit.id);

    expect(options.map((o) => o.name).sort()).toEqual([
      "Company",
      "Planning",
      "Tooling",
    ]);
  });

  it("prioritizes own department and its child units at the beginning of the list", async () => {
    const root = await createOrgUnit({ name: "Company" });
    const peerUnit = await createOrgUnit({ name: "Planning", parentId: root.id });
    const ownUnit = await createOrgUnit({ name: "Tooling", parentId: root.id });
    await createOrgUnit({ name: "Mold Maintenance", parentId: ownUnit.id });

    const options = await listTargetDepartments(testDb, ownUnit.id);

    expect(options.slice(0, 2).map((o) => o.name).sort()).toEqual([
      "Mold Maintenance",
      "Tooling",
    ]);
    expect(options.slice(0, 2).every((o) => o.own)).toBe(true);
    expect(options.find((o) => o.id === peerUnit.id)?.own).toBe(false);
  });

  it("excludes inactive departments from target options", async () => {
    const root = await createOrgUnit({ name: "Company" });
    const ownUnit = await createOrgUnit({ name: "Tooling", parentId: root.id });
    const inactiveUnit = await createOrgUnit({ name: "Closed Dept", parentId: root.id });
    await testDb.orgUnit.update({
      where: { id: inactiveUnit.id },
      data: { isActive: false },
    });

    const options = await listTargetDepartments(testDb, ownUnit.id);

    expect(options.map((o) => o.id)).not.toContain(inactiveUnit.id);
  });
});
