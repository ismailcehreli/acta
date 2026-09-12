import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { recordReadFromTicket } from "@/server/reads/service";
import {
  issueReadTicket,
  READ_TICKET_MAX_AGE_MS,
  verifyReadTicket,
} from "@/server/reads/ticket";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";





const SECRET = "test-secret-with-at-least-thirty-two-characters";
const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function scenario() {
  const root = await createOrgUnit({ name: "General Management", type: "Root" });
  const unit = await createOrgUnit({ name: "Mold Shop", parentId: root.id });
  const reader = await createUser(root.id, { fullName: "Director", isUnitManager: true });
  const author = await createUser(unit.id, { fullName: "Manager", isUnitManager: true });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: unit.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Title",
      description: "Description",
      approvalStatus: "APPROVED",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  return { reader, author, activity };
}

describe("read ticket verification", () => {
  const ACTIVITY = "11111111-1111-4111-8111-111111111111";
  const USER = "22222222-2222-4222-8222-222222222222";

  it("the server measures the dwell time", () => {
    const ticket = issueReadTicket(ACTIVITY, USER, NOW, SECRET);
    const result = verifyReadTicket(
      ticket,
      ACTIVITY,
      USER,
      new Date(NOW.getTime() + 2_500),
      SECRET,
    );

    expect(result).toEqual({ ok: true, dwellMs: 2_500 });
  });

  it("a ticket issued for another activity is rejected", () => {
    const ticket = issueReadTicket(ACTIVITY, USER, NOW, SECRET);
    const result = verifyReadTicket(
      ticket,
      "33333333-3333-4333-8333-333333333333",
      USER,
      new Date(NOW.getTime() + 3_000),
      SECRET,
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("another user's ticket is rejected", () => {
    const ticket = issueReadTicket(ACTIVITY, USER, NOW, SECRET);
    const result = verifyReadTicket(
      ticket,
      ACTIVITY,
      "44444444-4444-4444-8444-444444444444",
      new Date(NOW.getTime() + 3_000),
      SECRET,
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("a forged or malformed ticket is rejected", () => {
    const now = new Date(NOW.getTime() + 3_000);
    for (const forgedTicket of [
      `${NOW.getTime()}.abc`,
      "unsigned",
      ".",
      `${NOW.getTime()}.${"0".repeat(64)}`,
    ]) {
      expect(verifyReadTicket(forgedTicket, ACTIVITY, USER, now, SECRET).ok).toBe(false);
    }
  });

  it("a ticket signed with another key is rejected", () => {
    const ticket = issueReadTicket(ACTIVITY, USER, NOW, "another-key-with-at-least-thirty-two-characters");
    const result = verifyReadTicket(
      ticket,
      ACTIVITY,
      USER,
      new Date(NOW.getTime() + 3_000),
      SECRET,
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("an abandoned tab does not create a read", () => {
    const ticket = issueReadTicket(ACTIVITY, USER, NOW, SECRET);
    const result = verifyReadTicket(
      ticket,
      ACTIVITY,
      USER,
      new Date(NOW.getTime() + READ_TICKET_MAX_AGE_MS + 1),
      SECRET,
    );

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("a ticket from the future is rejected", () => {
    const ticket = issueReadTicket(ACTIVITY, USER, new Date(NOW.getTime() + 60_000), SECRET);

    expect(verifyReadTicket(ticket, ACTIVITY, USER, NOW, SECRET)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("read receipts are created through tickets", () => {
  it("is recorded after two seconds", async () => {
    const { reader, activity } = await scenario();
    const ticket = issueReadTicket(activity.id, reader.id, NOW, SECRET);

    const result = await recordReadFromTicket(
      testDb,
      { id: reader.id, isSystemAdmin: false },
      activity.id,
      ticket,
      new Date(NOW.getTime() + 2_000),
      SECRET,
    );

    expect(result).toEqual({ ok: true, recorded: true });
    expect(await testDb.readReceipt.count()).toBe(1);
  });

  it("a ticket sent before two seconds leaves no receipt", async () => {
    const { reader, activity } = await scenario();
    const ticket = issueReadTicket(activity.id, reader.id, NOW, SECRET);

    const result = await recordReadFromTicket(
      testDb,
      { id: reader.id, isSystemAdmin: false },
      activity.id,
      ticket,
      new Date(NOW.getTime() + 1_999),
      SECRET,
    );

    expect(result).toEqual({ ok: false, reason: "too_short" });
    expect(await testDb.readReceipt.count()).toBe(0);
  });

  // Core finding: a read receipt cannot be created without opening the detail page.
  it("a call without a ticket cannot create a read receipt", async () => {
    const { reader, activity } = await scenario();

    for (const forgedTicket of ["", "9999999999999.deadbeef", `${NOW.getTime()}.`]) {
      const result = await recordReadFromTicket(
        testDb,
        { id: reader.id, isSystemAdmin: false },
        activity.id,
        forgedTicket,
        new Date(NOW.getTime() + 10_000),
        SECRET,
      );

      expect(result).toEqual({ ok: false, reason: "invalid_ticket" });
    }

    expect(await testDb.readReceipt.count()).toBe(0);
  });

  it("a person who cannot view the activity cannot create a read receipt", async () => {
    const { author, activity } = await scenario();
    const outsider = await createUser(
      (await testDb.orgUnit.findFirstOrThrow({ where: { name: "Mold Shop" } })).id,
      { fullName: "Peer" },
    );
    // The ticket is correctly signed; authorization still comes from visibility.
    const ticket = issueReadTicket(activity.id, outsider.id, NOW, SECRET);

    const result = await recordReadFromTicket(
      testDb,
      { id: outsider.id, isSystemAdmin: false },
      activity.id,
      ticket,
      new Date(NOW.getTime() + 3_000),
      SECRET,
    );

    expect(result).toEqual({ ok: false, reason: "not_visible" });
    expect(await testDb.readReceipt.count()).toBe(0);
    expect(author.id).toBeTruthy();
  });
});
