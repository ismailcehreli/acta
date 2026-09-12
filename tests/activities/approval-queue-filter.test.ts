import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  countApprovalGroups,
  listApprovalGroups,
} from "@/server/activities/approval-groups";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Approval queue filters and pagination.
// Queue is displayed grouped by user and date.
// Filters only narrow down results; they never grant unauthorized access.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company", type: "ROOT" });
  const tooling = await createOrgUnit({ name: "Tooling Department", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning Department", parentId: root.id });

  const manager = await createUser(tooling.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const peerManager = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });
  const worker1 = await createUser(tooling.id, { fullName: "Worker One" });
  const worker2 = await createUser(tooling.id, { fullName: "Worker Two" });

  return { tooling, planning, manager, peerManager, worker1, worker2 };
}

function pendingActivityInput(day: string, title: string, approverId: string) {
  return {
    title,
    activityDate: new Date(`${day}T00:00:00.000Z`),
    approvalStatus: "PENDING_APPROVAL" as const,
    approverId,
    approvalSubmittedAt: NOW,
  };
}

describe("author filter", () => {
  it("only returns groups for the selected author", async () => {
    const { manager, worker1, worker2 } = await setupCompany();
    await createActivity(worker1, pendingActivityInput("2026-08-19", "Worker 1 task", manager.id));
    await createActivity(worker2, pendingActivityInput("2026-08-19", "Worker 2 task", manager.id));

    const groups = await listApprovalGroups(testDb, manager.id, NOW, {
      authorId: worker1.id,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.authorName).toBe("Worker One");
  });
});

describe("period filter", () => {
  it("excludes prior days when today is selected", async () => {
    const { manager, worker1 } = await setupCompany();
    await createActivity(worker1, pendingActivityInput("2026-08-18", "Yesterday", manager.id));
    await createActivity(worker1, pendingActivityInput("2026-08-19", "Today", manager.id));

    const groups = await listApprovalGroups(testDb, manager.id, NOW, {
      period: "today",
    });

    expect(groups.flatMap((g) => g.items.map((i) => i.title))).toEqual([
      "Today",
    ]);
  });
});

describe("department filter", () => {
  it("only returns records belonging to the selected department", async () => {
    const { tooling, planning, manager, worker1 } = await setupCompany();
    const planner = await createUser(planning.id, { fullName: "Planner User" });

    await createActivity(worker1, pendingActivityInput("2026-08-19", "Tooling task", manager.id));
    await createActivity(
      planner,
      pendingActivityInput("2026-08-19", "Planning task", manager.id),
    );

    const groups = await listApprovalGroups(testDb, manager.id, NOW, {
      authorOrgUnitId: tooling.id,
    });

    expect(groups.flatMap((g) => g.items.map((i) => i.title))).toEqual([
      "Tooling task",
    ]);
  });
});

describe("pagination is group-based", () => {
  it("does not split a group across pages", async () => {
    const { manager, worker1, worker2 } = await setupCompany();
    await createActivity(worker1, pendingActivityInput("2026-08-18", "Worker 1 Part 1", manager.id));
    await createActivity(worker1, pendingActivityInput("2026-08-18", "Worker 1 Part 2", manager.id));
    await createActivity(worker2, pendingActivityInput("2026-08-19", "Worker 2 Part 1", manager.id));

    const firstPage = await listApprovalGroups(testDb, manager.id, NOW, {}, { limit: 1 });

    expect(firstPage).toHaveLength(1);
    expect(firstPage[0]?.items).toHaveLength(2);
  });

  it("retrieves the next group on subsequent page", async () => {
    const { manager, worker1, worker2 } = await setupCompany();
    await createActivity(worker1, pendingActivityInput("2026-08-18", "Worker 1 Part 1", manager.id));
    await createActivity(worker2, pendingActivityInput("2026-08-19", "Worker 2 Part 1", manager.id));

    const secondPage = await listApprovalGroups(testDb, manager.id, NOW, {}, {
      limit: 1,
      skip: 1,
    });

    expect(secondPage).toHaveLength(1);
    expect(secondPage[0]?.authorName).toBe("Worker Two");
  });

  it("counts distinct groups rather than raw rows", async () => {
    const { manager, worker1 } = await setupCompany();
    await createActivity(worker1, pendingActivityInput("2026-08-18", "Worker 1 Part 1", manager.id));
    await createActivity(worker1, pendingActivityInput("2026-08-18", "Worker 1 Part 2", manager.id));

    expect(await countApprovalGroups(testDb, manager.id, NOW, {})).toBe(1);
  });
});

describe("filters do not bypass authorization", () => {
  it("never returns another manager's queue regardless of filters", async () => {
    const { manager, peerManager, worker1 } = await setupCompany();
    await createActivity(worker1, pendingActivityInput("2026-08-19", "Assigned task", manager.id));

    const groups = await listApprovalGroups(testDb, peerManager.id, NOW, {
      authorId: worker1.id,
    });

    expect(groups).toHaveLength(0);
  });
});
