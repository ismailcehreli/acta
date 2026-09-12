import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity } from "@/server/activities/approval";
import { createActivity } from "@/server/activities/write";

import {
  missingLoadPeople,
  approvedHistoryRow,
  approvedHistoryType,
} from "../helpers/acceptance-load-data";
import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Acceptance load data format test.
// Validates that bulk-loaded historical records conform exactly to the schema
// produced by real services.

const NOW = new Date("2026-08-18T09:00:00.000Z");
const DECIDED_AT = new Date("2026-08-19T11:00:00.000Z");

const EXPECTED_DIFFERING_FIELDS = new Set([
  "id",
  "activityNo",
  "title",
  "description",
  "updatedAt",
]);

describe("acceptance load data — company sizing", () => {
  it("counts existing users toward total target", () => {
    expect(missingLoadPeople(8)).toBe(32);
  });

  it("adds zero users when target is already reached", () => {
    expect(missingLoadPeople(40)).toBe(0);
  });

  it("throws error when existing count exceeds target", () => {
    expect(() => missingLoadPeople(41)).toThrow(/40/);
  });

  it("rejects invalid count values", () => {
    expect(() => missingLoadPeople(-1)).toThrow();
    expect(() => missingLoadPeople(1.5)).toThrow();
  });
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupScene() {
  const root = await createOrgUnit({ name: "Company", type: "ROOT" });
  const unit = await createOrgUnit({
    name: "Paint Shop",
    parentId: root.id,
    requiresApproval: true,
  });
  const manager = await createUser(unit.id, { isUnitManager: true });
  const employee = await createUser(unit.id);

  return { unit, manager, employee };
}

describe("acceptance load data — bulk history schema parity", () => {
  it("verifies bulk-written approved record matches service-produced record field-for-field", async () => {
    const { unit, manager, employee } = await setupScene();

    // 1) Real service workflow: write, then approve.
    const written = await createActivity(
      testDb,
      { id: employee.id, orgUnitId: unit.id, requiresApproval: true },
      {
        activityDate: "2026-08-18",
        title: "Service written record",
        description: "Record written through real application services.",
        targetDepartmentIds: [unit.id],
      },
      NOW,
    );
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const approved = await approveActivity(
      testDb,
      manager.id,
      written.activity.id,
      DECIDED_AT,
    );
    expect(approved.ok).toBe(true);

    const serviceRow = await testDb.activity.findUniqueOrThrow({
      where: { id: written.activity.id },
    });

    // 2) Bulk load generator row.
    const bulkId = (
      await testDb.activity.create({
        data: approvedHistoryRow({
          authorId: employee.id,
          authorOrgUnitId: unit.id,
          approverId: manager.id,
          activityDate: new Date("2026-08-18T00:00:00.000Z"),
          submittedAt: serviceRow.createdAt,
          decidedAt: serviceRow.approvalDecidedAt ?? DECIDED_AT,
        }),
      })
    ).id;

    const bulkRow = await testDb.activity.findUniqueOrThrow({
      where: { id: bulkId },
    });

    // 3) Field by field comparison.
    const differences: string[] = [];
    for (const field of Object.keys(serviceRow)) {
      if (EXPECTED_DIFFERING_FIELDS.has(field)) continue;

      const expected = serviceRow[field as keyof typeof serviceRow];
      const actual = bulkRow[field as keyof typeof bulkRow];
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        differences.push(`${field}: service=${String(expected)} · bulk=${String(actual)}`);
      }
    }

    expect(differences).toEqual([]);
  });

  it("verifies bulk-written approval round matches service-produced approval round", async () => {
    const { unit, manager, employee } = await setupScene();

    const written = await createActivity(
      testDb,
      { id: employee.id, orgUnitId: unit.id, requiresApproval: true },
      {
        activityDate: "2026-08-18",
        title: "Service written record",
        description: "Record written through real application services.",
        targetDepartmentIds: [unit.id],
      },
      NOW,
    );
    if (!written.ok) throw new Error("setup failed");
    await approveActivity(testDb, manager.id, written.activity.id, DECIDED_AT);

    const serviceRound = await testDb.approvalRound.findFirstOrThrow({
      where: { activityId: written.activity.id },
    });

    const secondActivity = await testDb.activity.create({
      data: approvedHistoryRow({
        authorId: employee.id,
        authorOrgUnitId: unit.id,
        approverId: manager.id,
        activityDate: new Date("2026-08-18T00:00:00.000Z"),
        submittedAt: NOW,
        decidedAt: DECIDED_AT,
      }),
    });
    const bulkRound = await testDb.approvalRound.create({
      data: approvedHistoryType({
        activityId: secondActivity.id,
        decidedById: manager.id,
        submittedAt: serviceRound.submittedAt,
        decidedAt: serviceRound.decidedAt ?? DECIDED_AT,
      }),
    });

    const differences: string[] = [];
    for (const field of Object.keys(serviceRound)) {
      if (field === "id" || field === "activityId") continue;

      const expected = serviceRound[field as keyof typeof serviceRound];
      const actual = bulkRound[field as keyof typeof bulkRound];
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        differences.push(`${field}: service=${String(expected)} · bulk=${String(actual)}`);
      }
    }

    expect(differences).toEqual([]);
  });
});
