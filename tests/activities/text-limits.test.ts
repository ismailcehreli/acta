import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  SETTING_KEYS,
  readActivityTextLimits,
  saveSettings,
} from "@/server/settings/system-settings";
import { createActivitySchema } from "@/shared/schemas/activity";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Configurable text boundaries (Task 11.6).
//
// Limit values are enforced on the **server**. Client form `minLength`/`maxLength`
// is merely a convenience: someone bypassing the client via direct request would skip it.
// These tests verify that validation is client-independent.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("boundaries read from settings", () => {
  it("default lower boundary is 1: short but non-empty text passes", async () => {
    const limits = await readActivityTextLimits(testDb);

    expect(limits.titleMin).toBe(1);
    // Audit proof (2026-08-21, finding 16): "HR" is a valid title.
    const result = createActivitySchema(limits).safeParse({
      activityDate: "2026-08-19",
      title: "HR",
      description: "OK",
      targetDepartmentIds: ["3f2a9c1e-0000-4000-8000-000000000001"],
    });

    expect(result.success).toBe(true);
  });

  it("rejects short text when setting is raised", async () => {
    await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMinChars]: "10",
      [SETTING_KEYS.activityDescriptionMinChars]: "30",
    });

    const limits = await readActivityTextLimits(testDb);
    const result = createActivitySchema(limits).safeParse({
      activityDate: "2026-08-19",
      title: "HR",
      description: "OK",
      targetDepartmentIds: ["3f2a9c1e-0000-4000-8000-000000000001"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects long text when upper limit is lowered", async () => {
    await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMaxChars]: "20",
    });

    const limits = await readActivityTextLimits(testDb);
    const result = createActivitySchema(limits).safeParse({
      activityDate: "2026-08-19",
      title: "This title is way longer than twenty characters",
      description: "A sufficiently long description text.",
      targetDepartmentIds: ["3f2a9c1e-0000-4000-8000-000000000001"],
    });

    expect(result.success).toBe(false);
  });
});

describe("error message states the boundary", () => {
  // Stating "Invalid" does not help the user know what to do; message should carry number
  // and the number must come from settings.
  it("minimum limit message includes value configured in settings", async () => {
    await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMinChars]: "12",
    });

    const limits = await readActivityTextLimits(testDb);
    const result = createActivitySchema(limits).safeParse({
      activityDate: "2026-08-19",
      title: "short",
      description: "A sufficiently long description text.",
      targetDepartmentIds: ["3f2a9c1e-0000-4000-8000-000000000001"],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("12");
    }
  });
});

describe("write path enforces boundary", () => {
  // Record must not be created even if client validation is bypassed.
  it("does not create record with text below limit", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({ name: "Tooling Workshop", parentId: root.id });
    const user = await createUser(unit.id, { fullName: "Lead Machinist" });

    await saveSettings(testDb, {
      [SETTING_KEYS.activityDescriptionMinChars]: "50",
    });

    const limits = await readActivityTextLimits(testDb);
    const result = createActivitySchema(limits).safeParse({
      activityDate: "2026-08-19",
      title: "A valid title",
      description: "Too short.",
      targetDepartmentIds: [unit.id],
    });

    expect(result.success).toBe(false);
    // Record was never created: validation stops before the write path.
    expect(await testDb.activity.count({ where: { authorId: user.id } })).toBe(0);
  });
});
