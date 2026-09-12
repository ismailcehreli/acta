import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// Database constraints on score period rows (audit 2026-08-23, finding 15).
//
// Migration added `UserScorePeriod_valid_scores` and `UserScorePeriod_valid_days`
// constraints, but no test previously attempted to write an invalid row.
// If constraint names changed, dropped from migrations, or relaxed, tests would still pass.
//
// Tests bypass the application layer: the value of constraints lies in remaining
// valid even when the calculation code is disabled.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupUser() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const unit = await createOrgUnit({ name: "Molding", parentId: root.id });
  return createUser(unit.id, { fullName: "Lead Craftsman" });
}

/**
 * Valid period row; tests only alter a single field.
 *
 * It is important that all other fields remain valid: a missing required field
 * or foreign key error would turn the test green for the wrong reason.
 */
function buildPeriodRow(userId: string, overrides: Record<string, number | null>) {
  return {
    userId,
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    regularity: 50,
    acceptance: 20,
    approval: null as number | null,
    followUp: 10,
    total: 80,
    expectedDays: 20,
    writtenDays: 10,
    ...overrides,
  };
}

describe("score range constraint", () => {
  it("rejects regularity score above 100", async () => {
    const user = await setupUser();

    await expect(
      testDb.userScorePeriod.create({ data: buildPeriodRow(user.id, { regularity: 120 }) }),
    ).rejects.toThrow(/UserScorePeriod_valid_scores/);
  });

  it("rejects negative follow-up score", async () => {
    const user = await setupUser();

    await expect(
      testDb.userScorePeriod.create({ data: buildPeriodRow(user.id, { followUp: -1 }) }),
    ).rejects.toThrow(/UserScorePeriod_valid_scores/);
  });

  it("accepts total score above 100 with appreciation points", async () => {
    const user = await setupUser();

    const period = await testDb.userScorePeriod.create({
      data: buildPeriodRow(user.id, {
        regularity: 70,
        total: 101,
        appreciationPointsPer: 1,
      }),
    });

    expect(period.total).toBe(101);
  });

  it("rejects nullable dimension when populated and out of range", async () => {
    const user = await setupUser();

    // `acceptance` and `approval` can be null; when populated, range constraint applies to them too.
    await expect(
      testDb.userScorePeriod.create({ data: buildPeriodRow(user.id, { approval: 150 }) }),
    ).rejects.toThrow(/UserScorePeriod_valid_scores/);
  });
});

describe("day count constraint", () => {
  it("rejects negative expected days", async () => {
    const user = await setupUser();

    await expect(
      testDb.userScorePeriod.create({
        data: buildPeriodRow(user.id, { expectedDays: -1, writtenDays: 0 }),
      }),
    ).rejects.toThrow(/UserScorePeriod_valid_days/);
  });

  it("rejects written days exceeding expected days", async () => {
    const user = await setupUser();

    // "Wrote on 25 out of 20 workdays" is meaningless.
    await expect(
      testDb.userScorePeriod.create({
        data: buildPeriodRow(user.id, { expectedDays: 20, writtenDays: 25 }),
      }),
    ).rejects.toThrow(/UserScorePeriod_valid_days/);
  });

  it("rejects negative written days", async () => {
    const user = await setupUser();

    await expect(
      testDb.userScorePeriod.create({
        data: buildPeriodRow(user.id, { writtenDays: -1 }),
      }),
    ).rejects.toThrow(/UserScorePeriod_valid_days/);
  });

  it("accepts valid row", async () => {
    const user = await setupUser();

    // Counterproof: rejections above are from constraints, not missing fields.
    const created = await testDb.userScorePeriod.create({
      data: buildPeriodRow(user.id, {}),
    });

    expect(created.total).toBe(80);
  });
});
