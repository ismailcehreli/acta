import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeScorePeriod } from "@/server/scoring/close-period";
import { readScoreTrends } from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Batch score trends authorization:
// Batch score trend reading strictly validates that each requested target user is within viewer's visibility scope.

const CLOSING_DATE = new Date(Date.UTC(2026, 7, 3, 6, 0, 0));

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Two separate branches in the org tree: neither is subordinate to the other. */
async function twoBranches() {
  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  const workshop = await createOrgUnit({ name: "Workshop", parentId: root.id });
  const paintShop = await createOrgUnit({ name: "Paint Shop", parentId: root.id });

  const workshopManager = await createUser(workshop.id, {
    fullName: "Workshop Manager",
    isUnitManager: true,
  });
  const painter = await createUser(paintShop.id, { fullName: "Paint Shop Worker" });

  await createActivity(painter, {
    activityDate: new Date("2026-07-15T00:00:00.000Z"),
  });
  await closeScorePeriod(testDb, CLOSING_DATE);

  return { workshopManager, painter };
}

describe("batch trend reading protects out-of-scope targets", () => {
  it("returns no data if out-of-scope user ID is explicitly provided", async () => {
    const { workshopManager, painter } = await twoBranches();

    const trends = await readScoreTrends(
      testDb,
      { id: workshopManager.id, isSystemAdmin: false },
      [painter.id],
    );

    expect(trends.has(painter.id)).toBe(false);
    expect(trends.size).toBe(0);
  });

  it("filters out out-of-scope IDs and returns only in-scope IDs when mixed list is provided", async () => {
    const { workshopManager, painter } = await twoBranches();

    const trends = await readScoreTrends(
      testDb,
      { id: workshopManager.id, isSystemAdmin: false },
      [painter.id, workshopManager.id],
    );

    expect(trends.has(painter.id)).toBe(false);
    expect(trends.has(workshopManager.id)).toBe(true);
  });

  it("returns trend data for in-scope subordinate", async () => {
    const root = await createOrgUnit({ name: "Company Root", type: "Root" });
    const unit = await createOrgUnit({ name: "Workshop", parentId: root.id });
    const manager = await createUser(unit.id, {
      fullName: "Workshop Manager",
      isUnitManager: true,
    });
    const artisan = await createUser(unit.id, { fullName: "Lead Artisan" });
    await createActivity(artisan, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });
    await closeScorePeriod(testDb, CLOSING_DATE);

    const trends = await readScoreTrends(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      [artisan.id],
    );

    expect(trends.get(artisan.id)?.periods.length).toBeGreaterThan(0);
  });
});
