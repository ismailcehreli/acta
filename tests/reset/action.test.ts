import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// System reset action is also tested with real FormData. Even if the authorization
// warning on the page is removed, the action must not execute a non-system-admin request.
const { sessionState } = vi.hoisted(() => ({
  sessionState: {
    user: null as { id: string; isSystemAdmin: boolean } | null,
  },
}));

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: async () => sessionState.user,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/server/db", async () => {
  const { testDb } = await import("../helpers/test-db");
  return { prisma: testDb };
});

const { requestSystemResetAction } = await import(
  "@/app/admin/settings/reset/actions"
);

import { createOrgUnit, createUserWithPassword } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
  sessionState.user = null;
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function admin() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const user = await createUserWithPassword(root.id, "current-password-123", {
    fullName: "Current System Admin",
    email: "current-reset@example.test",
    isSystemAdmin: true,
  });
  sessionState.user = { id: user.id, isSystemAdmin: true };
  return user;
}

function resetForm(confirmation: string): FormData {
  const form = new FormData();
  form.set("currentPassword", "current-password-123");
  form.set("bootstrapFullName", "New Bootstrap Admin");
  form.set("bootstrapEmail", "new-reset@example.test");
  form.set("bootstrapPassword", "new-bootstrap-password-123");
  form.set("bootstrapPasswordRepeat", "new-bootstrap-password-123");
  form.set("confirmation", confirmation);
  return form;
}

describe("system reset server action", () => {
  it("does not create request with invalid confirmation text", async () => {
    await admin();

    const result = await requestSystemResetAction(
      { error: null, success: null },
      resetForm("RESET-APPLICATION"),
    );

    expect(result.error).toContain("Type RESET APPLICATION to start the operation");
    expect(await testDb.systemResetRequest.count()).toBe(0);
  });

  it("creates pending request with valid FormData", async () => {
    const actor = await admin();

    const result = await requestSystemResetAction(
      { error: null, success: null },
      resetForm("RESET APPLICATION"),
    );

    expect(result).toEqual({
      error: null,
      success:
        "Request queued. A backup will be created first; active sessions will be signed out when the operation starts.",
    });
    await expect(testDb.systemResetRequest.findFirstOrThrow()).resolves.toMatchObject({
      requestedById: actor.id,
      status: "PENDING",
      bootstrapEmail: "new-reset@example.test",
      bootstrapPasswordHash: expect.not.stringContaining("new-bootstrap-password-123"),
    });
  });

  it("non-system-admin user cannot execute action", async () => {
    const actor = await admin();
    sessionState.user = { id: actor.id, isSystemAdmin: false };

    await expect(
      requestSystemResetAction(
        { error: null, success: null },
        resetForm("RESET APPLICATION"),
      ),
    ).rejects.toThrow("system administrator");
    expect(await testDb.systemResetRequest.count()).toBe(0);
  });
});
