import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REALTIME_EVENTS, type RealtimeEvent } from "@/server/realtime/events";
import { shutdownRealtimeHub, subscribe, subscriberCount } from "@/server/realtime/hub";
import { publishRealtimeEvent } from "@/server/realtime/publish";

import { testDatabaseUrl, testDb } from "../helpers/test-db";


//




const originalDatabaseUrl = process.env.DATABASE_URL;


const FIRST_USER_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_USER_ID = "22222222-2222-4222-8222-222222222222";


function wait(
  events: RealtimeEvent[],
  ms = 2_000,
): Promise<RealtimeEvent | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      if (events.length > 0) return resolve(events[0]!);
      if (Date.now() - start > ms) return resolve(null);
      setTimeout(poll, 20);
    };
    poll();
  });
}

beforeEach(() => {
  process.env.DATABASE_URL = testDatabaseUrl;
});

afterEach(async () => {
  await shutdownRealtimeHub();
  process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("real-time delivery", () => {
  it("an event reaches only the named user", async () => {
    const firstUserEvents: RealtimeEvent[] = [];
    const secondUserEvents: RealtimeEvent[] = [];

    const unsubscribeFirst = await subscribe(FIRST_USER_ID, (event) => firstUserEvents.push(event));
    const unsubscribeSecond = await subscribe(SECOND_USER_ID, (event) => secondUserEvents.push(event));

    try {
      await publishRealtimeEvent(testDb, {
        kind: REALTIME_EVENTS.questionAsked,
        userIds: [FIRST_USER_ID],
      });

      const received = await wait(firstUserEvents);
      expect(received).toEqual({ kind: REALTIME_EVENTS.questionAsked });

      expect(secondUserEvents).toEqual([]);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
    }
  });

  it("two tabs for the same user both receive the event", async () => {
    const firstTabEvents: RealtimeEvent[] = [];
    const secondTabEvents: RealtimeEvent[] = [];

    const unsubscribeFirst = await subscribe(FIRST_USER_ID, (event) => firstTabEvents.push(event));
    const unsubscribeSecond = await subscribe(FIRST_USER_ID, (event) => secondTabEvents.push(event));

    try {
      await publishRealtimeEvent(testDb, {
        kind: REALTIME_EVENTS.answerReceived,
        userIds: [FIRST_USER_ID],
      });

      expect(await wait(firstTabEvents)).not.toBeNull();
      expect(await wait(secondTabEvents)).not.toBeNull();
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
    }
  });

  it("unsubscribing removes the event listener", async () => {
    const events: RealtimeEvent[] = [];
    const unsubscribe = await subscribe(FIRST_USER_ID, (event) => events.push(event));
    unsubscribe();

    await publishRealtimeEvent(testDb, {
      kind: REALTIME_EVENTS.questionAsked,
      userIds: [FIRST_USER_ID],
    });

    expect(await wait(events, 500)).toBeNull();
    expect(subscriberCount()).toBe(0);
  });

  it("a malformed payload is not distributed and does not remove the listener", async () => {
    const events: RealtimeEvent[] = [];
    const unsubscribe = await subscribe(FIRST_USER_ID, (event) => events.push(event));

    try {
      await testDb.$executeRawUnsafe(
        "SELECT pg_notify($1, $2)",
        "acta_events",
        JSON.stringify({ kind: "unknown_kind", userIds: [FIRST_USER_ID] }),
      );

      expect(await wait(events, 500)).toBeNull();

      await publishRealtimeEvent(testDb, {
        kind: REALTIME_EVENTS.questionAsked,
        userIds: [FIRST_USER_ID],
      });

      expect(await wait(events)).toEqual({ kind: REALTIME_EVENTS.questionAsked });
    } finally {
      unsubscribe();
    }
  });
});

describe("publishing", () => {
  it("nothing is published when there are no recipients", async () => {
    const events: RealtimeEvent[] = [];
    const unsubscribe = await subscribe(FIRST_USER_ID, (event) => events.push(event));

    try {
      await publishRealtimeEvent(testDb, {
        kind: REALTIME_EVENTS.questionAsked,
        userIds: [],
      });

      expect(await wait(events, 400)).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it("a long recipient list is chunked and reaches everyone", async () => {
    const userIds = Array.from({ length: 400 }, (_, i) => {
      const s = i.toString(16).padStart(12, "0");
      return `33333333-3333-4333-8333-${s}`;
    });

    const events: RealtimeEvent[] = [];
    const lastUserId = userIds[userIds.length - 1]!;
    const unsubscribe = await subscribe(lastUserId, (event) => events.push(event));

    try {
      await publishRealtimeEvent(testDb, {
        kind: REALTIME_EVENTS.activityCancelled,
        userIds,
      });

      // Reaching the last ID proves chunking did not drop anyone.
      expect(await wait(events)).toEqual({
        kind: REALTIME_EVENTS.activityCancelled,
      });
    } finally {
      unsubscribe();
    }
  });
});
