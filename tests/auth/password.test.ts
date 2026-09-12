import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("password hashing", () => {
  it("does not store plain password, produces Argon2id hash", async () => {
    const hash = await hashPassword("correct-password-123");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("correct-password-123");
  });

  it("same password produces different hash every time (salt)", async () => {
    const first = await hashPassword("correct-password-123");
    const second = await hashPassword("correct-password-123");

    expect(first).not.toBe(second);
  });

  it("correct password verifies successfully", async () => {
    const hash = await hashPassword("correct-password-123");

    expect(await verifyPassword(hash, "correct-password-123")).toBe(true);
  });

  it("incorrect password fails verification", async () => {
    const hash = await hashPassword("correct-password-123");

    expect(await verifyPassword(hash, "wrong-password-123")).toBe(false);
  });

  it("corrupted hash does not throw error, treated as mismatch", async () => {
    expect(await verifyPassword("corrupted-data", "any-password")).toBe(false);
  });
});
