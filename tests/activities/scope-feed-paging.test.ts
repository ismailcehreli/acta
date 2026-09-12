import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  listScopeActivities,
  type FeedCursor,
} from "@/server/activities/scope-feed";
import { decodeCursor, encodeCursor } from "@/server/activities/feed-cursor";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Audit (2026-08-18, PHASE 4 finding 11): "All" feed was silently truncated
// with `take: 100`; records beyond 101 were unreachable by any path.
// For a view named "All" to hide most records without indicating truncation
// was worse than having no feed.

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function companyWith(activityCount: number) {
  const root = await createOrgUnit({ name: "Headquarters", type: "Root" });
  const unit = await createOrgUnit({ name: "Tooling Workshop", parentId: root.id });
  const director = await createUser(root.id, {
    fullName: "Director",
    isUnitManager: true,
  });
  const author = await createUser(unit.id, {
    fullName: "Manager",
    isUnitManager: true,
  });

  // Activities falling on the same day are intentionally generated: without
  // secondary and tertiary sort fields (createdAt, id), cursor would skip rows at page boundaries.
  await testDb.activity.createMany({
    data: Array.from({ length: activityCount }, (_, i) => ({
      authorId: author.id,
      authorOrgUnitId: unit.id,
      activityDate: new Date(
        Date.UTC(2026, 7, 17 - Math.floor(i / 10)),
      ),
      title: `Activity ${i + 1}`,
      description: "Description",
      approvalStatus: "APPROVED" as const,
      createdAt: new Date(NOW.getTime() - i * 1_000),
      updatedAt: NOW,
    })),
  });

  return { director, author };
}

async function allPages(viewerId: string, limit: number) {
  const ids: string[] = [];
  let cursor: FeedCursor | null = null;
  let pageCount = 0;

  do {
    const page = await listScopeActivities(
      testDb,
      { id: viewerId, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit, cursor },
    );
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    pageCount += 1;
    if (pageCount > 100) throw new Error("pagination does not terminate");
  } while (cursor);

  return { ids, pageCount };
}

describe("scope feed pagination", () => {
  it("leaves no record inaccessible across 101 activities", async () => {
    const { director } = await companyWith(101);

    const { ids } = await allPages(director.id, 25);

    expect(ids).toHaveLength(101);
    // No duplicate records: cursor does not return same row twice.
    expect(new Set(ids).size).toBe(101);
  });

  it("produces identical order regardless of page size", async () => {
    const { director } = await companyWith(60);

    const singlePage = await allPages(director.id, 200);
    const smallPage = await allPages(director.id, 7);

    expect(singlePage.pageCount).toBe(1);
    expect(smallPage.ids).toEqual(singlePage.ids);
  });

  it("returns null cursor when list is exhausted", async () => {
    const { director } = await companyWith(5);

    const page = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit: 10 },
    );

    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  it("falls back to head of list on corrupt cursor without throwing error", async () => {
    const { director } = await companyWith(3);

    for (const corrupted of ["", "abc", Buffer.from("{}").toString("base64url")]) {
      expect(decodeCursor(corrupted)).toBeNull();
    }

    const page = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit: 10, cursor: decodeCursor("abc") },
    );
    expect(page.items).toHaveLength(3);
  });

  it("cursor can be serialized into query string and restored", async () => {
    const { director } = await companyWith(30);

    const firstPage = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit: 10 },
    );
    expect(firstPage.nextCursor).not.toBeNull();

    const decoded = decodeCursor(encodeCursor(firstPage.nextCursor!));
    expect(decoded).toEqual(firstPage.nextCursor);

    const secondPage = await listScopeActivities(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { period: "all" },
      NOW,
      { limit: 10, cursor: decoded },
    );

    const firstIds = firstPage.items.map((i) => i.id);
    expect(secondPage.items.some((item) => firstIds.includes(item.id))).toBe(false);
  });
});
