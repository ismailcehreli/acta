import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  archiveHelpArticle,
  createHelpArticle,
  listHelpArticles,
  updateHelpArticle,
} from "@/server/help/articles";
import { canManageHelp } from "@/server/authz/help";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-28T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupUsers() {
  const unit = await createOrgUnit({ name: "Company", type: "Root" });
  const systemAdmin = await createUser(unit.id, {
    fullName: "System Administrator",
    isSystemAdmin: true,
  });
  const unitManager = await createUser(unit.id, {
    fullName: "Unit Manager",
    isUnitManager: true,
  });
  const employee = await createUser(unit.id, { fullName: "Employee" });

  return { systemAdmin, unitManager, employee };
}

const sampleArticle = {
  category: "Getting Started",
  title: "How do I log in?",
  answer: "Enter your email address and password, then click Log In.",
  sortOrder: 1,
  isPublished: true,
};

describe("help library", () => {
  it("manager can add, edit, and archive articles", async () => {
    const { unitManager } = await setupUsers();

    const created = await createHelpArticle(testDb, unitManager.id, sampleArticle, NOW);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await updateHelpArticle(
      testDb,
      unitManager.id,
      created.article.id,
      { ...sampleArticle, title: "How do I set my password?", isPublished: false },
      NOW,
    );
    expect(updated.ok).toBe(true);

    expect(await listHelpArticles(testDb)).toEqual([]);
    expect(await listHelpArticles(testDb, { includeUnpublished: true })).toHaveLength(1);

    expect(
      await archiveHelpArticle(testDb, unitManager.id, created.article.id, NOW),
    ).toEqual({ ok: true });
    expect(await listHelpArticles(testDb, { includeUnpublished: true })).toEqual([]);
  });

  it("content must be plain text and reject HTML", async () => {
    const { systemAdmin } = await setupUsers();

    const result = await createHelpArticle(
      testDb,
      systemAdmin.id,
      { ...sampleArticle, answer: "<script>alert('x')</script>" },
      NOW,
    );

    expect(result).toEqual({
      ok: false,
      error: "invalid_text",
      message: "Category, title, and description must be within their limits; HTML is not allowed.",
    });
  });

  it("unpublished article only appears in manager listing", async () => {
    const { systemAdmin } = await setupUsers();
    await createHelpArticle(testDb, systemAdmin.id, { ...sampleArticle, isPublished: false }, NOW);

    expect(await listHelpArticles(testDb)).toHaveLength(0);
    expect(await listHelpArticles(testDb, { includeUnpublished: true })).toHaveLength(1);
  });

  it("system admin and unit manager can manage help articles", async () => {
    const { systemAdmin, unitManager, employee } = await setupUsers();

    expect(canManageHelp(systemAdmin)).toBe(true);
    expect(canManageHelp(unitManager)).toBe(true);
    expect(canManageHelp(employee)).toBe(false);
  });
});
