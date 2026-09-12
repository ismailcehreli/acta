import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  archiveFeedback,
  countManageableFeedback,
  createFeedback,
  listManageableFeedback,
  listOwnFeedback,
  markFeedbackRead,
  updateFeedback,
} from "@/server/feedback/service";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-28T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function users() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const a = await createOrgUnit({ name: "Mold Shop", parentId: root.id });
  const b = await createOrgUnit({ name: "Planning", parentId: root.id });

  const admin = await createUser(root.id, {
    fullName: "System Admin",
    isSystemAdmin: true,
  });
  const managerA = await createUser(a.id, {
    fullName: "Mold Shop Manager",
    isUnitManager: true,
  });
  const employeeA = await createUser(a.id, { fullName: "Mold Shop Employee" });
  const managerB = await createUser(b.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });
  const employeeB = await createUser(b.id, { fullName: "Planning Employee" });

  return { admin, managerA, employeeA, managerB, employeeB };
}

const feedback = {
  category: "SUGGESTION" as const,
  title: "Improve search filters",
  description: "I would like to see recent filters in the search box.",
  sourcePath: "Search",
  adminsOnly: false,
};

describe("feedback service", () => {
  it("user creates feedback and sees only their own entries", async () => {
    const { employeeA, employeeB } = await users();

    const result = await createFeedback(testDb, employeeA.id, feedback, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.feedback.submittedByName).toBe("Mold Shop Employee");
    expect(result.feedback.submittedByUnitName).toBe("Mold Shop");
    expect(result.feedback.status).toBe("NEW");
    expect(await listOwnFeedback(testDb, employeeA.id)).toHaveLength(1);
    expect(await listOwnFeedback(testDb, employeeB.id)).toHaveLength(0);
  });

  it("rejects text containing HTML", async () => {
    const { employeeA } = await users();

    const result = await createFeedback(
      testDb,
      employeeA.id,
      { ...feedback, description: "<script>alert('x')</script>" },
      NOW,
    );

    expect(result).toEqual({
      ok: false,
      error: "invalid",
      message: "The title and description must have valid lengths; HTML is not allowed.",
    });
  });

  it("only system admin manages all open feedback entries", async () => {
    const { managerA, managerB, employeeA, employeeB, admin } = await users();
    await createFeedback(testDb, employeeA.id, feedback, NOW);
    await createFeedback(testDb, employeeB.id, feedback, NOW);

    expect(await listManageableFeedback(testDb, managerA.id)).toHaveLength(0);
    expect(await listManageableFeedback(testDb, managerB.id)).toHaveLength(0);
    expect(await listManageableFeedback(testDb, admin.id)).toHaveLength(2);
  });

  it("counts manageable new feedback entries according to authorization scope", async () => {
    const { managerA, employeeA, employeeB, admin } = await users();
    await createFeedback(testDb, employeeA.id, feedback, NOW);
    await createFeedback(testDb, employeeB.id, feedback, NOW);

    expect(await countManageableFeedback(testDb, managerA.id)).toBe(0);
    expect(await countManageableFeedback(testDb, admin.id)).toBe(2);
  });

  it("admin-only feedback is hidden from unit managers", async () => {
    const { managerA, employeeA, admin } = await users();
    const result = await createFeedback(
      testDb,
      employeeA.id,
      { ...feedback, adminsOnly: true },
      NOW,
    );
    expect(result.ok).toBe(true);

    expect(await listManageableFeedback(testDb, managerA.id)).toHaveLength(0);
    expect(await listManageableFeedback(testDb, admin.id)).toHaveLength(1);
  });

  it("records read, review, and resolution status; creates user notifications", async () => {
    const { admin, employeeA } = await users();
    const created = await createFeedback(testDb, employeeA.id, feedback, NOW);
    if (!created.ok) throw new Error("Failed to create feedback");

    expect(await markFeedbackRead(testDb, admin.id, created.feedback.id, NOW)).toEqual({
      ok: true,
    });

    const inReview = await updateFeedback(
      testDb,
      admin.id,
      created.feedback.id,
      { status: "IN_REVIEW", response: "Under review." },
      NOW,
    );
    expect(inReview.ok).toBe(true);
    if (!inReview.ok) return;
    expect(inReview.feedback).toMatchObject({
      status: "IN_REVIEW",
      response: "Under review.",
      readByName: "System Admin",
      reviewedByName: "System Admin",
    });
    expect(inReview.feedback.readAt).not.toBeNull();
    expect(inReview.feedback.reviewedAt).not.toBeNull();

    const resolved = await updateFeedback(
      testDb,
      admin.id,
      created.feedback.id,
      { status: "RESOLVED", response: "Resolution completed." },
      new Date("2026-08-29T09:00:00.000Z"),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.feedback).toMatchObject({
      status: "RESOLVED",
      response: "Resolution completed.",
      resolvedByName: "System Admin",
    });
    expect(resolved.feedback.resolvedAt).not.toBeNull();

    const notices = await testDb.notificationQueue.findMany({
      where: {
        userId: employeeA.id,
        eventType: NOTIFICATION_EVENTS.feedbackStatusChanged,
      },
    });
    expect(notices.length).toBe(2);
  });

  it("unit manager cannot update; system admin can archive feedback", async () => {
    const { admin, managerB, employeeA } = await users();
    const created = await createFeedback(testDb, employeeA.id, feedback, NOW);
    if (!created.ok) throw new Error("Failed to create feedback");

    const denied = await updateFeedback(
      testDb,
      managerB.id,
      created.feedback.id,
      { status: "IN_REVIEW", response: "" },
      NOW,
    );
    expect(denied.ok).toBe(false);

    expect(await archiveFeedback(testDb, admin.id, created.feedback.id, NOW)).toEqual({
      ok: true,
    });
    expect(await listManageableFeedback(testDb, admin.id)).toHaveLength(0);
    expect(await listOwnFeedback(testDb, employeeA.id)).toHaveLength(0);
  });
});
