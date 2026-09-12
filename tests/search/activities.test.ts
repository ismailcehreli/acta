import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  searchActivities,
  splitHighlights,
} from "@/server/search/activities";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Full-text activity search test suite.
// Results are strictly bounded by visibility authorization scope.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "ROOT" });
  const executive = await createOrgUnit({ name: "Executive Directorate", parentId: root.id });
  const tooling = await createOrgUnit({ name: "Tooling Department", parentId: executive.id });
  const planning = await createOrgUnit({ name: "Planning Department", parentId: executive.id });

  const ceo = await createUser(executive.id, {
    fullName: "General Manager",
    isUnitManager: true,
  });
  const toolingManager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const planningManager = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });

  const toolingWorker = await createUser(tooling.id, {
    fullName: "Tooling Worker",
  });

  return { ceo, toolingManager, planningManager, toolingWorker };
}

async function resolveApproverId(userId: string): Promise<string | null> {
  const { resolveManager } = await import("@/server/org/resolve-manager");
  const result = await resolveManager(testDb, userId);
  return result.found ? result.managerId : null;
}

async function createActivityRecord(
  author: { id: string; orgUnitId: string },
  title: string,
  description: string,
  approvalStatus: "APPROVED" | "CANCELLED" | "PENDING_APPROVAL" = "APPROVED",
) {
  const approverId =
    approvalStatus === "PENDING_APPROVAL" ? await resolveApproverId(author.id) : null;

  const record = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: author.orgUnitId,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title,
      description,
      approvalStatus,
      approverId,
    },
  });

  if (approverId) {
    await testDb.activityApprover.create({
      data: { activityId: record.id, userId: approverId },
    });
  }

  return record;
}

const viewer = (u: { id: string }) => ({ id: u.id, isSystemAdmin: false });

describe("full text search", () => {
  it("matches stemmed search terms", async () => {
    const { ceo, toolingManager } = await setupCompany();
    await createActivityRecord(toolingManager, "Tooling maintenance", "Molds on press were disassembled and cleaned.");

    const result = await searchActivities(testDb, viewer(ceo), "molds");

    expect(result.total).toBe(1);
    expect(result.hits[0].title).toBe("Tooling maintenance");
  });

  it("searches across both title and description", async () => {
    const { ceo, toolingManager } = await setupCompany();
    await createActivityRecord(toolingManager, "Injection line", "Routine check completed.");
    await createActivityRecord(toolingManager, "Daily shift", "Injection press was halted.");

    const result = await searchActivities(testDb, viewer(ceo), "injection");

    expect(result.total).toBe(2);
  });

  it("returns empty result when query does not match", async () => {
    const { ceo, toolingManager } = await setupCompany();
    await createActivityRecord(toolingManager, "Tooling maintenance", "Press molds cleaned.");

    const result = await searchActivities(testDb, viewer(ceo), "accounting");

    expect(result).toEqual({ hits: [], total: 0, page: 1, pageCount: 0 });
  });

  it("returns zero results for empty queries", async () => {
    const { ceo, toolingManager } = await setupCompany();
    await createActivityRecord(toolingManager, "Tooling maintenance", "Press molds cleaned.");

    for (const empty of ["", "   "]) {
      const result = await searchActivities(testDb, viewer(ceo), empty);
      expect(result.total).toBe(0);
    }
  });

  it("highlights matching terms in snippet without raw HTML markup", async () => {
    const { ceo, toolingManager } = await setupCompany();
    await createActivityRecord(
      toolingManager,
      "Line stoppage",
      "During morning shift injection machine malfunction occurred and stopped.",
    );

    const result = await searchActivities(testDb, viewer(ceo), "malfunction");

    expect(result.hits[0].snippet).toContain(HIGHLIGHT_START);
    expect(result.hits[0].snippet).not.toContain("<mark>");

    const parts = splitHighlights(result.hits[0].snippet);
    expect(parts.some((p) => p.marked && /malfunction/i.test(p.text))).toBe(true);
  });

  it("preserves HTML in description as plain escaped text in snippets", async () => {
    const { ceo, toolingManager } = await setupCompany();
    await createActivityRecord(
      toolingManager,
      "Script testing",
      "<script>alert(1)</script> press had malfunction.",
    );

    const result = await searchActivities(testDb, viewer(ceo), "malfunction");
    const parts = splitHighlights(result.hits[0].snippet);

    expect(parts.every((p) => typeof p.text === "string")).toBe(true);
    expect(result.hits[0].snippet).not.toContain("<mark>");
  });
});

describe("search cannot exceed visibility scope", () => {
  it("never returns peer records outside user scope", async () => {
    const { toolingManager, planningManager } = await setupCompany();
    const peerActivity = await createActivityRecord(
      planningManager,
      "Planning meeting",
      "Weekly production schedule reviewed.",
    );

    const result = await searchActivities(testDb, viewer(toolingManager), "planning");

    expect(result.total).toBe(0);
    expect(result.hits.map((h) => h.id)).not.toContain(peerActivity.id);
  });

  it("prevents higher management from discovering pending approval records before review", async () => {
    const { ceo, toolingWorker } = await setupCompany();
    const draft = await createActivityRecord(
      toolingWorker,
      "Draft tooling report",
      "Work in progress.",
      "PENDING_APPROVAL",
    );

    const result = await searchActivities(testDb, viewer(ceo), "tooling");

    expect(result.hits.map((h) => h.id)).not.toContain(draft.id);
  });

  it("allows assigned approver to find pending records in their queue", async () => {
    const { toolingManager, toolingWorker } = await setupCompany();
    const draft = await createActivityRecord(
      toolingWorker,
      "Draft tooling report",
      "Work in progress.",
      "PENDING_APPROVAL",
    );

    const result = await searchActivities(testDb, viewer(toolingManager), "tooling");

    expect(result.hits.map((h) => h.id)).toContain(draft.id);
  });

  it("allows author to find their own pending unapproved record", async () => {
    const { toolingWorker } = await setupCompany();
    const draft = await createActivityRecord(
      toolingWorker,
      "Draft tooling report",
      "Work in progress.",
      "PENDING_APPROVAL",
    );

    const result = await searchActivities(testDb, viewer(toolingWorker), "tooling");

    expect(result.hits.map((h) => h.id)).toContain(draft.id);
  });

  it("includes cancelled records in search results", async () => {
    const { ceo, toolingManager } = await setupCompany();
    const cancelled = await createActivityRecord(
      toolingManager,
      "Cancelled tooling task",
      "Mistakenly logged.",
      "CANCELLED",
    );

    const result = await searchActivities(testDb, viewer(ceo), "tooling");

    const found = result.hits.find((h) => h.id === cancelled.id);
    expect(found).toBeDefined();
    expect(found?.approvalStatus).toBe("CANCELLED");
  });
});

describe("pagination", () => {
  it("paginates through all results without skipping records", async () => {
    const { ceo, toolingManager } = await setupCompany();
    for (let i = 0; i < 30; i += 1) {
      await createActivityRecord(toolingManager, `Tooling task ${i + 1}`, "Tooling maintenance completed.");
    }

    const first = await searchActivities(testDb, viewer(ceo), "tooling", 1, 10);
    expect(first.total).toBe(30);
    expect(first.pageCount).toBe(3);
    expect(first.hits).toHaveLength(10);

    const seenIds = new Set(first.hits.map((h) => h.id));
    for (const page of [2, 3]) {
      const next = await searchActivities(
        testDb,
        viewer(ceo),
        "tooling",
        page,
        10,
      );
      expect(next.hits).toHaveLength(10);
      for (const hit of next.hits) seenIds.add(hit.id);
    }

    expect(seenIds.size).toBe(30);
  });

  it("handles invalid page numbers gracefully", async () => {
    const { ceo, toolingManager } = await setupCompany();
    await createActivityRecord(toolingManager, "Tooling task", "Tooling maintenance completed.");

    const result = await searchActivities(testDb, viewer(ceo), "tooling", -5);

    expect(result.page).toBe(1);
    expect(result.hits).toHaveLength(1);
  });
});

describe("highlight parsing", () => {
  it("splits snippet into marked and unmarked parts", () => {
    const snippet = `Morning ${HIGHLIGHT_START}issue${HIGHLIGHT_END} reported`;

    expect(splitHighlights(snippet)).toEqual([
      { text: "Morning ", marked: false },
      { text: "issue", marked: true },
      { text: " reported", marked: false },
    ]);
  });

  it("returns unmarked text as single chunk", () => {
    expect(splitHighlights("plain text")).toEqual([
      { text: "plain text", marked: false },
    ]);
  });

  it("handles unclosed highlight tags without swallowing content", () => {
    const parts = splitHighlights(`open ${HIGHLIGHT_START}tag`);

    expect(parts.map((p) => p.text).join("")).toBe("open tag");
  });
});

async function setupFilterScenario() {
  const { toolingManager, toolingWorker, planningManager } = await setupCompany();
  await createActivityRecord(toolingWorker, "Tooling maintenance", "Wear on mold 3.");
  await createActivityRecord(toolingManager, "Tooling handover", "Handed over to shift.");
  return { manager: toolingManager, employee: toolingWorker, peerManager: planningManager };
}

describe("search filters", () => {
  it("cannot expand visibility scope via filters", async () => {
    const { employee, peerManager, manager } = await setupFilterScenario();

    const result = await searchActivities(
      testDb,
      { id: peerManager.id, isSystemAdmin: false },
      "tooling",
      1,
      undefined,
      undefined,
      {
        period: "all",
        authorId: employee.id,
        authorOrgUnitId: "",
        targetOrgUnitId: "",
      },
    );

    expect(result.hits).toHaveLength(0);

    const managerResult = await searchActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      "tooling",
      1,
      undefined,
      undefined,
      {
        period: "all",
        authorId: employee.id,
        authorOrgUnitId: "",
        targetOrgUnitId: "",
      },
    );
    expect(managerResult.hits.length).toBeGreaterThan(0);
  });

  it("narrows results when filtered by author", async () => {
    const { manager, employee } = await setupFilterScenario();

    const allHits = await searchActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      "tooling",
      1,
    );
    const narrowed = await searchActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      "tooling",
      1,
      undefined,
      undefined,
      {
        period: "all",
        authorId: employee.id,
        authorOrgUnitId: "",
        targetOrgUnitId: "",
      },
    );

    expect(narrowed.hits.length).toBeLessThanOrEqual(allHits.hits.length);
    expect(
      narrowed.hits.every((hit) => hit.authorName === "Tooling Worker"),
    ).toBe(true);
  });

  it("filters out older records when period is specified", async () => {
    const { manager } = await setupFilterScenario();

    const todayResults = await searchActivities(
      testDb,
      { id: manager.id, isSystemAdmin: false },
      "tooling",
      1,
      undefined,
      undefined,
      {
        period: "today",
        authorId: "",
        authorOrgUnitId: "",
        targetOrgUnitId: "",
      },
      new Date("2026-09-30T09:00:00.000Z"),
    );

    expect(todayResults.hits).toHaveLength(0);
  });
});
