import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { markNoActivityPeriod } from "@/server/absence/service";
import { createReason } from "@/server/approval-reasons/service";
import { isExclusionViolation, isUniqueViolation } from "@/server/db-errors";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Bundled source code text inside error strings is NOT a constraint violation (audit 23.08.2026, finding 11).
//
// In minified server bundles, strings like `includes("Unique constraint")` appear in module source code.
// Prisma includes the call-site source in error messages for unrelated errors (e.g. lost connection).
// The error handlers must check structured error codes rather than raw substring searches.

/** Production error format: bundle source + underlying database error. */
function buildProductionError(sourceLine: string, actualError: string): Error {
  return new Error(
    [
      "Invalid `a.approvalReason.create()` invocation in",
      "/app/.next/server/chunks/ssr/[root-of-the-server]__0zyne2a._.js:1:6480",
      `→ 1 module.exports=[82408,a=>{${sourceLine}}]`,
      actualError,
    ].join("\n"),
  );
}

/** Mock DB that rejects during transaction with specified error. */
function failingDb(error: Error) {
  return new Proxy(testDb, {
    get(target, prop) {
      if (prop === "$transaction") {
        return () => Promise.reject(error);
      }

      const val = Reflect.get(target, prop);
      return typeof val === "function" ? val.bind(target) : val;
    },
  }) as unknown as typeof testDb;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("approval reasons catalog", () => {
  const SOURCE = 'let d=(a)=>a.includes("Unique constraint")||a.includes("23505")?f("duplicate_label"):f("unknown")';

  it("does not treat strings inside bundled source as duplicate labels", async () => {
    const error = buildProductionError(
      SOURCE,
      // Actual error is connection lost, not uniqueness violation
      "Server has closed the connection.",
    );

    const result = await createReason(
      failingDb(error),
      { kind: "REJECTED", label: "New reason", sortOrder: 10 },
      "actor",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("unknown");
  });

  it("translates genuine uniqueness violation to duplicate label", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const admin = await createUser(root.id, { isSystemAdmin: true });

    await createReason(
      testDb,
      { kind: "REJECTED", label: "Same label", sortOrder: 10 },
      admin.id,
    );

    const second = await createReason(
      testDb,
      { kind: "REJECTED", label: "Same label", sortOrder: 20 },
      admin.id,
    );

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("duplicate_label");
  });
});

describe("absence overlap", () => {
  const SOURCE = 'let d=(a)=>a.includes("NoActivityPeriod_no_overlap")?f("overlaps"):g(a)';

  async function setupTeam() {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({ name: "Workshop", parentId: root.id });
    const manager = await createUser(unit.id, {
      fullName: "Manager",
      isUnitManager: true,
    });
    const worker = await createUser(unit.id, { fullName: "Worker" });
    return { manager, worker };
  }

  it("does not treat strings inside bundled source as overlap", async () => {
    const { manager, worker } = await setupTeam();
    const error = buildProductionError(SOURCE, "Server has closed the connection.");

    await expect(
      markNoActivityPeriod(
        failingDb(error),
        manager.id,
        {
          userId: worker.id,
          startDate: "2026-08-03",
          endDate: "2026-08-05",
          note: "Leave",
        },
        new Date("2026-08-01T09:00:00.000Z"),
      ),
    ).rejects.toThrow(/closed the connection/);
  });

  it("translates genuine exclusion constraint to overlap", async () => {
    const { manager, worker } = await setupTeam();
    const period = {
      userId: worker.id,
      startDate: "2026-08-03",
      endDate: "2026-08-05",
      note: "Leave",
    };

    const first = await markNoActivityPeriod(
      testDb,
      manager.id,
      period,
      new Date("2026-08-01T09:00:00.000Z"),
    );
    expect(first.ok).toBe(true);

    const second = await markNoActivityPeriod(
      testDb,
      manager.id,
      period,
      new Date("2026-08-01T10:00:00.000Z"),
    );

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("overlaps");
  });
});

describe("exclusion constraint detection", () => {
  it("looks for error code and constraint name together", () => {
    const genuine = new Error(
      'ConnectorError(ConnectorError { kind: QueryError(PostgresError { code: "23P01", ' +
        'message: "conflicting key value violates exclusion constraint ' +
        '\\"NoActivityPeriod_no_overlap\\"" }) })',
    );

    expect(isExclusionViolation(genuine, "NoActivityPeriod_no_overlap")).toBe(true);
    expect(isExclusionViolation(genuine, "Other_constraint")).toBe(false);
  });

  it("bare name in bundled source is not enough", () => {
    const bundled = new Error(
      'module.exports=[1,a=>a.includes("NoActivityPeriod_no_overlap")?f("overlaps"):0]\n' +
        "Server has closed the connection.",
    );

    expect(isExclusionViolation(bundled, "NoActivityPeriod_no_overlap")).toBe(false);
  });

  it("uniqueness violation is not treated as exclusion violation", () => {
    const uniqueness = new Error(
      'PostgresError { code: "23505", message: "duplicate key value" }',
    );

    expect(isExclusionViolation(uniqueness, "NoActivityPeriod_no_overlap")).toBe(false);
    expect(isUniqueViolation(uniqueness)).toBe(false);
  });
});
