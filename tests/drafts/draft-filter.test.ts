import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { countDrafts, listDrafts } from "@/server/activities/drafts";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Draft list filtering and pagination.
//
// Two types of drafts reside in the same list and must be distinguishable
// (`ActivityDraft.savedManually`): intentionally paused draft vs. draft left behind
// because window was accidentally closed.
//
// The list strictly belongs to the author; filters cannot bypass this boundary.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupUsers() {
  const unit = await createOrgUnit({ name: "Mold Shop", type: "Root" });
  const currentUser = await createUser(unit.id, { fullName: "Current User" });
  const otherUser = await createUser(unit.id, { fullName: "Other User" });
  return { currentUser, otherUser };
}

async function createDraft(
  authorId: string,
  title: string,
  savedManually: boolean,
) {
  return testDb.activityDraft.create({
    data: {
      authorId,
      title,
      description: `Description for ${title}`,
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
      targetOrgUnitIds: [],
      savedManually,
    },
  });
}

describe("save type filter", () => {
  it("retrieves only manually saved drafts", async () => {
    const { currentUser } = await setupUsers();
    await createDraft(currentUser.id, "Saved intentionally", true);
    await createDraft(currentUser.id, "Saved accidentally", false);

    const result = await listDrafts(testDb, currentUser.id, { savedManually: true });

    expect(result.map((d) => d.title)).toEqual(["Saved intentionally"]);
  });

  it("retrieves only auto-saved drafts", async () => {
    const { currentUser } = await setupUsers();
    await createDraft(currentUser.id, "Saved intentionally", true);
    await createDraft(currentUser.id, "Saved accidentally", false);

    const result = await listDrafts(testDb, currentUser.id, { savedManually: false });

    expect(result.map((d) => d.title)).toEqual(["Saved accidentally"]);
  });

  it("retrieves both when no filter is applied", async () => {
    const { currentUser } = await setupUsers();
    await createDraft(currentUser.id, "Saved intentionally", true);
    await createDraft(currentUser.id, "Saved accidentally", false);

    expect(await listDrafts(testDb, currentUser.id, {})).toHaveLength(2);
  });
});

describe("pagination", () => {
  it("returns requested number of records and skips properly", async () => {
    const { currentUser } = await setupUsers();
    for (const title of ["One", "Two", "Three"]) await createDraft(currentUser.id, title, true);

    const first = await listDrafts(testDb, currentUser.id, {}, { limit: 2 });
    const second = await listDrafts(testDb, currentUser.id, {}, { limit: 2, skip: 2 });

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
  });
});

describe("counter and list use matching filters", () => {
  it("counter applies same filtering narrowing", async () => {
    const { currentUser } = await setupUsers();
    await createDraft(currentUser.id, "Manual", true);
    await createDraft(currentUser.id, "Auto", false);

    expect(await countDrafts(testDb, currentUser.id, { savedManually: true })).toBe(1);
    expect(await countDrafts(testDb, currentUser.id)).toBe(2);
  });
});

describe("list is isolated per user", () => {
  it("no filter can return another user's draft", async () => {
    const { currentUser, otherUser } = await setupUsers();
    await createDraft(otherUser.id, "Other draft", true);
    await createDraft(currentUser.id, "My draft", true);

    const result = await listDrafts(testDb, currentUser.id, { savedManually: true });

    expect(result.map((d) => d.title)).toEqual(["My draft"]);
  });
});
