import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createSession,
  findActiveSession,
  hashSessionToken,
  revokeAllUserSessions,
  revokeSession,
} from "@/server/auth/session";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function newUser() {
  const unit = await createOrgUnit();
  return createUser(unit.id);
}

describe("session creation", () => {
  it("token itself is not written to database, hash is written", async () => {
    const user = await newUser();

    const session = await createSession(testDb, user.id, NOW);
    const stored = await testDb.session.findUniqueOrThrow({
      where: { id: session.sessionId },
    });

    expect(stored.tokenHash).toBe(hashSessionToken(session.token));
    expect(stored.tokenHash).not.toBe(session.token);
  });

  it("each session receives a different token", async () => {
    const user = await newUser();

    const first = await createSession(testDb, user.id, NOW);
    const second = await createSession(testDb, user.id, NOW);

    expect(first.token).not.toBe(second.token);
  });
});

describe("session verification", () => {
  it("valid token returns user", async () => {
    const user = await newUser();
    const session = await createSession(testDb, user.id, NOW);

    const active = await findActiveSession(testDb, session.token, NOW);

    expect(active?.userId).toBe(user.id);
  });

  it("unknown token is rejected", async () => {
    await newUser();

    expect(await findActiveSession(testDb, "bogus-token", NOW)).toBeNull();
  });

  it("expired session is rejected", async () => {
    const user = await newUser();
    const session = await createSession(testDb, user.id, NOW);

    const afterExpiry = new Date(session.expiresAt.getTime() + 1_000);

    expect(await findActiveSession(testDb, session.token, afterExpiry)).toBeNull();
  });

  it("revoked session is rejected", async () => {
    const user = await newUser();
    const session = await createSession(testDb, user.id, NOW);

    await revokeSession(testDb, session.token, NOW);

    expect(await findActiveSession(testDb, session.token, NOW)).toBeNull();
  });

  it("session becomes invalid if user is deactivated", async () => {
    const root = await createOrgUnit();
    const user = await createUser(root.id);
    const session = await createSession(testDb, user.id, NOW);

    await testDb.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    expect(await findActiveSession(testDb, session.token, NOW)).toBeNull();
  });
});

describe("bulk revocation", () => {
  it("all open sessions of user are dropped", async () => {
    const user = await newUser();
    const first = await createSession(testDb, user.id, NOW);
    const second = await createSession(testDb, user.id, NOW);

    const revoked = await revokeAllUserSessions(testDb, user.id, NOW);

    expect(revoked).toBe(2);
    expect(await findActiveSession(testDb, first.token, NOW)).toBeNull();
    expect(await findActiveSession(testDb, second.token, NOW)).toBeNull();
  });

  it("does not affect another user's session", async () => {
    const root = await createOrgUnit();
    const user = await createUser(root.id);
    const other = await createUser(root.id);
    const otherSession = await createSession(testDb, other.id, NOW);

    await createSession(testDb, user.id, NOW);
    await revokeAllUserSessions(testDb, user.id, NOW);

    expect(await findActiveSession(testDb, otherSession.token, NOW)).not.toBeNull();
  });
});
