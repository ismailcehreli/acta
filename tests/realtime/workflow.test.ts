import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { cancelActivity } from "@/server/activities/cancel";
import {
  askQuestion,
  closeConversation,
  replyToConversation,
} from "@/server/conversations/service";
import { REALTIME_EVENTS, type RealtimeEvent } from "@/server/realtime/events";
import { shutdownRealtimeHub, subscribe } from "@/server/realtime/hub";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../helpers/test-db";


//




const NOW = new Date("2026-08-17T09:00:00.000Z");
const originalDatabaseUrl = process.env.DATABASE_URL;

function wait(events: RealtimeEvent[], ms = 3_000): Promise<RealtimeEvent | null> {
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

beforeEach(async () => {
  process.env.DATABASE_URL = testDatabaseUrl;
  await resetDatabase();
});

afterEach(async () => {
  await shutdownRealtimeHub();
  process.env.DATABASE_URL = originalDatabaseUrl;
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function scenario() {
  const root = await createOrgUnit({ name: "General Management", type: "Root" });
  const moldShop = await createOrgUnit({ name: "Mold Shop", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const director = await createUser(root.id, {
    fullName: "Director",
    isUnitManager: true,
  });
  const author = await createUser(moldShop.id, {
    fullName: "Mold Shop Manager",
    isUnitManager: true,
  });

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
      description: "Weekly maintenance was completed.",
      approvalStatus: "APPROVED",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  return { director, author, peer, activity };
}

describe("events produced by workflows", () => {
  it("asking a question reaches the assignee's stream but not a peer's", async () => {
    const { director, author, peer, activity } = await scenario();

    const authorEvents: RealtimeEvent[] = [];
    const peerEvents: RealtimeEvent[] = [];
    const unsubscribeAuthor = await subscribe(author.id, (event) => authorEvents.push(event));
    const unsubscribePeer = await subscribe(peer.id, (event) => peerEvents.push(event));

    try {
      const result = await askQuestion(
        testDb,
        { id: director.id, isSystemAdmin: false },
        { activityId: activity.id, text: "Which molds were used?" },
        NOW,
      );
      expect(result.ok).toBe(true);

      expect(await wait(authorEvents)).toEqual({
        kind: REALTIME_EVENTS.questionAsked,
      });
      expect(peerEvents).toEqual([]);
    } finally {
      unsubscribeAuthor();
      unsubscribePeer();
    }
  });

  it("writing an answer reaches the other person's stream", async () => {
    const { director, author, activity } = await scenario();

    const opened = await askQuestion(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { activityId: activity.id, text: "Which molds were used?" },
      NOW,
    );
    if (!opened.ok) throw new Error("setup failed");

    const askerEvents: RealtimeEvent[] = [];
    const unsubscribe = await subscribe(director.id, (event) => askerEvents.push(event));

    try {
      const answer = await replyToConversation(
        testDb,
        { id: author.id, isSystemAdmin: false },
        { conversationId: opened.value.id, text: "Mold number three." },
        new Date(NOW.getTime() + 60_000),
      );
      expect(answer.ok).toBe(true);

      expect(await wait(askerEvents)).toEqual({
        kind: REALTIME_EVENTS.answerReceived,
      });
    } finally {
      unsubscribe();
    }
  });

  it("closing a conversation reaches the other participant's stream", async () => {
    const { director, author, activity } = await scenario();

    const opened = await askQuestion(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { activityId: activity.id, text: "Which molds were used?" },
      NOW,
    );
    if (!opened.ok) throw new Error("setup failed");

    const authorEvents: RealtimeEvent[] = [];
    const unsubscribe = await subscribe(author.id, (event) => authorEvents.push(event));

    try {
      const closeResult = await closeConversation(
        testDb,
        { id: director.id, isSystemAdmin: false },
        opened.value.id,
        new Date(NOW.getTime() + 120_000),
      );
      expect(closeResult.ok).toBe(true);

      expect(await wait(authorEvents)).toEqual({
        kind: REALTIME_EVENTS.conversationClosed,
      });
    } finally {
      unsubscribe();
    }
  });

  it("cancelling an activity reaches the participants of its open conversation", async () => {
    const { director, author, activity } = await scenario();

    await askQuestion(
      testDb,
      { id: director.id, isSystemAdmin: false },
      { activityId: activity.id, text: "Which molds were used?" },
      NOW,
    );

    const askerEvents: RealtimeEvent[] = [];
    const unsubscribe = await subscribe(director.id, (event) => askerEvents.push(event));

    try {
      const cancelResult = await cancelActivity(
        testDb,
        { id: author.id, isSystemAdmin: false },
        activity.id,
        "It was entered for the wrong date.",
        new Date(NOW.getTime() + 180_000),
      );
      expect(cancelResult.ok).toBe(true);

      expect(await wait(askerEvents)).toEqual({
        kind: REALTIME_EVENTS.activityCancelled,
      });
    } finally {
      unsubscribe();
    }
  });

  it("a rolled-back transaction does not publish an event", async () => {
    const { director, author, activity } = await scenario();

    const authorEvents: RealtimeEvent[] = [];
    const unsubscribe = await subscribe(author.id, (event) => authorEvents.push(event));

    try {
      await expect(
        testDb.$transaction(async (tx) => {
          const { publishRealtimeEvent } = await import("@/server/realtime/publish");
          await publishRealtimeEvent(tx, {
            kind: REALTIME_EVENTS.questionAsked,
            userIds: [author.id],
          });
          throw new Error("rolled back intentionally");
        }),
      ).rejects.toThrow("rolled back intentionally");

      expect(await wait(authorEvents, 600)).toBeNull();

      const result = await askQuestion(
        testDb,
        { id: director.id, isSystemAdmin: false },
        { activityId: activity.id, text: "Which molds were used?" },
        NOW,
      );
      expect(result.ok).toBe(true);
      expect(await wait(authorEvents)).not.toBeNull();
    } finally {
      unsubscribe();
    }
  });
});
