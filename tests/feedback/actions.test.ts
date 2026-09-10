import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Bu testler gerçek FormData'yı sunucu eylemlerine verir. Ekranın yönetim
// sekmesini gizlemesi tek başına güvenlik kanıtı değildir; yetkisiz çağrı
// doğrudan eyleme geldiğinde de veri değişmemelidir.
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

const {
  archiveFeedbackAction,
  createFeedbackAction,
  markFeedbackReadAction,
  updateFeedbackAction,
} = await import("@/app/feedback/actions");

import { createFeedback } from "@/server/feedback/service";

import { createOrgUnit, createUser as seedUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-09-02T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  oturum.kisi = null;
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function users() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const admin = await seedUser(root.id, {
    fullName: "Sistem Yöneticisi",
    email: "admin-feedback@ornek.test",
    isSystemAdmin: true,
  });
  const manager = await seedUser(root.id, {
    fullName: "Birim Müdürü",
    email: "mudur-feedback@ornek.test",
    isUnitManager: true,
  });
  const employee = await seedUser(root.id, {
    fullName: "Geri Bildirim Gönderen",
    email: "calisan-feedback@ornek.test",
  });

  return { admin, manager, employee };
}

function createForm(): FormData {
  const form = new FormData();
  form.set("category", "BUG");
  form.set("title", "Arama ekranı açılmıyor");
  form.set("description", "Arama ekranına girdiğimde sonuçlar görünmüyor.");
  form.set("sourcePath", "Arama");
  return form;
}

function updateForm(id: string): FormData {
  const form = new FormData();
  form.set("id", id);
  form.set("status", "RESOLVED");
  form.set("response", "Düzeltme yayınlandı.");
  return form;
}

function idForm(id: string): FormData {
  const form = new FormData();
  form.set("id", id);
  return form;
}

describe("feedback sunucu eylemleri", () => {
  it("kullanıcı gerçek FormData ile geri bildirim oluşturur", async () => {
    const { employee } = await users();
    oturum.kisi = { id: employee.id, isSystemAdmin: false };

    const result = await createFeedbackAction(
      { error: null, success: null },
      createForm(),
    );

    expect(result).toEqual({
      error: null,
      success: "Geri bildiriminiz kaydedildi. Durumunu bu sayfadan takip edebilirsiniz.",
    });
    const stored = await testDb.feedback.findFirstOrThrow({
      where: { submittedById: employee.id },
    });
    expect(stored.title).toBe("Arama ekranı açılmıyor");
  });

  it("yönetici olmayan kullanıcı yönetim eylemlerini elle çağıramaz", async () => {
    const { manager, employee } = await users();
    const created = await createFeedback(
      testDb,
      employee.id,
      {
        category: "BUG",
        title: "Arama ekranı açılmıyor",
        description: "Arama ekranına girdiğimde sonuçlar görünmüyor.",
      },
      NOW,
    );
    if (!created.ok) throw new Error("Geri bildirim kurulamadı");

    oturum.kisi = { id: manager.id, isSystemAdmin: false };

    const update = await updateFeedbackAction(
      { error: null, success: null },
      updateForm(created.feedback.id),
    );
    expect(update.error).toContain("yönetici yetkisi");

    await markFeedbackReadAction(idForm(created.feedback.id));
    await archiveFeedbackAction(idForm(created.feedback.id));

    const unchanged = await testDb.feedback.findUniqueOrThrow({
      where: { id: created.feedback.id },
    });
    expect(unchanged.status).toBe("NEW");
    expect(unchanged.readAt).toBeNull();
    expect(unchanged.archivedAt).toBeNull();
  });

  it("sistem yöneticisi yönetim eylemiyle kaydı çözer", async () => {
    const { admin, employee } = await users();
    const created = await createFeedback(
      testDb,
      employee.id,
      {
        category: "SUGGESTION",
        title: "Kısa öneri",
        description: "Bu öneri yönetim ekranından güncellenecek.",
      },
      NOW,
    );
    if (!created.ok) throw new Error("Geri bildirim kurulamadı");

    oturum.kisi = { id: admin.id, isSystemAdmin: true };
    const result = await updateFeedbackAction(
      { error: null, success: null },
      updateForm(created.feedback.id),
    );

    expect(result).toEqual({
      error: null,
      success: "Geri bildirim güncellendi.",
    });
    await expect(
      testDb.feedback.findUniqueOrThrow({ where: { id: created.feedback.id } }),
    ).resolves.toMatchObject({
      status: "RESOLVED",
      response: "Düzeltme yayınlandı.",
      resolvedById: admin.id,
    });
  });
});
