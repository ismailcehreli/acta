import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { updateActivity } from "@/server/activities/write";
import {
  countsAsRead,
  listActivityReaders,
  markActivityAsRead,
  READ_DWELL_MS,
} from "@/server/reads/service";
import { saveSettings, SETTING_KEYS } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";




const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function scenario() {
  const root = await createOrgUnit({ name: "General Management", type: "Root" });
  const moldShop = await createOrgUnit({ name: "Mold Shop", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const generalManager = await createUser(root.id, {
    fullName: "General Manager",
    isUnitManager: true,
  });
  const manager = await createUser(moldShop.id, {
    fullName: "Mold Shop Manager",
    isUnitManager: true,
  });
  const author = await createUser(moldShop.id, { fullName: "Mold Shop Employee" });
  const peer = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: moldShop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Mold maintenance",
      description: "A crack was repaired.",
      approvalStatus: "APPROVED",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  return { generalManager, manager, author, peer, activity, moldShop };
}

const viewer = (user: { id: string }) => ({ id: user.id, isSystemAdmin: false });

describe("§10.2 — what counts as read", () => {
  it("less than two seconds does not count as read", () => {
    expect(countsAsRead(1_999)).toBe(false);
    expect(countsAsRead(0)).toBe(false);
  });

  it("two seconds or more counts as read", () => {
    expect(countsAsRead(READ_DWELL_MS)).toBe(true);
    expect(countsAsRead(5_000)).toBe(true);
  });

  it("a short view does not leave a receipt", async () => {
    const { manager, activity } = await scenario();

    const result = await markActivityAsRead(
      testDb,
      viewer(manager),
      activity.id,
      1_500,
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: "too_short" });
    expect(await testDb.readReceipt.count()).toBe(0);
  });

  it("the client follows the server setting when the threshold exceeds two seconds", async () => {
    const { manager, activity } = await scenario();
    await saveSettings(testDb, { [SETTING_KEYS.readDwellSeconds]: "5" });

    const early = await markActivityAsRead(
      testDb,
      viewer(manager),
      activity.id,
      3_000,
      NOW,
    );
    expect(early).toEqual({ ok: false, reason: "too_short" });

    const sufficient = await markActivityAsRead(
      testDb,
      viewer(manager),
      activity.id,
      5_000,
      NOW,
    );
    expect(sufficient).toEqual({ ok: true, recorded: true });
  });
});

describe("§10.3 — first and last read", () => {
  it("the first read is preserved and the last read is updated", async () => {
    const { manager, activity } = await scenario();
    const sonra = new Date(NOW.getTime() + 3_600_000);

    await markActivityAsRead(testDb, viewer(manager), activity.id, 3_000, NOW);
    await markActivityAsRead(testDb, viewer(manager), activity.id, 3_000, sonra);

    const record = await testDb.readReceipt.findUniqueOrThrow({
      where: { activityId_userId: { activityId: activity.id, userId: manager.id } },
    });

    expect(record.firstReadAt).toEqual(NOW);
    expect(record.lastReadAt).toEqual(sonra);

    expect(await testDb.readReceipt.count()).toBe(1);
  });

  it("the author's own record does not count as read", async () => {
    const { author, activity } = await scenario();

    const result = await markActivityAsRead(
      testDb,
      viewer(author),
      activity.id,
      5_000,
      NOW,
    );

    expect(result).toEqual({ ok: true, recorded: false });
    expect(await testDb.readReceipt.count()).toBe(0);
  });
});

describe("visibility rules also apply to reads", () => {
  it("an unseen activity cannot be marked as read", async () => {
    const { peer, activity } = await scenario();

    const result = await markActivityAsRead(
      testDb,
      viewer(peer),
      activity.id,
      5_000,
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: "not_visible" });
    expect(await testDb.readReceipt.count()).toBe(0);
  });

  it("a missing activity cannot be marked as read", async () => {
    const { manager } = await scenario();

    const result = await markActivityAsRead(
      testDb,
      viewer(manager),
      "00000000-0000-0000-0000-000000000000",
      5_000,
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: "not_visible" });
  });
});

describe("§10.3 — who can see read information", () => {
  async function readActivity() {
    const context = await scenario();
    await markActivityAsRead(
      testDb,
      viewer(context.manager),
      context.activity.id,
      3_000,
      NOW,
    );
    await markActivityAsRead(
      testDb,
      viewer(context.generalManager),
      context.activity.id,
      3_000,
      NOW,
    );
    return context;
  }

  it("the author sees who read their activity", async () => {
    const { author, activity, manager, generalManager } = await readActivity();

    const readers = await listActivityReaders(
      testDb,
      viewer(author),
      activity.id,
    );

    expect(readers.map((r) => r.userId).sort()).toEqual(
      [manager.id, generalManager.id].sort(),
    );
  });

  it("a reader sees only their own receipt", async () => {
    const { manager, activity } = await readActivity();

    const readers = await listActivityReaders(
      testDb,
      viewer(manager),
      activity.id,
    );

    expect(readers).toHaveLength(1);
    expect(readers[0].userId).toBe(manager.id);
  });

  it("a manager cannot see what their team has read", async () => {
    const { generalManager, manager, activity } = await readActivity();

    const readers = await listActivityReaders(
      testDb,
      viewer(generalManager),
      activity.id,
    );



    expect(readers).toHaveLength(1);
    expect(readers[0].userId).toBe(generalManager.id);
    expect(readers.map((r) => r.userId)).not.toContain(manager.id);
  });

  it("a person who cannot view the activity cannot see its read information", async () => {
    const { peer, activity } = await readActivity();

    expect(await listActivityReaders(testDb, viewer(peer), activity.id)).toEqual(
      [],
    );
  });
});

describe("a read closes the revision window (§5.5)", () => {
  it("the author cannot revise after someone else reads", async () => {
    const { author, manager, activity, moldShop } = await scenario();

    await markActivityAsRead(
      testDb,
      viewer(manager),
      activity.id,
      3_000,
      new Date(NOW.getTime() + 60_000),
    );

    const result = await updateActivity(
      testDb,
      author.id,
      {
        id: activity.id,
        activityDate: "2026-08-17",
        title: "Revised title",
        description: "Revised description",
        targetDepartmentIds: [moldShop.id],
      },
      new Date(NOW.getTime() + 120_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_read");
  });

  it("the window remains open when nobody has read the record", async () => {
    const { author, activity, moldShop } = await scenario();

    const result = await updateActivity(
      testDb,
      author.id,
      {
        id: activity.id,
        activityDate: "2026-08-17",
        title: "Revised title",
        description: "Revised description",
        targetDepartmentIds: [moldShop.id],
      },
      new Date(NOW.getTime() + 120_000),
    );

    expect(result.ok).toBe(true);
  });
});
