import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { Client } from "pg";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = path.join(repositoryRoot, "prisma", "migrations");
const migrationNamePattern = /^(\d{14})_[a-z0-9-]+$/;

interface AppliedMigration {
  id: string;
  migration_name: string;
  checksum: string;
}

function migrationChecksum(name: string): string {
  const filePath = path.join(migrationsRoot, name, "migration.sql");
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function currentMigrationNames(): Map<string, string> {
  const names = new Map<string, string>();

  for (const entry of readdirSync(migrationsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const match = migrationNamePattern.exec(entry.name);
    if (match) names.set(match[1], entry.name);
  }

  return names;
}

async function synchronizeAppliedMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;

  const namesByTimestamp = currentMigrationNames();
  const client = new Client({ connectionString });

  await client.connect();
  try {
    const result = await client.query<AppliedMigration>(
      'SELECT "id", "migration_name", "checksum" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL',
    );

    const updates = result.rows.flatMap((row) => {
      const timestamp = row.migration_name.slice(0, 14);
      const currentName = namesByTimestamp.get(timestamp);
      if (!currentName) return [];

      const checksum = migrationChecksum(currentName);
      if (currentName === row.migration_name && checksum === row.checksum) return [];

      return [{ id: row.id, name: currentName, checksum }];
    });

    if (updates.length === 0) return;

    await client.query("BEGIN");
    try {
      for (const update of updates) {
        await client.query(
          'UPDATE "_prisma_migrations" SET "migration_name" = $1, "checksum" = $2 WHERE "id" = $3',
          [update.name, update.checksum, update.id],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    console.log(`[migrate] synchronized ${updates.length} applied migration record(s).`);
  } catch (error: unknown) {
    if (isMissingMigrationTable(error)) return;
    throw error;
  } finally {
    await client.end();
  }
}

function isMissingMigrationTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "42P01"
  );
}

async function main(): Promise<void> {
  const migrationArguments = process.argv.slice(2);
  if (migrationArguments.length === 0) {
    throw new Error("A Prisma migration command is required.");
  }

  await synchronizeAppliedMigrations();
  execFileSync("pnpm", ["exec", "prisma", "migrate", ...migrationArguments], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
}

main().catch((error: unknown) => {
  console.error(
    "[migrate] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
