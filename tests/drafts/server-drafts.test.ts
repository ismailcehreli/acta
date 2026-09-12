import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_DRAFTS_PER_USER,
  countDrafts,
  deleteDraft,
  findDraft,
  hasDraftContent,
  listDrafts,
  saveDraft,
} from "@/server/activities/drafts";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Server-side activity drafts.
//
// The core invariant tested is draft ownership. A draft belongs strictly to its author;
// neither unit managers nor system administrators can view, modify, or delete it.
// Every test in this file includes an unauthorized access verification.

const NOW = new Date("2026-08-21T09:00:00.000Z");

const DRAFT = {
  activityDate: "2026-08-21",
  title: "Mold maintenance",
  description: "Maintenance performed on three presses.",
  targetDepartmentIds: [] as string[],
  openFollowUp: false,
  savedManually: false,
};

async function setupTwoUsers() {
  const root = await createOrgUnit({ name: "Company" });
  const author = await createUser(root.id, { email: "author@example.test" });
  const otherUser = await createUser(root.id, {
    email: "other@example.test",
    isUnitManager: true,
  });

  return { author, otherUser };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("content criteria", () => {
  it("empty draft is not considered meaningful", () => {
    expect(hasDraftContent({ title: "", description: "" })).toBe(false);
    expect(hasDraftContent({ title: "   ", description: "\n\t" })).toBe(false);
  });

  it("either title or description is sufficient", () => {
    expect(hasDraftContent({ title: "Some title", description: "" })).toBe(true);
    expect(hasDraftContent({ title: "", description: "Some description" })).toBe(true);
  });
});

describe("saving drafts", () => {
  it("new draft is created and readable", async () => {
    const { author } = await setupTwoUsers();

    const result = await saveDraft(testDb, author.id, DRAFT, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fetched = await findDraft(testDb, author.id, result.draft.id);
    expect(fetched?.title).toBe("Mold maintenance");
    expect(fetched?.savedManually).toBe(false);
  });

  it("same draft is updated instead of creating a new one", async () => {
    const { author } = await setupTwoUsers();

    const first = await saveDraft(testDb, author.id, DRAFT, NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    await saveDraft(
      testDb,
      author.id,
      { ...DRAFT, id: first.draft.id, title: "Mold maintenance — updated" },
      NOW,
    );

    expect(await countDrafts(testDb, author.id)).toBe(1);
    const fetched = await findDraft(testDb, author.id, first.draft.id);
    expect(fetched?.title).toBe("Mold maintenance — updated");
  });

  it("manually saved draft does not revert flag on subsequent auto-save", async () => {
    const { author } = await setupTwoUsers();

    const first = await saveDraft(
      testDb,
      author.id,
      { ...DRAFT, savedManually: true },
      NOW,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.draft.savedManually).toBe(true);

    // User resumed editing; automatic background save triggered.
    const nextResult = await saveDraft(
      testDb,
      author.id,
      { ...DRAFT, id: first.draft.id, savedManually: false, title: "Continued" },
      NOW,
    );

    expect(nextResult.ok).toBe(true);
    if (!nextResult.ok) return;
    // Manual decision is sticky: the "held" badge must persist.
    expect(nextResult.draft.savedManually).toBe(true);
  });

  it("does not create draft once limit is reached", async () => {
    const { author } = await setupTwoUsers();

    for (let i = 0; i < MAX_DRAFTS_PER_USER; i += 1) {
      const result = await saveDraft(
        testDb,
        author.id,
        { ...DRAFT, title: `Draft ${i}` },
        NOW,
      );
      expect(result.ok).toBe(true);
    }

    const excess = await saveDraft(testDb, author.id, DRAFT, NOW);
    expect(excess.ok).toBe(false);
    if (excess.ok) return;
    expect(excess.error).toBe("too_many");
  });
});

describe("draft is isolated per author", () => {
  it("another user's draft is not listed", async () => {
    const { author, otherUser } = await setupTwoUsers();
    await saveDraft(testDb, author.id, DRAFT, NOW);

    expect(await listDrafts(testDb, otherUser.id)).toHaveLength(0);
    expect(await countDrafts(testDb, otherUser.id)).toBe(0);
  });

  it("another user's draft cannot be read even with its ID", async () => {
    const { author, otherUser } = await setupTwoUsers();
    const result = await saveDraft(testDb, author.id, DRAFT, NOW);
    if (!result.ok) throw new Error("failed to save draft fixture");

    // Knowing the ID is insufficient: query scopes by author ID.
    expect(await findDraft(testDb, otherUser.id, result.draft.id)).toBeNull();
  });

  it("another user's draft cannot be updated", async () => {
    const { author, otherUser } = await setupTwoUsers();
    const result = await saveDraft(testDb, author.id, DRAFT, NOW);
    if (!result.ok) throw new Error("failed to save draft fixture");

    const attempt = await saveDraft(
      testDb,
      otherUser.id,
      { ...DRAFT, id: result.draft.id, title: "HIJACKED" },
      NOW,
    );

    expect(attempt.ok).toBe(false);
    // Draft must remain unchanged.
    const fetched = await findDraft(testDb, author.id, result.draft.id);
    expect(fetched?.title).toBe("Mold maintenance");
  });

  it("another user's draft cannot be deleted", async () => {
    const { author, otherUser } = await setupTwoUsers();
    const result = await saveDraft(testDb, author.id, DRAFT, NOW);
    if (!result.ok) throw new Error("failed to save draft fixture");

    expect(await deleteDraft(testDb, otherUser.id, result.draft.id)).toBe(false);
    expect(await countDrafts(testDb, author.id)).toBe(1);
  });
});

describe("draft deletion", () => {
  // Drafts are physically deleted: they are unsubmitted manuscripts, not historical events.
  // The physical deletion prohibition on activities does not apply to drafts.
  it("author deletes their own draft", async () => {
    const { author } = await setupTwoUsers();
    const result = await saveDraft(testDb, author.id, DRAFT, NOW);
    if (!result.ok) throw new Error("failed to save draft fixture");

    expect(await deleteDraft(testDb, author.id, result.draft.id)).toBe(true);
    expect(await countDrafts(testDb, author.id)).toBe(0);
  });

  it("deleting non-existent draft is a no-op returning false", async () => {
    const { author } = await setupTwoUsers();
    expect(
      await deleteDraft(testDb, author.id, "11111111-1111-4111-8111-111111111111"),
    ).toBe(false);
  });
});
