import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertTestDatabaseUrl,
  canonicalTarget,
  maskUrl,
} from "./assert-test-database";



// (audit 2026-08-17, finding 3).

const TEST_URL = "postgresql://u:p@localhost:5433/faaliyet_test";
const APP_URL = "postgresql://u:p@localhost:5442/faaliyet";

const options = { variableName: "TEST_DATABASE_URL", applicationUrl: APP_URL };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("test database URL validation", () => {
  it("accepts an allowed test database", () => {
    expect(assertTestDatabaseUrl(TEST_URL, options)).toBe(TEST_URL);
  });

  it("accepts the end-to-end database", () => {
    const e2eUrl = "postgresql://u:p@localhost:5433/faaliyet_e2e";
    expect(assertTestDatabaseUrl(e2eUrl, options)).toBe(e2eUrl);
  });

  it("rejects a missing URL", () => {
    expect(() => assertTestDatabaseUrl(undefined, options)).toThrow(
      /is not set/,
    );
  });

  it("rejects the application database", () => {
    expect(() => assertTestDatabaseUrl(APP_URL, options)).toThrow(
      /same database as DATABASE_URL/,
    );
  });

  it("rejects a database whose name is not allowed", () => {

    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@localhost:5433/latest", options),
    ).toThrow(/does not point to an allowed test database/);
  });

  it("rejects the production database name", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@localhost:5433/faaliyet", options),
    ).toThrow(/does not point to an allowed test database/);
  });

  it("rejects a remote host", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://u:p@db.sirket.local:5432/faaliyet_test",
        options,
      ),
    ).toThrow(/points to a non-local host/);
  });

  it("never runs in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => assertTestDatabaseUrl(TEST_URL, options)).toThrow(
      /cannot run in production/,
    );
  });

  it("does not expose a password in error messages", () => {
    const withPassword = "postgresql://faaliyet:secret-password@localhost:5442/faaliyet";

    expect(maskUrl(withPassword)).not.toContain("secret-password");
    expect(maskUrl(withPassword)).toContain("***");

    try {
      assertTestDatabaseUrl(withPassword, {
        variableName: "TEST_DATABASE_URL",
        applicationUrl: withPassword,
      });
      throw new Error("an error was expected");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-password");
    }
  });
});



describe("canonical database targets", () => {
  it("treats localhost and 127.0.0.1 as the same target", () => {
    expect(canonicalTarget("postgresql://u:p@localhost:5442/faaliyet")).toBe(
      canonicalTarget("postgresql://baska:parola@127.0.0.1:5442/faaliyet"),
    );
  });

  it("treats the implicit default port as the explicit port", () => {
    expect(canonicalTarget("postgresql://u:p@127.0.0.1/faaliyet")).toBe(
      canonicalTarget("postgresql://u:p@127.0.0.1:5432/faaliyet"),
    );
  });

  it("rejects the application database despite a different spelling", () => {

    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@localhost:5442/faaliyet", {
        variableName: "TEST_DATABASE_URL",
        applicationUrl: "postgresql://faaliyet:parola@127.0.0.1:5442/faaliyet",
      }),
    ).toThrow(/same database as DATABASE_URL|allowed test database/);
  });

  it("treats different database names as different targets", () => {
    expect(canonicalTarget("postgresql://u:p@127.0.0.1:5433/faaliyet_test")).not.toBe(
      canonicalTarget("postgresql://u:p@127.0.0.1:5433/faaliyet_e2e"),
    );
  });
});
