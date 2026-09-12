import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createSession, findActiveSession } from "@/server/auth/session";
import {
  deactivateUser,
  findSubordinates,
  reactivateUser,
} from "@/server/users/deactivate";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Deactivation blockers and reactivation rules (§4.6).
// Deactivation is blocked when user has open blockers (conversations, subordinates).

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function twoLevelTree() {
  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  const department = await createOrgUnit({
    name: "Workshop",
    type: "Department",
    parentId: root.id,
  });
  return { root, department };
}

describe("unblocked deactivation", () => {
  it("deactivates user without open blockers", async () => {
    const { department } = await twoLevelTree();
    const user = await createUser(department.id);

    const result = await deactivateUser(testDb, user.id, NOW);

    expect(result.ok).toBe(true);
    const stored = await testDb.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.isActive).toBe(false);
  });

  it("revokes active sessions of deactivated user", async () => {
    const { department } = await twoLevelTree();
    const user = await createUser(department.id);
    const session = await createSession(testDb, user.id, NOW);

    const result = await deactivateUser(testDb, user.id, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revokedSessionCount).toBe(1);
    expect(await findActiveSession(testDb, session.token, NOW)).toBeNull();
  });

  it("clears unit manager flag on deactivation so replacement can be assigned", async () => {
    const { department } = await twoLevelTree();
    const manager = await createUser(department.id, { isUnitManager: true });

    await deactivateUser(testDb, manager.id, NOW);

    const replacement = await createUser(department.id, {
      isUnitManager: true,
    });
    expect(replacement.isUnitManager).toBe(true);
  });

  it("user with past activities can be deactivated", async () => {
    const { department } = await twoLevelTree();
    const user = await createUser(department.id);
    await createActivity(user);

    const result = await deactivateUser(testDb, user.id, NOW);

    expect(result.ok).toBe(true);
  });
});

describe("open conversation blocker", () => {
  async function openConversation(
    askerId: string,
    responsibleId: string,
    activityAuthor: { id: string; orgUnitId: string },
  ) {
    const activity = await createActivity(activityAuthor);
    return testDb.conversation.create({
      data: { activityId: activity.id, askerId, responsibleId },
    });
  }

  it("blocks deactivation of user responsible for open question", async () => {
    const { root, department } = await twoLevelTree();
    const asker = await createUser(root.id);
    const responsible = await createUser(department.id);
    await openConversation(asker.id, responsible.id, responsible);

    const result = await deactivateUser(testDb, responsible.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "blocked") return;
    expect(result.blockers.openConversationCount).toBe(1);
  });

  it("blocks deactivation of user who asked the question", async () => {
    const { root, department } = await twoLevelTree();
    const asker = await createUser(root.id);
    const responsible = await createUser(department.id);
    await openConversation(asker.id, responsible.id, responsible);

    const result = await deactivateUser(testDb, asker.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "blocked") return;
    expect(result.blockers.openConversationCount).toBe(1);
  });

  it("permits deactivation once conversation is closed", async () => {
    const { root, department } = await twoLevelTree();
    const asker = await createUser(root.id);
    const responsible = await createUser(department.id);
    const conversation = await openConversation(
      asker.id,
      responsible.id,
      responsible,
    );

    await testDb.conversation.update({
      where: { id: conversation.id },
      data: { status: "CLOSED", closedAt: NOW, closedById: asker.id },
    });

    const result = await deactivateUser(testDb, responsible.id, NOW);
    expect(result.ok).toBe(true);
  });
});

describe("subordinate blocker", () => {
  it("blocks deactivation of manager with team members and lists them", async () => {
    const { department } = await twoLevelTree();
    const manager = await createUser(department.id, {
      isUnitManager: true,
      fullName: "Department Manager",
    });
    await createUser(department.id, { fullName: "Team Member" });

    const result = await deactivateUser(testDb, manager.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "blocked") return;
    expect(result.blockers.subordinates.map((s) => s.fullName)).toEqual([
      "Team Member",
    ]);
  });

  it("users in descendant units count as subordinates of parent manager", async () => {
    const { root, department } = await twoLevelTree();
    const director = await createUser(root.id, {
      isUnitManager: true,
      fullName: "Director",
    });
    await createUser(department.id, { fullName: "Department Worker" });

    const result = await deactivateUser(testDb, director.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "blocked") return;
    expect(result.blockers.subordinates.map((s) => s.fullName)).toEqual([
      "Department Worker",
    ]);
  });

  it("allows deactivation once team is transferred", async () => {
    const { root, department } = await twoLevelTree();
    const director = await createUser(root.id, { isUnitManager: true });
    const outgoing = await createUser(department.id, { isUnitManager: true });
    const member = await createUser(department.id);

    await testDb.user.update({
      where: { id: member.id },
      data: { orgUnitId: root.id },
    });

    const result = await deactivateUser(testDb, outgoing.id, NOW);

    expect(result.ok).toBe(true);
    expect(await findSubordinates(testDb, director)).toHaveLength(1);
  });

  it("returns empty subordinates for non-manager", async () => {
    const { department } = await twoLevelTree();
    const worker = await createUser(department.id);

    expect(await findSubordinates(testDb, worker)).toEqual([]);
  });
});

describe("unknown user handling", () => {
  it("returns user_not_found for non-existent user", async () => {
    const result = await deactivateUser(
      testDb,
      "00000000-0000-0000-0000-000000000000",
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: "user_not_found" });
  });
});

describe("reactivation", () => {
  it("reactivates deactivated user", async () => {
    const { department } = await twoLevelTree();
    const user = await createUser(department.id);

    await deactivateUser(testDb, user.id, NOW);
    const result = await reactivateUser(testDb, user.id, NOW);

    expect(result.ok).toBe(true);
    const stored = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.isActive).toBe(true);
  });

  it("does not automatically restore unit manager role upon reactivation", async () => {
    const { department } = await twoLevelTree();
    const manager = await createUser(department.id, { isUnitManager: true });

    await deactivateUser(testDb, manager.id, NOW);
    await reactivateUser(testDb, manager.id, NOW);

    const stored = await testDb.user.findUniqueOrThrow({ where: { id: manager.id } });
    expect(stored.isUnitManager).toBe(false);
  });

  it("rejects reactivation if unit is inactive", async () => {
    const { department } = await twoLevelTree();
    const user = await createUser(department.id);

    await deactivateUser(testDb, user.id, NOW);
    await testDb.orgUnit.update({
      where: { id: department.id },
      data: { isActive: false },
    });

    const result = await reactivateUser(testDb, user.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("inactive_org_unit");

    const stored = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.isActive).toBe(false);
  });

  it("rejects reactivation of already active user", async () => {
    const { department } = await twoLevelTree();
    const user = await createUser(department.id);

    const result = await reactivateUser(testDb, user.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("already_active");
  });

  it("rejects reactivation of non-existent user", async () => {
    const result = await reactivateUser(
      testDb,
      "00000000-0000-4000-8000-000000000000",
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("user_not_found");
  });

  it("existing password continues to function after reactivation", async () => {
    const { department } = await twoLevelTree();
    const { createUserWithPassword } = await import("../helpers/fixtures");
    const { login } = await import("@/server/auth/login");

    const user = await createUserWithPassword(department.id, "initial-password-1234", {
      email: "reactivated@example.test",
    });

    await deactivateUser(testDb, user.id, NOW);
    await reactivateUser(testDb, user.id, NOW);

    const result = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.9", sleep: async () => {} },
      { email: "reactivated@example.test", password: "initial-password-1234" },
    );

    expect(result.ok).toBe(true);
  });
});
