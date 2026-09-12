import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { countUsers, listUsers } from "@/server/users/list";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// User management list filters and pagination

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  const workshop = await createOrgUnit({ name: "Workshop", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const manager = await createUser(workshop.id, {
    fullName: "Workshop Manager",
    isUnitManager: true,
  });
  const artisan = await createUser(workshop.id, { fullName: "Lead Artisan" });
  const inactive = await createUser(workshop.id, {
    fullName: "Departed Personnel",
    isActive: false,
  });
  const planner = await createUser(planning.id, { fullName: "Planner" });

  return { workshop, planning, manager, artisan, inactive, planner };
}

describe("organization unit filter", () => {
  it("returns only users belonging to that unit", async () => {
    const { planning } = await setupCompany();

    const result = await listUsers(testDb, { orgUnitId: planning.id });

    expect(result.map((u) => u.fullName)).toEqual(["Planner"]);
  });
});

describe("status filter", () => {
  it("returns only inactive accounts", async () => {
    await setupCompany();

    const result = await listUsers(testDb, { isActive: false });

    expect(result.map((u) => u.fullName)).toEqual(["Departed Personnel"]);
  });

  it("returns only active accounts", async () => {
    await setupCompany();

    const result = await listUsers(testDb, { isActive: true });

    expect(result.map((u) => u.fullName)).not.toContain("Departed Personnel");
  });
});

describe("role filter", () => {
  it("returns only unit managers", async () => {
    await setupCompany();

    const result = await listUsers(testDb, { role: "unitManager" });

    expect(result.map((u) => u.fullName)).toEqual(["Workshop Manager"]);
  });
});

describe("search", () => {
  it("searches within name case-insensitively", async () => {
    await setupCompany();

    const result = await listUsers(testDb, { query: "artisan" });

    expect(result.map((u) => u.fullName)).toEqual(["Lead Artisan"]);
  });

  it("searches within email as well", async () => {
    const { artisan } = await setupCompany();

    const result = await listUsers(testDb, { query: artisan.email.slice(0, 8) });

    expect(result.map((u) => u.id)).toContain(artisan.id);
  });
});

describe("pagination", () => {
  it("limits number of returned records according to limit", async () => {
    await setupCompany();

    const result = await listUsers(testDb, {}, { limit: 2 });

    expect(result).toHaveLength(2);
  });

  it("counter returns filtered total", async () => {
    const { workshop } = await setupCompany();

    expect(await countUsers(testDb, { orgUnitId: workshop.id })).toBe(3);
    expect(await countUsers(testDb, {})).toBe(4);
  });
});

describe("combined filters", () => {
  it("filters by unit and active status together", async () => {
    const { workshop } = await setupCompany();

    const result = await listUsers(testDb, {
      orgUnitId: workshop.id,
      isActive: false,
    });

    expect(result.map((u) => u.fullName)).toEqual(["Departed Personnel"]);
  });
});
