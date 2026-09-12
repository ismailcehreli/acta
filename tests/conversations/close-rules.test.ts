import { describe, expect, it } from "vitest";

import {
  decideClose,
  SUPERVISOR_TAKEOVER_BUSINESS_DAYS,
  type CloseContext,
} from "@/server/conversations/close-rules";

// §9.3 closing table rules. Tested with mock clock and without database.

const OPENING_TIME = new Date("2026-08-03T09:00:00.000Z"); // Monday

function context(overrides: Partial<CloseContext> = {}): CloseContext {
  return {
    status: "OPEN",
    askerId: "asker",
    respondentId: "responsible",
    openedAt: OPENING_TIME,
    lastAskerActionAt: OPENING_TIME,
    now: new Date("2026-08-04T09:00:00.000Z"),
    actorId: "asker",
    actorIsSystemAdmin: false,
    actorIsAskerSupervisor: false,
    anyPartyInactive: false,
    ...overrides,
  };
}

describe("§9.3 — asker", () => {
  it("can always close", () => {
    expect(decideClose(context({ actorId: "asker" }))).toEqual({
      allowed: true,
      closeType: "NORMAL",
      requiresReason: false,
    });
  });

  it("can close even after a long period", () => {
    const decision = decideClose(
      context({ actorId: "asker", now: new Date("2026-09-30T09:00:00.000Z") }),
    );
    expect(decision.allowed).toBe(true);
  });
});

describe("§9.3 — party responsible for question", () => {
  it("can never close", () => {
    expect(decideClose(context({ actorId: "responsible" }))).toEqual({
      allowed: false,
      reason: "responsible_cannot_close",
    });
  });

  it("cannot close even after extensive time", () => {
    const decision = decideClose(
      context({ actorId: "responsible", now: new Date("2026-12-31T09:00:00.000Z") }),
    );
    expect(decision.allowed).toBe(false);
  });

  it("cannot close as responsible even if system admin", () => {
    const decision = decideClose(
      context({ actorId: "responsible", actorIsSystemAdmin: true }),
    );
    expect(decision).toEqual({
      allowed: false,
      reason: "responsible_cannot_close",
    });
  });
});

describe("§9.3 — asker's supervisor", () => {
  it(`cannot close before ${SUPERVISOR_TAKEOVER_BUSINESS_DAYS} business days`, () => {
    const decision = decideClose(
      context({
        actorId: "supervisor",
        actorIsAskerSupervisor: true,
        // Aug 3 Mon + 9 business days = Aug 14 Fri.
        now: new Date("2026-08-14T09:00:00.000Z"),
      }),
    );

    expect(decision).toEqual({ allowed: false, reason: "supervisor_too_early" });
  });

  it(`can close when ${SUPERVISOR_TAKEOVER_BUSINESS_DAYS} business days have elapsed`, () => {
    const decision = decideClose(
      context({
        actorId: "supervisor",
        actorIsAskerSupervisor: true,
        // Aug 17 Mon = 10th business day.
        now: new Date("2026-08-17T09:00:00.000Z"),
      }),
    );

    expect(decision).toEqual({
      allowed: true,
      closeType: "NORMAL",
      requiresReason: false,
    });
  });

  it("weekend does not advance business day counter", () => {
    const decision = decideClose(
      context({
        actorId: "supervisor",
        actorIsAskerSupervisor: true,
        now: new Date("2026-08-16T09:00:00.000Z"),
      }),
    );

    expect(decision.allowed).toBe(false);
  });

  it("public holiday does not advance business day counter", () => {
    const decision = decideClose(
      context({
        actorId: "supervisor",
        actorIsAskerSupervisor: true,
        now: new Date("2026-08-17T09:00:00.000Z"),
        holidays: ["2026-08-10"],
      }),
    );

    expect(decision.allowed).toBe(false);
  });

  it("counter resets when asker sends a new message", () => {
    const decision = decideClose(
      context({
        actorId: "supervisor",
        actorIsAskerSupervisor: true,
        lastAskerActionAt: new Date("2026-08-14T09:00:00.000Z"),
        now: new Date("2026-08-17T09:00:00.000Z"),
      }),
    );

    expect(decision.allowed).toBe(false);
  });
});

describe("§9.3 — system administrator", () => {
  it("can close administratively", () => {
    const decision = decideClose(
      context({
        actorId: "system",
        actorIsSystemAdmin: true,
        anyPartyInactive: true,
      }),
    );

    expect(decision).toEqual({
      allowed: true,
      closeType: "ADMINISTRATIVE",
      requiresReason: true,
    });
  });

  it("can close while parties are active — unblocks deactivation flow", () => {
    const decision = decideClose(
      context({ actorId: "system", actorIsSystemAdmin: true }),
    );

    expect(decision).toEqual({
      allowed: true,
      closeType: "ADMINISTRATIVE",
      requiresReason: true,
    });
  });

  it("administrative closure does not violate responsibility rule", () => {
    // If system admin is also the responsible party, cannot close.
    const decision = decideClose(
      context({ actorId: "responsible", actorIsSystemAdmin: true }),
    );

    expect(decision.allowed).toBe(false);
  });
});

describe("§9.3 — unrelated person and closed conversation", () => {
  it("unrelated person cannot close", () => {
    expect(decideClose(context({ actorId: "stranger" }))).toEqual({
      allowed: false,
      reason: "not_a_party",
    });
  });

  it("closed conversation cannot be closed again", () => {
    expect(decideClose(context({ status: "CLOSED" }))).toEqual({
      allowed: false,
      reason: "already_closed",
    });
  });
});
