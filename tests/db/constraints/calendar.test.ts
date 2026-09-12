import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function createPeriod(
  userId: string,
  markedById: string,
  start: string,
  end: string,
) {
  return testDb.noActivityPeriod.create({
    data: {
      userId,
      markedById,
      startDate: day(start),
      endDate: day(end),
    },
  });
}

describe("no activity period constraints", () => {
  it("end date cannot be before start date", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    const manager = await createUser(unit.id);

    await expect(
      createPeriod(user.id, manager.id, "2026-08-20", "2026-08-18"),
    ).rejects.toThrow(/NoActivityPeriod_valid_range/);
  });

  it("cannot add overlapping range for same user", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    const manager = await createUser(unit.id);

    await createPeriod(user.id, manager.id, "2026-08-17", "2026-08-21");

    await expect(
      createPeriod(user.id, manager.id, "2026-08-21", "2026-08-25"),
    ).rejects.toThrow(/NoActivityPeriod_no_overlap/);
  });

  it("allows contiguous non-overlapping ranges", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    const manager = await createUser(unit.id);

    await createPeriod(user.id, manager.id, "2026-08-17", "2026-08-21");
    const second = await createPeriod(
      user.id,
      manager.id,
      "2026-08-22",
      "2026-08-25",
    );

    expect(second.startDate.toISOString()).toBe("2026-08-22T00:00:00.000Z");
  });

  it("ranges for different users can overlap", async () => {
    const unit = await createOrgUnit();
    const first = await createUser(unit.id);
    const second = await createUser(unit.id);
    const manager = await createUser(unit.id);

    await createPeriod(first.id, manager.id, "2026-08-17", "2026-08-21");
    const other = await createPeriod(
      second.id,
      manager.id,
      "2026-08-17",
      "2026-08-21",
    );

    expect(other.userId).toBe(second.id);
  });
});

describe("work calendar singleton constraint", () => {
  it("allows creating company work calendar", async () => {
    const calendar = await testDb.workCalendar.create({
      data: {
        // Monday-Friday, 08:30-18:00 (local time in minutes)
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 510,
        workEndMinute: 1080,
      },
    });

    expect(calendar.id).toBe(1);
  });

  it("rejects second work calendar record", async () => {
    await testDb.workCalendar.create({
      data: { workingDays: [1, 2, 3, 4, 5], workStartMinute: 510, workEndMinute: 1080 },
    });

    await expect(
      testDb.workCalendar.create({
        data: {
          id: 2,
          workingDays: [1, 2, 3, 4, 5],
          workStartMinute: 510,
          workEndMinute: 1080,
        },
      }),
    ).rejects.toThrow(/WorkCalendar_singleton/);
  });
});

// Leave periods are not physically deleted; they are cancelled (audit 21.08.2026, finding 7).
describe("leave period physical deletion forbidden", () => {
  it("rejects physical deletion at database level", async () => {
    const unit = await createOrgUnit({ name: "Workshop" });
    const user = await createUser(unit.id, { email: "user@example.test" });
    const period = await createPeriod(user.id, user.id, "2026-08-18", "2026-08-22");

    await expect(
      testDb.noActivityPeriod.delete({ where: { id: period.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);

    expect(
      await testDb.noActivityPeriod.count({ where: { id: period.id } }),
    ).toBe(1);
  });

  it("requires complete cancellation fields", async () => {
    const unit = await createOrgUnit({ name: "Workshop" });
    const user = await createUser(unit.id, { email: "user@example.test" });
    const period = await createPeriod(user.id, user.id, "2026-08-18", "2026-08-22");

    // Cancellation without reason rejected
    await expect(
      testDb.noActivityPeriod.update({
        where: { id: period.id },
        data: { cancelledAt: new Date(), cancelledById: user.id },
      }),
    ).rejects.toThrow(/NoActivityPeriod_cancellation_complete/);

    // Whitespace only reason rejected
    await expect(
      testDb.noActivityPeriod.update({
        where: { id: period.id },
        data: {
          cancelledAt: new Date(),
          cancelledById: user.id,
          cancellationReason: "   ",
        },
      }),
    ).rejects.toThrow(/NoActivityPeriod_cancellation_complete/);
  });

  it("cancelled period does not conflict with exclusion constraint", async () => {
    const unit = await createOrgUnit({ name: "Workshop" });
    const user = await createUser(unit.id, { email: "user@example.test" });
    const period = await createPeriod(user.id, user.id, "2026-08-18", "2026-08-22");

    await testDb.noActivityPeriod.update({
      where: { id: period.id },
      data: {
        cancelledAt: new Date(),
        cancelledById: user.id,
        cancellationReason: "wrong date",
      },
    });

    // Can now insert same dates again
    await expect(
      createPeriod(user.id, user.id, "2026-08-18", "2026-08-22"),
    ).resolves.toBeTruthy();
  });
});
