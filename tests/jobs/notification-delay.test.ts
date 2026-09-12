import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { dispatchNotifications } from "@/worker/notifications/dispatcher";
import type {
  EmailMessage,
  EmailTransport,
} from "@/worker/notifications/transport";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Acceptance criterion: **notification delay < 5 minutes** (§18.4, Task 6.3).
//
// Delay consists of two parts:
//
//   1. Waiting for the worker's next tick — tick interval is fixed and
//      measured by `TICK_INTERVAL_MS`.
//   2. Queue processing during that tick — which is measured here.
//
// Measurement does not go to real SMTP; a counter is used instead of a transport. What is tested
// is not mail server speed, but **queue's own processing time**: whether a notification wave
// of 100 people is drained in a single round.

const NOW = new Date("2026-08-22T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Fake transport that counts dispatches; does not hit network. */
function countingTransport(): EmailTransport & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    name: "acceptance-measurement",
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

describe("queue processing time", () => {
  it("notification wave of 100 people drains in a single round", async () => {
    const root = await createOrgUnit({ name: "Company", type: "Root" });
    const unit = await createOrgUnit({ name: "Tooling Shop", parentId: root.id });

    const people = [];
    for (let i = 0; i < 100; i += 1) {
      people.push(await createUser(unit.id, { fullName: `Person ${i}` }));
    }

    for (const person of people) {
      await enqueueNotification(testDb, {
        userId: person.id,
        eventType: NOTIFICATION_EVENTS.noActivityToday,
        payload: { day: "2026-08-21" },
        idempotencyKey: `no_activity_today:${person.id}:2026-08-21`,
        now: NOW,
      });
    }

    const transport = countingTransport();
    const start = Date.now();

    const result = await dispatchNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "http://localhost:3100",
    });

    const durationMs = Date.now() - start;

    expect(result.sent).toBe(100);
    expect(transport.sent).toHaveLength(100);

    // Acceptance limit is 5 minutes; measured time should be well below this.
    // Threshold is intentionally loose: what is tested here is "reasonable",
    // not "how fast" — exact number is recorded in acceptance report.
    expect(durationMs).toBeLessThan(30_000);
    console.log(`QUEUE|100|${durationMs}`);
  });

  it("round does not spin unnecessarily when queue is empty", async () => {
    const result = await dispatchNotifications(testDb, countingTransport(), {
      now: NOW,
      baseUrl: "http://localhost:3100",
    });

    expect(result.sent).toBe(0);
  });
});
