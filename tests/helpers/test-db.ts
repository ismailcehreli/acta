import { PrismaClient } from "@prisma/client";

import { assertTestDatabaseUrl } from "./assert-test-database";





export const testDatabaseUrl = assertTestDatabaseUrl(
  process.env.TEST_DATABASE_URL,
  {
    variableName: "TEST_DATABASE_URL",
    applicationUrl: process.env.DATABASE_URL,
  },
);

export const testDb = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },


  log: [],
});


export const SENTINEL_COMMENT = "acta-test-database";


async function readSentinel(
  client: Pick<PrismaClient, "$queryRaw">,
): Promise<string | null> {
  const rows = await client.$queryRaw<{ note: string | null }[]>`
    SELECT shobj_description(oid, 'pg_database') AS note
    FROM pg_database
    WHERE datname = current_database()
  `;

  return rows[0]?.note ?? null;
}

export async function assertSentinelPresent(url: string): Promise<void> {
  const client = new PrismaClient({ datasources: { db: { url } } });

  try {
    if ((await readSentinel(client)) !== SENTINEL_COMMENT) {
      throw new Error(
        `The target database is missing the test sentinel ("${SENTINEL_COMMENT}"). ` +
          "The database setup (docker/postgres-init) creates it; this is not a " +
          "test database.",
      );
    }
  } finally {
    await client.$disconnect();
  }
}


export async function isRequiredSchemaPresent(url: string): Promise<boolean> {
  const client = new PrismaClient({ datasources: { db: { url } } });

  try {
    const rows = await client.$queryRaw<
      { userTable: string | null; settingsTable: string | null }[]
    >`
      SELECT
        to_regclass('public."User"')::text AS "userTable",
        to_regclass('public."SystemSetting"')::text AS "settingsTable"
    `;
    return rows[0]?.userTable !== null && rows[0]?.settingsTable !== null;
  } finally {
    await client.$disconnect();
  }
}

async function assertSentinel(): Promise<void> {
  if ((await readSentinel(testDb)) !== SENTINEL_COMMENT) {
    throw new Error(
      "The target database is missing the test sentinel; an uninitialized " +
        "database cannot be emptied.",
    );
  }
}


export async function resetDatabase(): Promise<void> {
  await assertSentinel();

  const tables = await testDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) {
    throw new Error(
      "The test database has no tables; migrations may not have been applied.",
    );
  }

  const quoted = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await testDb.$executeRawUnsafe(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
  );
}
