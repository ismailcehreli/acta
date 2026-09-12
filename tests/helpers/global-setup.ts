import { execFileSync } from "node:child_process";

import { assertTestDatabaseUrl } from "./assert-test-database";
import { prepareTestDatabase } from "./prepare-test-database";
import { assertSentinelPresent, isRequiredSchemaPresent } from "./test-db";




//



// creates it (docker/postgres-init/02-test-sentinel.sh).

export default async function setup(): Promise<void> {
  await prepareTestDatabase({
    resolveUrl: () =>
      assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        variableName: "TEST_DATABASE_URL",
        applicationUrl: process.env.DATABASE_URL,
      }),
    assertSentinel: assertSentinelPresent,
    runMigrations: (url) => {
      execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: "inherit",
      });
    },
    isSchemaReady: isRequiredSchemaPresent,
    resetDatabase: (url) => {
      execFileSync("pnpm", ["exec", "prisma", "migrate", "reset", "--force"], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: "inherit",
      });
    },
  });
}
