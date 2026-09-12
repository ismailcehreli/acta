import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

// READ PATH INVENTORY
//
// "Every read path (list, detail, search, attachment download) passes through the visibility module."
// Every file reading activities must either use the visibility module or be listed below
// with a documented rationale.

const SRC_ROOT = path.join(process.cwd(), "src");

/** Prisma queries reading the Activity table. */
const READ_PATTERN =
  /\bactivity\.(findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|groupBy|aggregate)\b/;

/** Markers indicating visibility module usage. */
const SCOPE_PATTERN =
  /(visibleActivityWhere|visibleActivitySql|canViewActivity|canCancelActivity|approvalQueueWhere|gorunurFaaliyetler|gorunurlugeGoreAyir|getVisibleActivityIds|partitionRowsByVisibility|visibleReportScope)/;

const MODEL_READ_PATTERN =
  /\b(activity|attachment)\.(findMany|findFirst|findUnique|count|groupBy|aggregate)\b/;
const RAW_ACTIVITY_SQL_PATTERN =
  /\b(?:FROM|JOIN)\s+["`]Activity["`]/i;

/**
 * Files not using the visibility module with justified rationale.
 */
const JUSTIFIED_EXCEPTIONS: Record<string, string> = {
  "server/authz/visibility.ts": "Defines the visibility scope itself.",
  "server/activities/write.ts":
    "Write path: author creates their own activity, not an external read.",
  "server/activities/approval.ts":
    "Approval queue passes through approvalQueueWhere; remaining queries lock row at decision time.",
  "server/attachments/service.ts":
    "Upload path scoped to author; download verified via canViewActivity.",
  "server/demo/data.ts": "Sample data seeding; not user-facing read.",
  "server/demo/purge.ts":
    "Sample data purge; queries ownership rather than visibility scope.",
  "server/notifications/visible-rows.ts":
    "Notification filter itself; consumes scope here.",
  "worker/reminders/no-activity.ts":
    "Background worker checking if user logged activity today.",
  "worker/reminders/overdue-approvals.ts":
    "Background worker reminding approver of pending activities.",
  "app/page.tsx":
    "Counts authorId: user.id — user always sees their own records. All detailed lists come from scoped services.",
  "server/dashboard/work-queue.ts":
    "authorId: viewer.id for changes requested; approval part passes through approvalQueueWhere.",
  "server/dashboard/summary.ts":
    "Participation counter: counts whether someone logged today. Scoped by subordinates list.",
  "server/activities/delete.ts":
    "Root admin activity deletion path. System admin has no visibility scope; metadata only projection.",
};

async function getTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await getTsFiles(fullPath)));
      continue;
    }

    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      results.push(fullPath);
    }
  }

  return results;
}

describe("all activity read paths pass through visibility scope", () => {
  it("no un-scoped activity read paths exist without justification", async () => {
    const files = await getTsFiles(SRC_ROOT);
    const unscoped: string[] = [];

    for (const file of files) {
      const content = await readFile(file, "utf8");
      if (!READ_PATTERN.test(content)) continue;
      if (SCOPE_PATTERN.test(content)) continue;

      const relative = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      if (relative in JUSTIFIED_EXCEPTIONS) continue;

      unscoped.push(relative);
    }

    if (unscoped.length > 0) {
      console.log(
        "Activity reads not using visibility module:\n  " +
          unscoped.join("\n  ") +
          "\n\nApply visibility scope or add to JUSTIFIED_EXCEPTIONS with justification.",
      );
    }

    expect(unscoped).toEqual([]);
  });

  it("activity and attachment model reads respect repository boundaries", async () => {
    const files = await getTsFiles(SRC_ROOT);
    const repoCore = new Set([
      "server/authz/visibility.ts",
      "server/authz/activity-repository.ts",
      "server/search/activities.ts",
      "server/reports/read.ts",
    ]);
    const outOfBounds: string[] = [];

    for (const file of files) {
      const content = await readFile(file, "utf8");
      const relative = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      if (repoCore.has(relative)) continue;

      if (MODEL_READ_PATTERN.test(content)) outOfBounds.push(`${relative}:model`);
      if (RAW_ACTIVITY_SQL_PATTERN.test(content)) outOfBounds.push(`${relative}:sql`);
    }

    expect(outOfBounds).toEqual([]);
  });

  it("justified exceptions list contains no dead paths", async () => {
    const files = await getTsFiles(SRC_ROOT);
    const relativePaths = new Set(
      files.map((file) => path.relative(SRC_ROOT, file).split(path.sep).join("/")),
    );

    const dead = Object.keys(JUSTIFIED_EXCEPTIONS).filter(
      (relPath) => !relativePaths.has(relPath),
    );

    expect(dead).toEqual([]);
  });
});
