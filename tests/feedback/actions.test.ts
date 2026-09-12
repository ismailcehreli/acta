import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// These tests verify server actions with real FormData instances.
// Validates that unauthorized direct server action invocations are properly rejected.
const { session } = vi.hoisted(() => ({
  session: {
    user: null as { id: string; isSystemAdmin: boolean } | null,
  },
}));

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: async () => session.user,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/server/db", async () => {
  const { testDb } = await import("../helpers/test-db");
  return { prisma: testDb };
});

const {
  archiveFeedbackAction,
  createFeedbackAction,
  markFeedbackReadAction,
  updateFeedbackAction,
} = await import("@/app/feedback/actions");

import { createFeedback } from "@/server/feedback/service";

import { createOrgUnit, createUser as seedUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-09-02T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  session.user = null;
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupUsers() {
  const root = await createOrgUnit({ name: "Company", type: "ROOT" });
  const admin = await seedUser(root.id, {
    fullName: "System Admin",
    email: "admin-feedback@example.test",
    isSystemAdmin: true,
  });
  const manager = await seedUser(root.id, {
    fullName: "Unit Manager",
    email: "manager-feedback@example.test",
    isUnitManager: true,
  });
  const employee = await seedUser(root.id, {
    fullName: "Feedback Submitter",
    email: "employee-feedback@example.test",
  });

  return { admin, manager, employee };
}

function createForm(): FormData {
  const form = new FormData();
  form.set("category", "BUG");
  form.set("title", "Search screen issue");
  form.set("description", "Search results are not loading as expected.");
  form.set("sourcePath", "Search");
  return form;
}

function updateForm(id: string): FormData {
  const form = new FormData();
  form.set("id", id);
  form.set("status", "RESOLVED");
  form.set("response", "Fix has been released.");
  return form;
}

function idForm(id: string): FormData {
  const form = new FormData();
  form.set("id", id);
  return form;
}

describe("feedback server actions", () => {
  it("allows user to submit feedback via FormData", async () => {
    const { employee } = await setupUsers();
    session.user = { id: employee.id, isSystemAdmin: false };

    const result = await createFeedbackAction(
      { error: null, success: null },
      createForm(),
    );

    expect(result.error).toBeNull();
    expect(result.success).toBeDefined();

    const stored = await testDb.feedback.findFirstOrThrow({
      where: { submittedById: employee.id },
    });
    expect(stored.title).toBe("Search screen issue");
  });

  it("prevents non-admin user from invoking admin management actions", async () => {
    const { manager, employee } = await setupUsers();
    const created = await createFeedback(
      testDb,
      employee.id,
      {
        category: "BUG",
        title: "Search screen issue",
        description: "Search results are not loading as expected.",
      },
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");

    session.user = { id: manager.id, isSystemAdmin: false };

    const update = await updateFeedbackAction(
      { error: null, success: null },
      updateForm(created.feedback.id),
    );
    expect(update.error).toBeDefined();

    await markFeedbackReadAction(idForm(created.feedback.id));
    await archiveFeedbackAction(idForm(created.feedback.id));

    const unchanged = await testDb.feedback.findUniqueOrThrow({
      where: { id: created.feedback.id },
    });
    expect(unchanged.status).toBe("NEW");
    expect(unchanged.readAt).toBeNull();
    expect(unchanged.archivedAt).toBeNull();
  });

  it("allows system admin to resolve feedback item", async () => {
    const { admin, employee } = await setupUsers();
    const created = await createFeedback(
      testDb,
      employee.id,
      {
        category: "SUGGESTION",
        title: "Feature suggestion",
        description: "Suggestion to be updated via management screen.",
      },
      NOW,
    );
    if (!created.ok) throw new Error("setup failed");

    session.user = { id: admin.id, isSystemAdmin: true };
    const result = await updateFeedbackAction(
      { error: null, success: null },
      updateForm(created.feedback.id),
    );

    expect(result.error).toBeNull();
    expect(result.success).toBeDefined();

    await expect(
      testDb.feedback.findUniqueOrThrow({ where: { id: created.feedback.id } }),
    ).resolves.toMatchObject({
      status: "RESOLVED",
      response: "Fix has been released.",
      resolvedById: admin.id,
    });
  });
});
