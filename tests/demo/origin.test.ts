import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "@/server/audit/log";
import { DEMO_EMAIL_DOMAIN, DEMO_UNIT_NAMES, installDemoData } from "@/server/demo/data";
import {
  classifyLegacyDemoOrgUnits,
  DEMO_OBJECT_ORG_UNIT,
  DEMO_ORIGIN_CREATED,
  DEMO_ORIGIN_REUSED,
  listLegacyDemoOriginCandidates,
} from "@/server/demo/origin";
import { purgeDemoData } from "@/server/demo/purge";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupDemo(preexistingPlanning = false) {
  const root = await createOrgUnit({ name: "Acta HQ", type: "Root" });
  const admin = await createUser(root.id, {
    fullName: "System Administrator",
    email: "admin@company.test",
    isSystemAdmin: true,
  });
  const planning = preexistingPlanning
    ? await createOrgUnit({ name: "Production Planning", parentId: root.id })
    : null;

  const result = await installDemoData(testDb);
  if (!result.ok) throw new Error(`Installation failed: ${result.error}`);

  return { root, admin, planning };
}

async function getDemoCounts() {
  return {
    users: await testDb.user.count({
      where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    }),
    activities: await testDb.activity.count({
      where: { author: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } },
    }),
    units: await testDb.orgUnit.count({
      where: { name: { in: [...DEMO_UNIT_NAMES] } },
    }),
  };
}

describe("demo org unit origin", () => {
  it("database rejects invalid origin value", async () => {
    await expect(
      testDb.$executeRawUnsafe(
        `INSERT INTO "DemoObject" ("objectType", "objectId", "origin") ` +
          `VALUES ('org_unit', 'invalid', 'GUESSED')`,
      ),
    ).rejects.toThrow();
    expect(await testDb.demoObject.count()).toBe(0);
  });

  it("fresh installation distinguishes created and reused units", async () => {
    const { planning } = await setupDemo(true);

    const records = await testDb.demoObject.findMany({
      where: { objectType: DEMO_OBJECT_ORG_UNIT },
      orderBy: { objectId: "asc" },
    });

    expect(records).toHaveLength(DEMO_UNIT_NAMES.length);
    expect(
      records.filter((record) => record.origin === DEMO_ORIGIN_CREATED),
    ).toHaveLength(DEMO_UNIT_NAMES.length - 1);
    expect(records).toContainEqual(
      expect.objectContaining({
        objectId: planning!.id,
        origin: DEMO_ORIGIN_REUSED,
      }),
    );
  });

  it("second installation does not overwrite origin of created units as reused", async () => {
    await setupDemo();

    const before = await testDb.demoObject.findMany({
      where: { objectType: DEMO_OBJECT_ORG_UNIT },
      select: { objectId: true, origin: true },
      orderBy: { objectId: "asc" },
    });
    const retry = await installDemoData(testDb);
    expect(retry.ok).toBe(true);
    const after = await testDb.demoObject.findMany({
      where: { objectType: DEMO_OBJECT_ORG_UNIT },
      select: { objectId: true, origin: true },
      orderBy: { objectId: "asc" },
    });

    expect(after).toEqual(before);
    expect(after.every((record) => record.origin === DEMO_ORIGIN_CREATED)).toBe(
      true,
    );
  });

  it("does not delete anything when legacy demo origin is undetermined", async () => {
    const { admin } = await setupDemo();
    await testDb.demoObject.deleteMany();
    const before = await getDemoCounts();

    const candidates = await listLegacyDemoOriginCandidates(testDb);
    const result = await purgeDemoData(testDb, admin.id, new Date());

    expect(candidates).toHaveLength(DEMO_UNIT_NAMES.length);
    expect(result).toEqual({
      ok: false,
      error: "legacy_demo_origin_unknown",
      candidates,
    });
    expect(await getDemoCounts()).toEqual(before);
    expect(await testDb.demoObject.count()).toBe(0);
  });

  it("cleans up in single pass once all legacy units are explicitly classified", async () => {
    const { admin } = await setupDemo();
    await testDb.demoObject.deleteMany();
    const candidates = await listLegacyDemoOriginCandidates(testDb);

    const classification = await classifyLegacyDemoOrgUnits(
      testDb,
      admin.id,
      candidates.map((candidate) => ({
        orgUnitId: candidate.id,
        origin: DEMO_ORIGIN_CREATED,
      })),
      new Date("2026-08-24T00:00:00.000Z"),
    );
    expect(classification).toEqual({
      ok: true,
      classified: DEMO_UNIT_NAMES.length,
    });

    const purgeResult = await purgeDemoData(testDb, admin.id, new Date());
    expect(purgeResult.ok).toBe(true);
    expect(await getDemoCounts()).toEqual({ users: 0, activities: 0, units: 0 });
    expect(await testDb.demoObject.count()).toBe(0);
    expect(
      await testDb.auditLog.count({
        where: { action: AUDIT_ACTIONS.demoOriginClassified },
      }),
    ).toBe(1);
  });

  it("rolls back previous deletions if any owned unit cannot be deleted", async () => {
    const { admin } = await setupDemo();
    const planning = await testDb.orgUnit.findFirstOrThrow({
      where: { name: "Production Planning" },
      select: { id: true },
    });
    // Create a real child unit under demo Planning unit
    await createOrgUnit({ name: "Real Sub Unit", parentId: planning.id });
    const before = await getDemoCounts();

    const result = await purgeDemoData(testDb, admin.id, new Date());

    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "blocked") {
      throw new Error("Purge should have been blocked by real sub-unit");
    }
    expect(result.detail).toContain("Production Planning");
    expect(await getDemoCounts()).toEqual(before);
    expect(await testDb.demoObject.count()).toBe(DEMO_UNIT_NAMES.length);
  });

  it("atomically rejects missing or extra classification entries", async () => {
    const { root, admin } = await setupDemo();
    await testDb.demoObject.deleteMany();
    const candidates = await listLegacyDemoOriginCandidates(testDb);

    const missing = await classifyLegacyDemoOrgUnits(
      testDb,
      admin.id,
      candidates.slice(1).map((candidate) => ({
        orgUnitId: candidate.id,
        origin: DEMO_ORIGIN_CREATED,
      })),
    );
    expect(missing).toEqual({ ok: false, error: "candidate_set_changed" });
    expect(await testDb.demoObject.count()).toBe(0);

    const extra = await classifyLegacyDemoOrgUnits(testDb, admin.id, [
      ...candidates.map((candidate) => ({
        orgUnitId: candidate.id,
        origin: DEMO_ORIGIN_CREATED,
      })),
      { orgUnitId: root.id, origin: DEMO_ORIGIN_CREATED },
    ]);
    expect(extra).toEqual({ ok: false, error: "candidate_set_changed" });
    expect(await testDb.demoObject.count()).toBe(0);
  });

  it("allows marking real unit as reused in legacy installation", async () => {
    const { admin, planning } = await setupDemo(true);
    await testDb.demoObject.deleteMany();
    const candidates = await listLegacyDemoOriginCandidates(testDb);

    const classification = await classifyLegacyDemoOrgUnits(
      testDb,
      admin.id,
      candidates.map((candidate) => ({
        orgUnitId: candidate.id,
        origin:
          candidate.id === planning!.id ? DEMO_ORIGIN_REUSED : DEMO_ORIGIN_CREATED,
      })),
    );
    expect(classification.ok).toBe(true);

    const purgeResult = await purgeDemoData(testDb, admin.id, new Date());
    expect(purgeResult.ok).toBe(true);
    expect(
      await testDb.orgUnit.count({ where: { id: planning!.id } }),
    ).toBe(1);
    expect(
      await testDb.user.count({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } }),
    ).toBe(0);
    expect(await testDb.demoObject.count()).toBe(0);
  });
});
