import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  appreciateActivity,
  countAppreciations,
  countAppreciationsForUser,
} from "@/server/scoring/appreciation";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Appreciation (Task 11.11).
// Appreciations are attached to activities. Valid appreciations for approved activities
// contribute points to the author's score based on system settings.

const NOW = new Date("2026-08-22T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.appreciationEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  const workshop = await createOrgUnit({ name: "Workshop", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const gm = await createUser(root.id, {
    fullName: "General Manager",
    isUnitManager: true,
    canAppreciate: true,
  });
  const manager = await createUser(workshop.id, {
    fullName: "Workshop Manager",
    isUnitManager: true,
  });
  const artisan = await createUser(workshop.id, { fullName: "Lead Artisan" });
  const outsider = await createUser(planning.id, {
    fullName: "Planner",
    canAppreciate: true,
  });

  const activity = await createActivity(artisan, { title: "Mold maintenance" });

  return { gm, manager, artisan, outsider, activity };
}

describe("who can grant appreciation", () => {
  it("authorized user can grant appreciation", async () => {
    const { gm, activity } = await setupCompany();

    const result = await appreciateActivity(testDb, gm.id, activity.id, NOW);

    expect(result.ok).toBe(true);
    expect(await countAppreciations(testDb, activity.id)).toBe(1);
  });

  it("unauthorized user cannot grant appreciation", async () => {
    const { manager, activity } = await setupCompany();

    const result = await appreciateActivity(testDb, manager.id, activity.id, NOW);

    expect(result.ok).toBe(false);
    expect(await countAppreciations(testDb, activity.id)).toBe(0);
  });

  it("user cannot appreciate their own activity", async () => {
    const { artisan, activity } = await setupCompany();
    await testDb.user.update({
      where: { id: artisan.id },
      data: { canAppreciate: true },
    });

    const result = await appreciateActivity(testDb, artisan.id, activity.id, NOW);

    expect(result.ok).toBe(false);
    expect(await countAppreciations(testDb, activity.id)).toBe(0);
  });

  it("no one can grant appreciation when appreciation setting is disabled", async () => {
    const { gm, activity } = await setupCompany();
    await saveSettings(testDb, { [SETTING_KEYS.appreciationEnabled]: "false" });

    const result = await appreciateActivity(testDb, gm.id, activity.id, NOW);

    expect(result.ok).toBe(false);
  });
});

describe("visibility scoping", () => {
  it("cannot appreciate an activity outside viewer visibility scope", async () => {
    const { outsider, activity } = await setupCompany();

    const result = await appreciateActivity(testDb, outsider.id, activity.id, NOW);

    expect(result.ok).toBe(false);
    expect(await countAppreciations(testDb, activity.id)).toBe(0);
  });
});

describe("idempotence", () => {
  it("same user cannot appreciate the same activity twice", async () => {
    const { gm, activity } = await setupCompany();
    await appreciateActivity(testDb, gm.id, activity.id, NOW);

    const second = await appreciateActivity(testDb, gm.id, activity.id, NOW);

    expect(second.ok).toBe(true);
    expect(await countAppreciations(testDb, activity.id)).toBe(1);
  });
});

describe("user appreciation counter", () => {
  const PERIOD_START = new Date("2026-08-01T00:00:00.000Z");
  const PERIOD_END = new Date("2026-08-31T23:59:59.999Z");

  async function setupCounterScenario() {
    const root = await createOrgUnit({ name: "Company Root", type: "Root" });
    const workshop = await createOrgUnit({
      name: "Workshop",
      parentId: root.id,
      requiresApproval: true,
    });

    const gm = await createUser(root.id, {
      fullName: "General Manager",
      isUnitManager: true,
      canAppreciate: true,
    });
    const manager = await createUser(workshop.id, {
      fullName: "Workshop Manager",
      isUnitManager: true,
      canAppreciate: true,
    });
    const artisan = await createUser(workshop.id, { fullName: "Lead Artisan" });

    const approved = await createActivity(artisan, {
      title: "Approved activity",
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      approvalStatus: "APPROVED",
      approverId: manager.id,
      approvalSubmittedAt: new Date("2026-08-17T08:00:00.000Z"),
      approvalDecidedAt: new Date("2026-08-17T09:00:00.000Z"),
    });

    const pending = await createActivity(artisan, {
      title: "Pending activity",
      activityDate: new Date("2026-08-18T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: manager.id,
      approvalSubmittedAt: new Date("2026-08-18T08:00:00.000Z"),
    });

    return { gm, manager, artisan, approved, pending };
  }

  it("active approver sees appreciation on pending activity in their counter", async () => {
    const { manager, artisan, approved, pending } = await setupCounterScenario();
    await appreciateActivity(testDb, manager.id, approved.id, NOW);
    await appreciateActivity(testDb, manager.id, pending.id, NOW);

    const count = await countAppreciationsForUser(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      artisan.id,
      PERIOD_START,
      PERIOD_END,
    );

    expect(count).toBe(2);
  });

  it("upper manager does not count appreciations on activities not in their scope", async () => {
    const { gm, manager, artisan, approved, pending } = await setupCounterScenario();
    await appreciateActivity(testDb, manager.id, approved.id, NOW);
    await appreciateActivity(testDb, manager.id, pending.id, NOW);

    const count = await countAppreciationsForUser(
      testDb,
      { id: gm.id, isSystemAdmin: false },
      artisan.id,
      PERIOD_START,
      PERIOD_END,
    );

    expect(count).toBe(1);
  });

  it("system admin role does not add content access to counter", async () => {
    const { artisan, manager, approved, pending } = await setupCounterScenario();
    const root = await testDb.orgUnit.findFirstOrThrow({ where: { parentId: null } });
    const admin = await createUser(root.id, {
      fullName: "System Admin",
      isSystemAdmin: true,
    });
    await appreciateActivity(testDb, manager.id, approved.id, NOW);
    await appreciateActivity(testDb, manager.id, pending.id, NOW);

    const count = await countAppreciationsForUser(
      testDb,
      { id: admin.id, isSystemAdmin: true },
      artisan.id,
      PERIOD_START,
      PERIOD_END,
    );

    expect(count).toBe(0);
  });

  it("returns null when appreciation system is disabled", async () => {
    const { manager, artisan, approved } = await setupCounterScenario();
    await appreciateActivity(testDb, manager.id, approved.id, NOW);
    await saveSettings(testDb, { [SETTING_KEYS.appreciationEnabled]: "false" });

    const count = await countAppreciationsForUser(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      artisan.id,
      PERIOD_START,
      PERIOD_END,
    );

    expect(count).toBeNull();
  });
});
