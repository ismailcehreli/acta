import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { sendPasswordResetForUser } from "@/server/auth/reset";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

import { createOrgUnit, createUserWithPassword } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Manager-triggered password reset (Task 11.7).
//
// **The manager cannot set a password.** They only say "send reset link";
// the link goes to the staff member's own email and the person sets the password themselves.
//
// Rationale: A password set by a manager is a password known to the manager. From that moment on,
// the answer to "who wrote this record" ceases to be definitive, reducing audit trail value.
// Reset email breaks this linkage.

const NOW = new Date("2026-08-22T09:00:00.000Z");
const SECRET = "secret-key-of-at-least-thirty-two-characters-long";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupUser() {
  const unit = await createOrgUnit({ name: "Tooling Shop", type: "Root" });
  return createUserWithPassword(unit.id, "old-password-1234", {
    fullName: "Jane Doe",
  });
}

describe("reset trigger", () => {
  it("queues password reset event in notification queue", async () => {
    const user = await setupUser();

    const result = await sendPasswordResetForUser(testDb, user.id, NOW, SECRET);

    expect(result.ok).toBe(true);
    const queue = await testDb.notificationQueue.findMany({
      where: { userId: user.id },
    });
    expect(queue.map((k) => k.eventType)).toContain(
      NOTIFICATION_EVENTS.passwordReset,
    );
  });

  // Password **does not change**: trigger only sends a link. Manager's trigger
  // must not terminate the user's session or interrupt their work.
  it("does not alter current password or session", async () => {
    const user = await setupUser();
    const before = await testDb.userCredential.findUnique({
      where: { userId: user.id },
    });

    await sendPasswordResetForUser(testDb, user.id, NOW, SECRET);

    const after = await testDb.userCredential.findUnique({
      where: { userId: user.id },
    });
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(after?.version).toBe(before?.version);
  });

  it("is not triggered for inactive user", async () => {
    const user = await setupUser();
    await testDb.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    const result = await sendPasswordResetForUser(testDb, user.id, NOW, SECRET);

    expect(result.ok).toBe(false);
    expect(
      await testDb.notificationQueue.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it("is not triggered for nonexistent user", async () => {
    const result = await sendPasswordResetForUser(
      testDb,
      "3f2a9c1e-0000-4000-8000-000000000009",
      NOW,
      SECRET,
    );

    expect(result.ok).toBe(false);
  });
});
