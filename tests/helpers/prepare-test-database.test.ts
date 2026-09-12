import { describe, expect, it } from "vitest";

import { prepareTestDatabase } from "./prepare-test-database";






function createObserver() {
  const order: string[] = [];
  let schemaReady = true;
  return {
    order,
    resolveUrl: () => {
      order.push("url");
      return "postgresql://test/faaliyet_test";
    },
    assertSentinel: async () => {
      order.push("sentinel");
    },
    runMigrations: () => {
      order.push("migration");
    },
    isSchemaReady: async () => {
      order.push("schema");
      return schemaReady;
    },
    resetDatabase: () => {
      order.push("reset");
      schemaReady = true;
    },
  };
}

describe("test database preparation", () => {
  it("runs URL, sentinel, and migration in order", async () => {
    const steps = createObserver();

    await prepareTestDatabase(steps);

    expect(steps.order).toEqual(["url", "sentinel", "migration", "schema"]);
  });

  it("does not run migrations when the sentinel is missing", async () => {
    const steps = createObserver();

    await expect(
      prepareTestDatabase({
        ...steps,
        assertSentinel: async () => {
          steps.order.push("sentinel");
          throw new Error("The target database is missing the test sentinel.");
        },
      }),
    ).rejects.toThrow(/missing the test sentinel/);

    expect(steps.order).toEqual(["url", "sentinel"]);
    expect(steps.order).not.toContain("migration");
  });

  it("does not look for a sentinel when the URL is rejected", async () => {
    const steps = createObserver();

    await expect(
      prepareTestDatabase({
        ...steps,
        resolveUrl: () => {
          steps.order.push("url");
          throw new Error("The test database URL is invalid.");
        },
      }),
    ).rejects.toThrow(/URL is invalid/);

    expect(steps.order).toEqual(["url"]);
  });

  it("resets only the verified test target when the schema is missing after migration", async () => {
    const steps = createObserver();
    let initialCheck = true;

    await prepareTestDatabase({
      ...steps,
      isSchemaReady: async () => {
        steps.order.push("schema");
        if (initialCheck) {
          initialCheck = false;
          return false;
        }
        return true;
      },
    });

    expect(steps.order).toEqual([
      "url", "sentinel", "migration", "schema", "reset", "schema",
    ]);
  });

  it("reports a clear error before starting the app when the schema is still missing after reset", async () => {
    const steps = createObserver();

    await expect(
      prepareTestDatabase({
        ...steps,
        isSchemaReady: async () => {
          steps.order.push("schema");
          return false;
        },
      }),
    ).rejects.toThrow(/Required tables are still missing/);

    expect(steps.order).toEqual([
      "url", "sentinel", "migration", "schema", "reset", "schema",
    ]);
  });
});
