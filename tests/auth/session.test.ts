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

describe("oturum oluşturma", () => {
  it("belirtecin kendisi veritabanına yazılmaz, özeti yazılır", async () => {
    const user = await newUser();

    const session = await createSession(testDb, user.id, NOW);
    const stored = await testDb.session.findUniqueOrThrow({
      where: { id: session.sessionId },
    });

    expect(stored.tokenHash).toBe(hashSessionToken(session.token));
    expect(stored.tokenHash).not.toBe(session.token);
  });

  it("her oturum farklı belirteç alır", async () => {
    const user = await newUser();

    const first = await createSession(testDb, user.id, NOW);
    const second = await createSession(testDb, user.id, NOW);

    expect(first.token).not.toBe(second.token);
  });
});

describe("oturum doğrulama", () => {
  it("geçerli belirteç kullanıcıyı verir", async () => {
    const user = await newUser();
    const session = await createSession(testDb, user.id, NOW);

    const active = await findActiveSession(testDb, session.token, NOW);

    expect(active?.userId).toBe(user.id);
  });

  it("bilinmeyen belirteç kabul edilmez", async () => {
    await newUser();

    expect(await findActiveSession(testDb, "uydurma-belirtec", NOW)).toBeNull();
  });

  it("süresi geçmiş oturum kabul edilmez", async () => {
    const user = await newUser();
    const session = await createSession(testDb, user.id, NOW);

    const afterExpiry = new Date(session.expiresAt.getTime() + 1_000);

    expect(await findActiveSession(testDb, session.token, afterExpiry)).toBeNull();
  });

  it("iptal edilmiş oturum kabul edilmez", async () => {
    const user = await newUser();
    const session = await createSession(testDb, user.id, NOW);

    await revokeSession(testDb, session.token, NOW);

    expect(await findActiveSession(testDb, session.token, NOW)).toBeNull();
  });

  it("kullanıcı pasifleştirilirse oturumu geçersizleşir", async () => {
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

describe("toplu iptal", () => {
  it("kullanıcının tüm açık oturumları düşer", async () => {
    const user = await newUser();
    const first = await createSession(testDb, user.id, NOW);
    const second = await createSession(testDb, user.id, NOW);

    const revoked = await revokeAllUserSessions(testDb, user.id, NOW);

    expect(revoked).toBe(2);
    expect(await findActiveSession(testDb, first.token, NOW)).toBeNull();
    expect(await findActiveSession(testDb, second.token, NOW)).toBeNull();
  });

  it("başka kullanıcının oturumuna dokunmaz", async () => {
    const root = await createOrgUnit();
    const user = await createUser(root.id);
    const other = await createUser(root.id);
    const otherSession = await createSession(testDb, other.id, NOW);

    await createSession(testDb, user.id, NOW);
    await revokeAllUserSessions(testDb, user.id, NOW);

    expect(await findActiveSession(testDb, otherSession.token, NOW)).not.toBeNull();
  });
});
