import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Başlangıca dönüş eylemi de gerçek FormData ile sınanır. Sayfadaki yetki
// uyarısı kaldırılmış olsa bile eylem, sistem yöneticisi olmayan isteği
// çalıştırmamalıdır.
const { oturum } = vi.hoisted(() => ({
  oturum: {
    kisi: null as { id: string; isSystemAdmin: boolean } | null,
  },
}));

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: async () => oturum.kisi,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/server/db", async () => {
  const { testDb } = await import("../helpers/test-db");
  return { prisma: testDb };
});

const { requestSystemResetAction } = await import(
  "@/app/admin/settings/reset/actions"
);

import { createOrgUnit, createUserWithPassword } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
  oturum.kisi = null;
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function admin() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const user = await createUserWithPassword(root.id, "mevcut-parola-123", {
    fullName: "Mevcut Sistem Yöneticisi",
    email: "mevcut-reset@ornek.test",
    isSystemAdmin: true,
  });
  oturum.kisi = { id: user.id, isSystemAdmin: true };
  return user;
}

function resetForm(confirmation: string): FormData {
  const form = new FormData();
  form.set("currentPassword", "mevcut-parola-123");
  form.set("bootstrapFullName", "Yeni Başlangıç Yöneticisi");
  form.set("bootstrapEmail", "yeni-reset@ornek.test");
  form.set("bootstrapPassword", "yeni-baslangic-parolasi-123");
  form.set("bootstrapPasswordRepeat", "yeni-baslangic-parolasi-123");
  form.set("confirmation", confirmation);
  return form;
}

describe("başlangıca dönüş sunucu eylemi", () => {
  it("geçersiz onay metninde istek oluşturmaz", async () => {
    await admin();

    const result = await requestSystemResetAction(
      { error: null, success: null },
      resetForm("BAŞLANGICA DON"),
    );

    expect(result.error).toContain("BAŞLANGICA DÖN yazın");
    expect(await testDb.systemResetRequest.count()).toBe(0);
  });

  it("geçerli FormData ile bekleyen istek oluşturur", async () => {
    const actor = await admin();

    const result = await requestSystemResetAction(
      { error: null, success: null },
      resetForm("BAŞLANGICA DÖN"),
    );

    expect(result).toEqual({
      error: null,
      success:
        "İstek sıraya alındı. Önce yedek alınacak; işlem başladığında mevcut oturumlar kapatılacak.",
    });
    await expect(testDb.systemResetRequest.findFirstOrThrow()).resolves.toMatchObject({
      requestedById: actor.id,
      status: "PENDING",
      bootstrapEmail: "yeni-reset@ornek.test",
      bootstrapPasswordHash: expect.not.stringContaining("yeni-baslangic-parolasi-123"),
    });
  });

  it("sistem yöneticisi olmayan kullanıcı eylemi çalıştıramaz", async () => {
    const actor = await admin();
    oturum.kisi = { id: actor.id, isSystemAdmin: false };

    await expect(
      requestSystemResetAction(
        { error: null, success: null },
        resetForm("BAŞLANGICA DÖN"),
      ),
    ).rejects.toThrow("sistem yöneticisi");
    expect(await testDb.systemResetRequest.count()).toBe(0);
  });
});
