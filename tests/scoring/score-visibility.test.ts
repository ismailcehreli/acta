import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { readUserScore, readTeamScores } from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Score visibility rules:
// Scores are calculated relative to the viewer's visibility scope.
// There are no company-wide rankings to avoid leaking private activity information.

const NOW = new Date("2026-08-22T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  const workshop = await createOrgUnit({ name: "Workshop", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const gm = await createUser(root.id, { fullName: "General Manager", isUnitManager: true });
  const manager = await createUser(workshop.id, {
    fullName: "Workshop Manager",
    isUnitManager: true,
  });
  const artisan = await createUser(workshop.id, { fullName: "Lead Artisan" });
  const outsider = await createUser(planning.id, { fullName: "Planner" });

  return { gm, manager, artisan, outsider };
}

describe("visibility scope", () => {
  it("user can view their own score", async () => {
    const { artisan } = await setupCompany();

    const score = await readUserScore(testDb, { id: artisan.id, isSystemAdmin: false }, artisan.id, NOW);

    expect(score).not.toBeNull();
  });

  it("manager can view subordinate's score", async () => {
    const { manager, artisan } = await setupCompany();

    const score = await readUserScore(testDb, { id: manager.id, isSystemAdmin: false }, artisan.id, NOW);

    expect(score).not.toBeNull();
  });

  it("score of out-of-scope user returns null", async () => {
    const { manager, outsider } = await setupCompany();

    const score = await readUserScore(testDb, { id: manager.id, isSystemAdmin: false }, outsider.id, NOW);

    expect(score).toBeNull();
  });

  it("system admin cannot view another user's score outside hierarchy (§15.1)", async () => {
    const admin = await createUser(
      (await createOrgUnit({ name: "Company Root", type: "Root" })).id,
      { fullName: "System Admin", isSystemAdmin: true },
    );
    const unit = await createOrgUnit({ name: "Workshop", parentId: admin.orgUnitId });
    const artisan = await createUser(unit.id, { fullName: "Lead Artisan" });

    const score = await readUserScore(testDb, { id: admin.id, isSystemAdmin: true }, artisan.id, NOW);

    expect(score).toBeNull();
  });
});

describe("when scoring is disabled", () => {
  it("does not compute score if setting is false", async () => {
    const { artisan } = await setupCompany();
    await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "false" });

    const score = await readUserScore(testDb, { id: artisan.id, isSystemAdmin: false }, artisan.id, NOW);

    expect(score).toBeNull();
  });
});

describe("isScored and activity expectation flags", () => {
  it("does not generate score for users with isScored set to false", async () => {
    const { artisan } = await setupCompany();
    await testDb.user.update({ where: { id: artisan.id }, data: { isScored: false } });

    const score = await readUserScore(testDb, { id: artisan.id, isSystemAdmin: false }, artisan.id, NOW);

    expect(score).toBeNull();
  });

  it("does not generate score for users where writesActivities is false", async () => {
    const { artisan } = await setupCompany();
    await testDb.user.update({
      where: { id: artisan.id },
      data: { writesActivities: false },
    });

    const score = await readUserScore(testDb, { id: artisan.id, isSystemAdmin: false }, artisan.id, NOW);

    expect(score).toBeNull();
  });
});

describe("team score list", () => {
  it("includes only users within viewer scope", async () => {
    const { manager, artisan, outsider } = await setupCompany();
    await createActivity(artisan, { activityDate: new Date("2026-08-19T00:00:00.000Z") });

    const list = await readTeamScores(testDb, { id: manager.id, isSystemAdmin: false }, NOW);

    const ids = list.map((s) => s.userId);
    expect(ids).toContain(artisan.id);
    expect(ids).not.toContain(outsider.id);
  });

  it("excludes non-scored users from team list", async () => {
    const { manager, artisan } = await setupCompany();
    await testDb.user.update({ where: { id: artisan.id }, data: { isScored: false } });

    const list = await readTeamScores(testDb, { id: manager.id, isSystemAdmin: false }, NOW);

    expect(list.map((s) => s.userId)).not.toContain(artisan.id);
  });
});
