import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  archiveFeedback,
  countManageableFeedback,
  createFeedback,
  listManageableFeedback,
  listOwnFeedback,
  markFeedbackRead,
  updateFeedback,
} from "@/server/feedback/service";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-28T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function users() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const a = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const b = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const admin = await createUser(kok.id, {
    fullName: "Sistem Yöneticisi",
    isSystemAdmin: true,
  });
  const managerA = await createUser(a.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const employeeA = await createUser(a.id, { fullName: "Kalıphane Çalışanı" });
  const managerB = await createUser(b.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });
  const employeeB = await createUser(b.id, { fullName: "Planlama Çalışanı" });

  return { admin, managerA, employeeA, managerB, employeeB };
}

const feedback = {
  category: "SUGGESTION" as const,
  title: "Arama daha kolay olsun",
  description: "Arama kutusunda son kullanılan filtreleri görmek istiyorum.",
  sourcePath: "Arama",
  adminsOnly: false,
};

describe("geri bildirim", () => {
  it("kullanıcı kayıt oluşturur ve yalnız kendi kayıtlarını görür", async () => {
    const { employeeA, employeeB } = await users();

    const result = await createFeedback(testDb, employeeA.id, feedback, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.feedback.submittedByName).toBe("Kalıphane Çalışanı");
    expect(result.feedback.submittedByUnitName).toBe("Kalıphane");
    expect(result.feedback.status).toBe("NEW");
    expect(await listOwnFeedback(testDb, employeeA.id)).toHaveLength(1);
    expect(await listOwnFeedback(testDb, employeeB.id)).toHaveLength(0);
  });

  it("HTML içeren metinleri kabul etmez", async () => {
    const { employeeA } = await users();

    const result = await createFeedback(
      testDb,
      employeeA.id,
      { ...feedback, description: "<script>alert('x')</script>" },
      NOW,
    );

    expect(result).toEqual({
      ok: false,
      error: "invalid",
      message: "Başlık ve açıklama geçerli uzunlukta olmalı; HTML kullanılamaz.",
    });
  });

  it("yalnız sistem yöneticisi tüm açık kayıtları yönetir", async () => {
    const { managerA, managerB, employeeA, employeeB, admin } = await users();
    await createFeedback(testDb, employeeA.id, feedback, NOW);
    await createFeedback(testDb, employeeB.id, feedback, NOW);

    expect(await listManageableFeedback(testDb, managerA.id)).toHaveLength(0);
    expect(await listManageableFeedback(testDb, managerB.id)).toHaveLength(0);
    expect(await listManageableFeedback(testDb, admin.id)).toHaveLength(2);
  });

  it("yönetilebilir yeni geri bildirimleri yetki kapsamına göre sayar", async () => {
    const { managerA, employeeA, employeeB, admin } = await users();
    await createFeedback(testDb, employeeA.id, feedback, NOW);
    await createFeedback(testDb, employeeB.id, feedback, NOW);

    expect(await countManageableFeedback(testDb, managerA.id)).toBe(0);
    expect(await countManageableFeedback(testDb, admin.id)).toBe(2);
  });

  it("yalnız sistem yöneticilerine özel kayıt birim yöneticisine görünmez", async () => {
    const { managerA, employeeA, admin } = await users();
    const result = await createFeedback(
      testDb,
      employeeA.id,
      { ...feedback, adminsOnly: true },
      NOW,
    );
    expect(result.ok).toBe(true);

    expect(await listManageableFeedback(testDb, managerA.id)).toHaveLength(0);
    expect(await listManageableFeedback(testDb, admin.id)).toHaveLength(1);
  });

  it("okuma, inceleme ve çözüm bilgilerini kaydeder; kullanıcıya bildirim bırakır", async () => {
    const { admin, employeeA } = await users();
    const created = await createFeedback(testDb, employeeA.id, feedback, NOW);
    if (!created.ok) throw new Error("Geri bildirim kurulamadı");

    expect(await markFeedbackRead(testDb, admin.id, created.feedback.id, NOW)).toEqual({
      ok: true,
    });

    const inReview = await updateFeedback(
      testDb,
      admin.id,
      created.feedback.id,
      { status: "IN_REVIEW", response: "İncelemeye aldık." },
      NOW,
    );
    expect(inReview.ok).toBe(true);
    if (!inReview.ok) return;
    expect(inReview.feedback).toMatchObject({
      status: "IN_REVIEW",
      response: "İncelemeye aldık.",
      readByName: "Sistem Yöneticisi",
      reviewedByName: "Sistem Yöneticisi",
    });
    expect(inReview.feedback.readAt).not.toBeNull();
    expect(inReview.feedback.reviewedAt).not.toBeNull();

    const resolved = await updateFeedback(
      testDb,
      admin.id,
      created.feedback.id,
      { status: "RESOLVED", response: "Düzenleme tamamlandı." },
      new Date("2026-08-29T09:00:00.000Z"),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.feedback).toMatchObject({
      status: "RESOLVED",
      response: "Düzenleme tamamlandı.",
      resolvedByName: "Sistem Yöneticisi",
    });
    expect(resolved.feedback.resolvedAt).not.toBeNull();

    const notices = await testDb.notificationQueue.findMany({
      where: {
        userId: employeeA.id,
        eventType: NOTIFICATION_EVENTS.feedbackStatusChanged,
      },
    });
    expect(notices.length).toBe(2);
  });

  it("birim yöneticisi güncelleyemez; sistem yöneticisi kayıt arşivleyebilir", async () => {
    const { admin, managerB, employeeA } = await users();
    const created = await createFeedback(testDb, employeeA.id, feedback, NOW);
    if (!created.ok) throw new Error("Geri bildirim kurulamadı");

    const denied = await updateFeedback(
      testDb,
      managerB.id,
      created.feedback.id,
      { status: "IN_REVIEW", response: "" },
      NOW,
    );
    expect(denied.ok).toBe(false);

    expect(await archiveFeedback(testDb, admin.id, created.feedback.id, NOW)).toEqual({
      ok: true,
    });
    expect(await listManageableFeedback(testDb, admin.id)).toHaveLength(0);
    expect(await listOwnFeedback(testDb, employeeA.id)).toHaveLength(0);
  });
});
