import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Verifies that user form fields are correctly mapped to server actions.
// Uses real FormData payloads to verify server behavior when checkboxes are unchecked (omitted).

const { session } = vi.hoisted(() => ({
  session: { user: null as { id: string; isSystemAdmin: boolean; isUnitManager: boolean } | null },
}));

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: async () => session.user,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/server/db", async () => {
  const { testDb } = await import("../helpers/test-db");
  return { prisma: testDb };
});

const { createUserAction, updateUserAction } = await import(
  "@/app/admin/users/actions"
);

import { createOrgUnit, createUser as seedUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

let unitId = "";

beforeEach(async () => {
  await resetDatabase();

  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  unitId = root.id;

  const admin = await seedUser(root.id, {
    fullName: "System Admin",
    email: "admin@example.test",
    isSystemAdmin: true,
  });

  session.user = { id: admin.id, isSystemAdmin: true, isUnitManager: false };
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Form data helper simulating browser FormData submissions */
function createFormData(fields: Record<string, string>): FormData {
  const form = new FormData();
  form.set("fullName", "New Personnel");
  form.set("email", `personnel-${Math.random().toString(36).slice(2, 8)}@example.test`);
  form.set("orgUnitId", unitId);
  form.set("initialPassword", "very-long-password-2026");
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

describe("system admin creates user", () => {
  it("persists title correctly", async () => {
    const result = await createUserAction(
      { error: null, success: null, blockers: null },
      createFormData({ title: "Tool Operator", writesActivities: "on", isScored: "on" }),
    );

    expect(result.error).toBeNull();

    const record = await testDb.user.findFirstOrThrow({
      where: { fullName: "New Personnel" },
    });
    expect(record.title).toBe("Tool Operator");
  });

  it("stores empty title as null", async () => {
    await createUserAction(
      { error: null, success: null, blockers: null },
      createFormData({ title: "", writesActivities: "on" }),
    );

    const record = await testDb.user.findFirstOrThrow({
      where: { fullName: "New Personnel" },
    });
    expect(record.title).toBeNull();
  });

  it("leaves isScored as false when checkbox is unchecked", async () => {
    await createUserAction(
      { error: null, success: null, blockers: null },
      createFormData({ title: "Consultant", writesActivities: "on" }),
    );

    const record = await testDb.user.findFirstOrThrow({
      where: { fullName: "New Personnel" },
    });
    expect(record.isScored).toBe(false);
  });

  it("sets isScored to true when checkbox is checked", async () => {
    await createUserAction(
      { error: null, success: null, blockers: null },
      createFormData({ title: "Artisan", writesActivities: "on", isScored: "on" }),
    );

    const record = await testDb.user.findFirstOrThrow({
      where: { fullName: "New Personnel" },
    });
    expect(record.isScored).toBe(true);
  });
});

describe("system admin updates user", () => {
  async function createTargetUser() {
    return seedUser(unitId, {
      fullName: "Existing Personnel",
      email: "existing@example.test",
      title: "Old Title",
      isScored: true,
    });
  }

  function updateFormData(id: string, fields: Record<string, string>): FormData {
    const form = new FormData();
    form.set("id", id);
    form.set("fullName", "Existing Personnel");
    form.set("email", "existing@example.test");
    form.set("orgUnitId", unitId);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  }

  it("updates title and preserves it across saves", async () => {
    const user = await createTargetUser();

    await updateUserAction(
      { error: null, success: null, blockers: null },
      updateFormData(user.id, { title: "New Title", writesActivities: "on", isScored: "on" }),
    );

    const fresh = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.title).toBe("New Title");
  });

  it("unchecking score box sets isScored to false on update", async () => {
    const user = await createTargetUser();

    await updateUserAction(
      { error: null, success: null, blockers: null },
      updateFormData(user.id, { title: "New Title", writesActivities: "on" }),
    );

    const fresh = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.isScored).toBe(false);
  });
});
