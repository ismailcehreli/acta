import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("parola özeti", () => {
  it("düz parolayı saklamaz, Argon2id özeti üretir", async () => {
    const hash = await hashPassword("dogru-parola-123");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("dogru-parola-123");
  });

  it("aynı parola her seferinde farklı özet üretir (tuz)", async () => {
    const first = await hashPassword("dogru-parola-123");
    const second = await hashPassword("dogru-parola-123");

    expect(first).not.toBe(second);
  });

  it("doğru parola doğrulanır", async () => {
    const hash = await hashPassword("dogru-parola-123");

    expect(await verifyPassword(hash, "dogru-parola-123")).toBe(true);
  });

  it("yanlış parola doğrulanmaz", async () => {
    const hash = await hashPassword("dogru-parola-123");

    expect(await verifyPassword(hash, "yanlis-parola-123")).toBe(false);
  });

  it("bozuk özet hata fırlatmaz, eşleşmedi sayılır", async () => {
    expect(await verifyPassword("bozuk-veri", "herhangi-parola")).toBe(false);
  });
});
