import { describe, expect, it } from "vitest";

import { hasDatabaseSentinel, isUniqueViolation } from "@/server/db-errors";
import { createUser } from "@/server/users/create";

// Translating database constraint errors into correct user messages.
//
// These tests originated from an issue observed in production bundles (22.08.2026, during WebKit run).
// Prisma prepends minified module source code to the error message in bundled code.
// When strings like `includes("USER_INACTIVE_ORG_UNIT")` appear in that source, simple substring
// matching selects the wrong branch: sysadmin would see "cannot attach active user to inactive unit"
// instead of "this email is already registered".

/** Production error format: bundle source + actual database error. */
const PRODUCTION_ERROR = new Error(
  [
    "Invalid `a.orgUnit.findUnique()` invocation in",
    "/app/.next/server/chunks/ssr/[root-of-the-server]__0zyne2a._.js:1:6480",
    '→ 1 module.exports=[82408,a=>{let d=(a)=>a.includes("ORG_TREE_CYCLE")?f("cycle"):' +
      'a.includes("ORG_UNIT_HAS_ACTIVE_USERS")?f("has_active_users"):' +
      'a.includes("USER_INACTIVE_ORG_UNIT")?f("inactive_parent"):f("unknown")}]',
    "Unique constraint failed on the fields: (`email`)",
  ].join("\n"),
);

/** Actual error thrown by trigger: in `NAME: description` format. */
const TRIGGER_ERROR = new Error(
  "USER_INACTIVE_ORG_UNIT: an active user cannot be attached to an inactive unit",
);

describe("constraint error translation", () => {
  it("does not treat strings inside bundled source as constraint violations", () => {
    expect(hasDatabaseSentinel(PRODUCTION_ERROR, "USER_INACTIVE_ORG_UNIT")).toBe(false);
    expect(hasDatabaseSentinel(PRODUCTION_ERROR, "ORG_TREE_CYCLE")).toBe(false);
  });

  it("recognizes genuine trigger errors", () => {
    expect(hasDatabaseSentinel(TRIGGER_ERROR, "USER_INACTIVE_ORG_UNIT")).toBe(true);
  });

  it("does not confuse with another constraint name", () => {
    expect(hasDatabaseSentinel(TRIGGER_ERROR, "ORG_TREE_CYCLE")).toBe(false);
  });

  it("identifies unique constraint violations by code rather than text", () => {
    expect(isUniqueViolation(PRODUCTION_ERROR)).toBe(true);
    expect(isUniqueViolation(TRIGGER_ERROR)).toBe(false);
  });
});

describe("user creation: production error shape", () => {
  // Mock db: unit is active, setting is null, transaction fails with unique constraint
  const mockDb = {
    orgUnit: { findUnique: async () => ({ isActive: true }) },
    systemSetting: { findUnique: async () => null },
    user: {},
    auditLog: {},
    $transaction: async () => {
      throw PRODUCTION_ERROR;
    },
  } as unknown as Parameters<typeof createUser>[0];

  it("duplicate email reports already registered rather than inactive unit", async () => {
    const result = await createUser(mockDb, {
      fullName: "Duplicate User",
      email: "existing@example.test",
      orgUnitId: "unit-1",
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: "initial-password-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("duplicate_email");
    expect(result.message).toContain("already registered");
  });
});
