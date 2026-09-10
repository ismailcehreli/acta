import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createSession, findActiveSession } from "@/server/auth/session";
import {
  deactivateUser,
  findSubordinates,
  reactivateUser,
} from "@/server/users/deactivate";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §4.6: pasifleştirme, kişinin üzerinde açık iş varken engellenir. Engel
// listesi sistem yöneticisine gösterilir; hiçbiri sessizce atlanmaz.

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function twoLevelTree() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const department = await createOrgUnit({
    name: "Kalıphane",
    type: "Departman",
    parentId: root.id,
  });
  return { root, department };
}

describe("engelsiz pasifleştirme", () => {
  it("üzerinde açık iş olmayan kullanıcı pasifleştirilir", async () => {
    const { department } = await twoLevelTree();
    const user = await createUser(department.id);

    const result = await deactivateUser(testDb, user.id, NOW);

    expect(result.ok).toBe(true);
    const stored = await testDb.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    // Kayıt silinmez, yalnızca bayrağı düşer (§16.6).
    expect(stored.isActive).toBe(false);
  });

  it("pasifleştirilen kişinin açık oturumları kapanır", async () => {
    const { department } = await twoLevelTree();
    const user = await createUser(department.id);
    const session = await createSession(testDb, user.id, NOW);

    const result = await deactivateUser(testDb, user.id, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revokedSessionCount).toBe(1);
    expect(await findActiveSession(testDb, session.token, NOW)).toBeNull();
  });

  it("yöneticilik bayrağı düşer, birime yeni yönetici atanabilir", async () => {
    const { department } = await twoLevelTree();
    const manager = await createUser(department.id, { isUnitManager: true });

    await deactivateUser(testDb, manager.id, NOW);

    // Bayrak kalsaydı, birim başına tek yönetici kısıtı yeni atamayı
    // engellerdi (§4.2).
    const replacement = await createUser(department.id, {
      isUnitManager: true,
    });
    expect(replacement.isUnitManager).toBe(true);
  });

  it("faaliyeti olan kullanıcı pasifleştirilebilir — geçmiş kayıt engel değil", async () => {
    const { department } = await twoLevelTree();
    const user = await createUser(department.id);
    await createActivity(user);

    const result = await deactivateUser(testDb, user.id, NOW);

    expect(result.ok).toBe(true);
  });
});

describe("açık konuşma engeli", () => {
  async function openConversation(
    askerId: string,
    responsibleId: string,
    activityAuthor: { id: string; orgUnitId: string },
  ) {
    const activity = await createActivity(activityAuthor);
    return testDb.conversation.create({
      data: { activityId: activity.id, askerId, responsibleId },
    });
  }

  it("cevap bekleyen sorunun sorumlusu pasifleştirilemez", async () => {
    const { root, department } = await twoLevelTree();
    const asker = await createUser(root.id);
    const responsible = await createUser(department.id);
    await openConversation(asker.id, responsible.id, responsible);

    const result = await deactivateUser(testDb, responsible.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "blocked") return;
    expect(result.blockers.openConversationCount).toBe(1);
  });

  it("soruyu soran kişi de pasifleştirilemez", async () => {
    const { root, department } = await twoLevelTree();
    const asker = await createUser(root.id);
    const responsible = await createUser(department.id);
    await openConversation(asker.id, responsible.id, responsible);

    const result = await deactivateUser(testDb, asker.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "blocked") return;
    expect(result.blockers.openConversationCount).toBe(1);
  });

  it("konuşma kapandıktan sonra pasifleştirme serbesttir", async () => {
    const { root, department } = await twoLevelTree();
    const asker = await createUser(root.id);
    const responsible = await createUser(department.id);
    const conversation = await openConversation(
      asker.id,
      responsible.id,
      responsible,
    );

    await testDb.conversation.update({
      where: { id: conversation.id },
      data: { status: "CLOSED", closedAt: NOW, closedById: asker.id },
    });

    const result = await deactivateUser(testDb, responsible.id, NOW);
    expect(result.ok).toBe(true);
  });
});

describe("altındaki kullanıcı engeli", () => {
  it("ekibi olan yönetici pasifleştirilemez ve ekip listelenir", async () => {
    const { department } = await twoLevelTree();
    const manager = await createUser(department.id, {
      isUnitManager: true,
      fullName: "Departman Müdürü",
    });
    await createUser(department.id, { fullName: "Ekip Üyesi" });

    const result = await deactivateUser(testDb, manager.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "blocked") return;
    expect(result.blockers.subordinates.map((s) => s.fullName)).toEqual([
      "Ekip Üyesi",
    ]);
  });

  it("alt birimdeki kullanıcılar da yöneticiye bağlı sayılır", async () => {
    const { root, department } = await twoLevelTree();
    const director = await createUser(root.id, {
      isUnitManager: true,
      fullName: "Direktör",
    });
    // Departmanın kendi yöneticisi yok; kişi zincirde direktöre bağlanır.
    await createUser(department.id, { fullName: "Departman Çalışanı" });

    const result = await deactivateUser(testDb, director.id, NOW);

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "blocked") return;
    expect(result.blockers.subordinates.map((s) => s.fullName)).toEqual([
      "Departman Çalışanı",
    ]);
  });

  it("ekip devredildikten sonra pasifleştirme serbesttir", async () => {
    const { root, department } = await twoLevelTree();
    const director = await createUser(root.id, { isUnitManager: true });
    const outgoing = await createUser(department.id, { isUnitManager: true });
    const member = await createUser(department.id);

    // Ekip üyesi başka bir yöneticinin altına taşınır.
    await testDb.user.update({
      where: { id: member.id },
      data: { orgUnitId: root.id },
    });

    const result = await deactivateUser(testDb, outgoing.id, NOW);

    expect(result.ok).toBe(true);
    expect(await findSubordinates(testDb, director)).toHaveLength(1);
  });

  it("yönetici olmayan kişinin altında kimse aranmaz", async () => {
    const { department } = await twoLevelTree();
    const worker = await createUser(department.id);

    expect(await findSubordinates(testDb, worker)).toEqual([]);
  });
});

describe("bilinmeyen kullanıcı", () => {
  it("olmayan kullanıcı pasifleştirilemez", async () => {
    const result = await deactivateUser(
      testDb,
      "00000000-0000-0000-0000-000000000000",
      NOW,
    );

    expect(result).toEqual({ ok: false, reason: "user_not_found" });
  });
});

describe("aktifleştirme", () => {
  it("pasifleştirilen kullanıcı geri açılır", async () => {
    const { department } = await twoLevelTree();
    const user = await createUser(department.id);

    await deactivateUser(testDb, user.id, NOW);
    const sonuc = await reactivateUser(testDb, user.id, NOW);

    expect(sonuc.ok).toBe(true);
    const stored = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.isActive).toBe(true);
  });

  it("yöneticilik bayrağı geri verilmez", async () => {
    const { department } = await twoLevelTree();
    const manager = await createUser(department.id, { isUnitManager: true });

    await deactivateUser(testDb, manager.id, NOW);
    await reactivateUser(testDb, manager.id, NOW);

    const stored = await testDb.user.findUniqueOrThrow({ where: { id: manager.id } });
    // Boşluğa başka biri atanmış olabilir; bayrağı sessizce geri vermek bir
    // birimde iki yönetici oluşturmayı denemek olurdu (§4.2).
    expect(stored.isUnitManager).toBe(false);
  });

  it("birimi pasif olan kullanıcı açılamaz", async () => {
    const { department } = await twoLevelTree();
    const user = await createUser(department.id);

    await deactivateUser(testDb, user.id, NOW);
    await testDb.orgUnit.update({
      where: { id: department.id },
      data: { isActive: false },
    });

    const sonuc = await reactivateUser(testDb, user.id, NOW);

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.reason).toBe("inactive_org_unit");

    const stored = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.isActive).toBe(false);
  });

  it("zaten aktif kullanıcı reddedilir", async () => {
    const { department } = await twoLevelTree();
    const user = await createUser(department.id);

    const sonuc = await reactivateUser(testDb, user.id, NOW);

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.reason).toBe("already_active");
  });

  it("olmayan kullanıcı reddedilir", async () => {
    const sonuc = await reactivateUser(
      testDb,
      "00000000-0000-4000-8000-000000000000",
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.reason).toBe("user_not_found");
  });

  it("eski parola çalışmaya devam eder", async () => {
    const { department } = await twoLevelTree();
    const { createUserWithPassword } = await import("../helpers/fixtures");
    const { login } = await import("@/server/auth/login");

    const user = await createUserWithPassword(department.id, "ilk-parola-1234", {
      email: "geri@ornek.test",
    });

    await deactivateUser(testDb, user.id, NOW);
    await reactivateUser(testDb, user.id, NOW);

    // Pasifleştirme yalnız oturumları iptal etmişti; kimlik bilgisi duruyor.
    const sonuc = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.9", sleep: async () => {} },
      { email: "geri@ornek.test", password: "ilk-parola-1234" },
    );

    expect(sonuc.ok).toBe(true);
  });
});
