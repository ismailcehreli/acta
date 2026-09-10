import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, updateActivity } from "@/server/activities/write";
import { cancelActivity } from "@/server/activities/cancel";
import { AUDIT_ACTIONS, AUDIT_OBJECTS } from "@/server/audit/log";
import { changePassword } from "@/server/auth/change-password";
import { login } from "@/server/auth/login";
import { requestPasswordReset, resetPassword } from "@/server/auth/reset";
import { addHoliday, removeHoliday, saveWorkCalendar } from "@/server/calendar/settings";
import { DEFAULT_WORK_CALENDAR } from "@/server/calendar/settings";
import {
  askQuestion,
  closeConversation,
  replyToConversation,
} from "@/server/conversations/service";
import {
  createOrgUnit,
  deactivateOrgUnit,
  moveOrgUnit,
  reactivateOrgUnit,
  updateOrgUnit,
} from "@/server/org/tree";
import { saveSmtpSettings } from "@/server/settings/smtp";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";
import { createUser } from "@/server/users/create";
import { deactivateUser, reactivateUser } from "@/server/users/deactivate";
import { setUserPassword, updateUser } from "@/server/users/update";

import { resetDatabase, testDb } from "../helpers/test-db";

// Denetim izi (§15.2). Bu dosya listedeki **her** işlem türü için kaydın
// atıldığını sınar; ayrıca kaydın değiştirilemediğini ve okuma verisinin
// kapsam dışı kaldığını (§10.3) doğrular.

const NOW = new Date("2026-08-18T09:00:00.000Z");
const PAROLA = "deneme-parola-1234";
const SECRET = "test-icin-en-az-otuz-iki-karakterlik-anahtar";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kayitlar(action?: string) {
  return testDb.auditLog.findMany({
    where: action ? { action } : undefined,
    orderBy: { createdAt: "asc" },
  });
}

async function sirket() {
  const kok = await createOrgUnit(
    testDb,
    { name: "Şirket", type: "Kök", parentId: null, sortOrder: 0, requiresApproval: false, autoFlowsUp: true, attentionGroupId: null },
    null,
    NOW,
  );
  if (!kok.ok) throw new Error("kurulum");

  const admin = await createUser(
    testDb,
    {
      fullName: "Sistem Yöneticisi",
      email: "admin@ornek.test",
      orgUnitId: kok.value.id,
      isUnitManager: true,
      isSystemAdmin: true,
      writesActivities: true,
      initialPassword: PAROLA,
    },
    null,
    NOW,
  );
  if (!admin.ok) throw new Error("kurulum");

  return { kok: kok.value, admin: admin.user };
}

describe("organizasyon ve kullanıcı işlemleri", () => {
  it("birim açma, taşıma ve pasifleştirme kayda geçer", async () => {
    const { kok, admin } = await sirket();

    const alt = await createOrgUnit(
      testDb,
      { name: "Kalıphane", type: "Departman", parentId: kok.id, sortOrder: 0, requiresApproval: false, autoFlowsUp: true, attentionGroupId: null },
      admin.id,
      NOW,
    );
    if (!alt.ok) throw new Error("kurulum");

    const ara = await createOrgUnit(
      testDb,
      { name: "Genel Müdürlük", type: "GM", parentId: kok.id, sortOrder: 0, requiresApproval: false, autoFlowsUp: true, attentionGroupId: null },
      admin.id,
      NOW,
    );
    if (!ara.ok) throw new Error("kurulum");

    await moveOrgUnit(testDb, { id: alt.value.id, newParentId: ara.value.id }, admin.id, NOW);
    await deactivateOrgUnit(testDb, alt.value.id, admin.id, NOW);

    expect(await kayitlar(AUDIT_ACTIONS.orgUnitCreated)).toHaveLength(3);
    const tasima = await kayitlar(AUDIT_ACTIONS.orgUnitMoved);
    expect(tasima).toHaveLength(1);
    expect(tasima[0].detail).toEqual({
      fromParentId: kok.id,
      toParentId: ara.value.id,
    });
    expect(await kayitlar(AUDIT_ACTIONS.orgUnitDeactivated)).toHaveLength(1);
  });

  it("birim ve kullanıcı aktifleştirme kayda geçer", async () => {
    const { kok, admin } = await sirket();

    const birim = await createOrgUnit(
      testDb,
      {
        name: "Kapanan Birim",
        type: "Ekip",
        parentId: kok.id,
        sortOrder: 0,
        requiresApproval: false,
        autoFlowsUp: true,
        attentionGroupId: null,
      },
      admin.id,
      NOW,
    );
    if (!birim.ok) throw new Error("kurulum");

    await deactivateOrgUnit(testDb, birim.value.id, admin.id, NOW);
    await reactivateOrgUnit(testDb, birim.value.id, admin.id, NOW);

    const birimKaydi = await kayitlar(AUDIT_ACTIONS.orgUnitReactivated);
    expect(birimKaydi).toHaveLength(1);
    expect(birimKaydi[0].userId).toBe(admin.id);

    const kisi = await createUser(testDb, {
      fullName: "Geri Dönen",
      email: "geri@ornek.test",
      orgUnitId: kok.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: "ilk-parola-1234",
    });
    if (!kisi.ok) throw new Error("kurulum");

    await deactivateUser(testDb, kisi.user.id, NOW, admin.id);
    await reactivateUser(testDb, kisi.user.id, NOW, admin.id);

    const kisiKaydi = await kayitlar(AUDIT_ACTIONS.userReactivated);
    expect(kisiKaydi).toHaveLength(1);
    expect(kisiKaydi[0].userId).toBe(admin.id);
    expect(kisiKaydi[0].objectId).toBe(kisi.user.id);
  });

  it("birim düzenleme kayda geçer ve yalnız değişen alanları yazar", async () => {
    const { kok, admin } = await sirket();

    const birim = await createOrgUnit(
      testDb,
      {
        name: "Yanlış Ad",
        type: "Ekip",
        parentId: kok.id,
        sortOrder: 0,
        requiresApproval: false,
        autoFlowsUp: true,
        attentionGroupId: null,
      },
      admin.id,
      NOW,
    );
    if (!birim.ok) throw new Error("kurulum");

    await updateOrgUnit(
      testDb,
      {
        id: birim.value.id,
        name: "Kalıphane",
        type: "Ekip",
        requiresApproval: true,
        autoFlowsUp: true,
        attentionGroupId: null,
      },
      admin.id,
      NOW,
    );

    const kayit = await kayitlar(AUDIT_ACTIONS.orgUnitUpdated);
    expect(kayit).toHaveLength(1);
    expect(kayit[0].userId).toBe(admin.id);
    // Değişmeyen alanlar kayda girmez: "neyi değiştirdi" sorusunun cevabı
    // gürültüyle karışmamalı.
    expect(kayit[0].detail).toEqual({
      changed: {
        name: { onceki: "Yanlış Ad", sonraki: "Kalıphane" },
        requiresApproval: { onceki: false, sonraki: true },
      },
    });
  });

  it("hiçbir alan değişmediyse denetim izine kayıt düşmez", async () => {
    const { kok, admin } = await sirket();

    const birim = await createOrgUnit(
      testDb,
      {
        name: "Kalıphane",
        type: "Departman",
        parentId: kok.id,
        sortOrder: 0,
        requiresApproval: false,
        autoFlowsUp: true,
        attentionGroupId: null,
      },
      admin.id,
      NOW,
    );
    if (!birim.ok) throw new Error("kurulum");

    const sonuc = await updateOrgUnit(
      testDb,
      {
        id: birim.value.id,
        name: "Kalıphane",
        type: "Departman",
        requiresApproval: false,
        autoFlowsUp: true,
        attentionGroupId: null,
      },
      admin.id,
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    expect(await kayitlar(AUDIT_ACTIONS.orgUnitUpdated)).toHaveLength(0);
  });

  it("kullanıcı ekleme, düzenleme, parola ve pasifleştirme kayda geçer", async () => {
    const { kok, admin } = await sirket();

    const kisi = await createUser(
      testDb,
      {
        fullName: "Deneme Kişi",
        email: "kisi@ornek.test",
        orgUnitId: kok.id,
        isUnitManager: false,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: PAROLA,
      },
      admin.id,
      NOW,
    );
    if (!kisi.ok) throw new Error("kurulum");

    await updateUser(
      testDb,
      {
        id: kisi.user.id,
        fullName: "Yeni Ad",
        email: "yeni@ornek.test",
        orgUnitId: kok.id,
        isUnitManager: false,
        isSystemAdmin: true,
        writesActivities: true,
      },
      admin.id,
      NOW,
    );

    await setUserPassword(testDb, kisi.user.id, "yeni-parola-5678", NOW, admin.id);
    await deactivateUser(testDb, kisi.user.id, NOW, admin.id);

    // Kurulumdaki yönetici de sayıldığı için iki kayıt.
    expect(await kayitlar(AUDIT_ACTIONS.userCreated)).toHaveLength(2);

    const duzenleme = await kayitlar(AUDIT_ACTIONS.userUpdated);
    expect(duzenleme).toHaveLength(1);
    // Yetki değişikliği eski ve yeni hâliyle görünür (§15.2).
    const detay = duzenleme[0].detail as {
      before: { isSystemAdmin: boolean };
      after: { isSystemAdmin: boolean };
    };
    expect(detay.before.isSystemAdmin).toBe(false);
    expect(detay.after.isSystemAdmin).toBe(true);

    expect(await kayitlar(AUDIT_ACTIONS.userPasswordSet)).toHaveLength(1);
    expect(await kayitlar(AUDIT_ACTIONS.userDeactivated)).toHaveLength(1);
  });

  it("parola hiçbir kayda düz metin olarak girmez", async () => {
    const { kok, admin } = await sirket();
    const kisi = await createUser(
      testDb,
      {
        fullName: "Deneme Kişi",
        email: "kisi@ornek.test",
        orgUnitId: kok.id,
        isUnitManager: false,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: "cok-gizli-parola-9999",
      },
      admin.id,
      NOW,
    );
    if (!kisi.ok) throw new Error("kurulum");

    await setUserPassword(testDb, kisi.user.id, "baska-gizli-parola-8888", NOW, admin.id);

    const hepsi = JSON.stringify(await kayitlar());
    expect(hepsi).not.toContain("cok-gizli-parola-9999");
    expect(hepsi).not.toContain("baska-gizli-parola-8888");
  });
});

describe("faaliyet ve konuşma işlemleri", () => {
  async function faaliyetli() {
    const { kok, admin } = await sirket();
    const departman = await createOrgUnit(
      testDb,
      { name: "Kalıphane", type: "Departman", parentId: kok.id, sortOrder: 0, requiresApproval: false, autoFlowsUp: true, attentionGroupId: null },
      admin.id,
      NOW,
    );
    if (!departman.ok) throw new Error("kurulum");

    const yazar = await createUser(
      testDb,
      {
        fullName: "Kalıphane Müdürü",
        email: "mudur@ornek.test",
        orgUnitId: departman.value.id,
        isUnitManager: true,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: PAROLA,
      },
      admin.id,
      NOW,
    );
    if (!yazar.ok) throw new Error("kurulum");

    const faaliyet = await createActivity(
      testDb,
      { id: yazar.user.id, orgUnitId: departman.value.id, requiresApproval: false },
      {
        activityDate: "2026-08-18",
        title: "Kalıp bakımı",
        description: "Presteki kalıplar temizlendi.",
        targetDepartmentIds: [departman.value.id],
      },
      NOW,
    );
    if (!faaliyet.ok) throw new Error("kurulum");

    return { admin, yazar: yazar.user, faaliyet: faaliyet.activity, departman: departman.value };
  }

  it("faaliyet oluşturma ve revizyon kayda geçer", async () => {
    const { yazar, faaliyet, departman } = await faaliyetli();

    expect(await kayitlar(AUDIT_ACTIONS.activityCreated)).toHaveLength(1);

    await updateActivity(
      testDb,
      yazar.id,
      {
        id: faaliyet.id,
        activityDate: "2026-08-18",
        title: "Kalıp bakımı — düzeltildi",
        description: "Presteki kalıplar temizlendi ve ölçüldü.",
        targetDepartmentIds: [departman.id],
      },
      new Date(NOW.getTime() + 60_000),
    );

    const revizyon = await kayitlar(AUDIT_ACTIONS.activityRevised);
    expect(revizyon).toHaveLength(1);
    expect(revizyon[0].objectType).toBe(AUDIT_OBJECTS.activity);
    expect(revizyon[0].userId).toBe(yazar.id);
  });

  it("konuşma açma, cevap ve kapatma kayda geçer", async () => {
    const { admin, yazar, faaliyet } = await faaliyetli();

    const soru = await askQuestion(
      testDb,
      { id: admin.id, isSystemAdmin: true },
      { activityId: faaliyet.id, text: "Bu ne durumda?" },
      NOW,
    );
    if (!soru.ok) throw new Error(`soru: ${soru.message}`);

    await replyToConversation(
      testDb,
      { id: yazar.id, isSystemAdmin: false },
      { conversationId: soru.value.id, text: "Tamamlandı." },
      new Date(NOW.getTime() + 60_000),
    );

    await closeConversation(
      testDb,
      { id: admin.id, isSystemAdmin: true },
      soru.value.id,
      new Date(NOW.getTime() + 120_000),
    );

    expect(await kayitlar(AUDIT_ACTIONS.conversationOpened)).toHaveLength(1);
    expect(await kayitlar(AUDIT_ACTIONS.conversationReplied)).toHaveLength(1);
    expect(await kayitlar(AUDIT_ACTIONS.conversationClosed)).toHaveLength(1);
  });

  it("iptal kayda geçer ama gerekçe metni izde durmaz", async () => {
    const { yazar, faaliyet } = await faaliyetli();

    await cancelActivity(
      testDb,
      { id: yazar.id, isSystemAdmin: false },
      faaliyet.id,
      "Yanlış güne girildi.",
      new Date(NOW.getTime() + 60_000),
    );

    const iptal = await kayitlar(AUDIT_ACTIONS.activityCancelled);
    expect(iptal).toHaveLength(1);
    // Gerekçe metni denetim izinde **yok**: sistem yöneticisi izi görür ama
    // içeriğe erişemez (§15.1).
    expect(JSON.stringify(iptal[0].detail)).not.toContain("Yanlış güne girildi.");
  });
});

describe("oturum denemeleri (§15.3)", () => {
  it("başarılı giriş kayda geçer", async () => {
    const { admin } = await sirket();

    const sonuc = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep: async () => undefined },
      { email: admin.email, password: PAROLA },
    );
    expect(sonuc.ok).toBe(true);

    const kayit = await kayitlar(AUDIT_ACTIONS.loginSucceeded);
    expect(kayit).toHaveLength(1);
    expect(kayit[0].userId).toBe(admin.id);
    expect(kayit[0].ipAddress).toBe("10.0.0.1");
  });

  it("yanlış parola kayda geçer", async () => {
    const { admin } = await sirket();

    await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.2", sleep: async () => undefined },
      { email: admin.email, password: "yanlis-parola-1234" },
    );

    const kayit = await kayitlar(AUDIT_ACTIONS.loginFailed);
    expect(kayit).toHaveLength(1);
    expect(kayit[0].userId).toBe(admin.id);
    expect((kayit[0].detail as { reason: string }).reason).toBe("wrong_password");
  });

  it("kayıtsız e-posta denemesi de kayda geçer", async () => {
    await sirket();

    await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.3", sleep: async () => undefined },
      { email: "hic-yok@ornek.test", password: "deneme-parola-1234" },
    );

    const kayit = await kayitlar(AUDIT_ACTIONS.loginFailed);
    expect(kayit).toHaveLength(1);
    // Kullanıcı bilinmiyor; denenen adres ayrıntıda duruyor.
    expect(kayit[0].userId).toBeNull();
    expect((kayit[0].detail as { email: string }).email).toBe("hic-yok@ornek.test");
  });

  it("kilitlenme kayda geçer", async () => {
    const { admin } = await sirket();

    for (let i = 0; i < 10; i += 1) {
      await login(
        { db: testDb, now: NOW, rateLimitKey: `10.0.1.${i}`, sleep: async () => undefined },
        { email: admin.email, password: "yanlis-parola-1234" },
      );
    }

    expect(await kayitlar(AUDIT_ACTIONS.loginLocked)).toHaveLength(1);
  });

  it("parola değişimi ve sıfırlama kayda geçer", async () => {
    const { admin } = await sirket();

    await changePassword(
      { db: testDb, now: NOW },
      { userId: admin.id, currentPassword: PAROLA, newPassword: "yeni-parola-5678" },
    );
    expect(await kayitlar(AUDIT_ACTIONS.userPasswordChanged)).toHaveLength(1);

    await requestPasswordReset(testDb, admin.email, NOW, SECRET);
    const kuyruk = await testDb.notificationQueue.findFirstOrThrow({
      where: { eventType: "password_reset" },
    });
    const token = (kuyruk.payload as { token: string }).token;

    await resetPassword(testDb, token, "sifirlanan-parola-9999", NOW, SECRET);
    expect(await kayitlar(AUDIT_ACTIONS.userPasswordReset)).toHaveLength(1);
  });
});

describe("ayar değişiklikleri (§16.5)", () => {
  it("sistem ayarı değişimi eski ve yeni değerle kayda geçer", async () => {
    const { admin } = await sirket();

    await saveSettings(
      testDb,
      { [SETTING_KEYS.overdueAnswerBusinessDays]: "5" },
      admin.id,
      NOW,
    );

    const kayit = await kayitlar(AUDIT_ACTIONS.settingsChanged);
    expect(kayit).toHaveLength(1);
    const detay = kayit[0].detail as {
      changed: { key: string; before: string; after: string }[];
    };
    expect(detay.changed[0]).toEqual({
      key: SETTING_KEYS.overdueAnswerBusinessDays,
      before: "3",
      after: "5",
    });
  });

  it("değişiklik yoksa iz bırakılmaz", async () => {
    const { admin } = await sirket();

    await saveSettings(
      testDb,
      { [SETTING_KEYS.overdueAnswerBusinessDays]: "3" },
      admin.id,
      NOW,
    );

    // Aynı değeri yeniden kaydetmek denetim izini gürültüye boğmamalı.
    expect(await kayitlar(AUDIT_ACTIONS.settingsChanged)).toHaveLength(0);
  });

  it("takvim, tatil ve SMTP değişimi kayda geçer", async () => {
    const { admin } = await sirket();

    await saveWorkCalendar(testDb, DEFAULT_WORK_CALENDAR, admin.id, NOW);
    await addHoliday(testDb, { date: "2026-12-31", description: "Yılbaşı" }, admin.id, NOW);
    await removeHoliday(testDb, "2026-12-31", admin.id, NOW);
    await saveSmtpSettings(
      testDb,
      {
        host: "posta.ornek.test",
        port: 587,
        secure: false,
        user: "faaliyet",
        from: "faaliyet@ornek.test",
        password: "gizli-smtp-parolasi",
      },
      SECRET,
      admin.id,
      NOW,
    );

    expect(await kayitlar(AUDIT_ACTIONS.workCalendarChanged)).toHaveLength(1);
    expect(await kayitlar(AUDIT_ACTIONS.holidayAdded)).toHaveLength(1);
    expect(await kayitlar(AUDIT_ACTIONS.holidayRemoved)).toHaveLength(1);

    const smtp = await kayitlar(AUDIT_ACTIONS.smtpChanged);
    expect(smtp).toHaveLength(1);
    // SMTP parolası kayda geçmez; yalnız değiştirildiği bilgisi.
    expect(JSON.stringify(smtp[0].detail)).not.toContain("gizli-smtp-parolasi");
    expect((smtp[0].detail as { passwordChanged: boolean }).passwordChanged).toBe(true);
  });
});

describe("kaydın değişmezliği (§15.2)", () => {
  it("denetim kaydı güncellenemez ve silinemez", async () => {
    const { admin } = await sirket();
    const kayit = await testDb.auditLog.findFirstOrThrow();

    await expect(
      testDb.auditLog.update({
        where: { id: kayit.id },
        data: { action: "degistirildi" },
      }),
    ).rejects.toThrow(/AUDIT_LOG_IMMUTABLE|no_update|güncelle/i);

    await expect(
      testDb.auditLog.delete({ where: { id: kayit.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);

    expect(admin.id).toBeTruthy();
  });
});

describe("okuma verisi kapsam dışı (§10.3)", () => {
  it("faaliyeti okumak denetim kaydı üretmez", async () => {
    const { kok, admin } = await sirket();
    const departman = await createOrgUnit(
      testDb,
      { name: "Kalıphane", type: "Departman", parentId: kok.id, sortOrder: 0, requiresApproval: false, autoFlowsUp: true, attentionGroupId: null },
      admin.id,
      NOW,
    );
    if (!departman.ok) throw new Error("kurulum");

    const yazar = await createUser(
      testDb,
      {
        fullName: "Müdür",
        email: "mudur@ornek.test",
        orgUnitId: departman.value.id,
        isUnitManager: true,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: PAROLA,
      },
      admin.id,
      NOW,
    );
    if (!yazar.ok) throw new Error("kurulum");

    const faaliyet = await createActivity(
      testDb,
      { id: yazar.user.id, orgUnitId: departman.value.id, requiresApproval: false },
      {
        activityDate: "2026-08-18",
        title: "Kalıp bakımı",
        description: "Açıklama",
        targetDepartmentIds: [departman.value.id],
      },
      NOW,
    );
    if (!faaliyet.ok) throw new Error("kurulum");

    const oncekiSayi = (await kayitlar()).length;

    const { markActivityAsRead } = await import("@/server/reads/service");
    await markActivityAsRead(
      testDb,
      { id: admin.id, isSystemAdmin: true },
      faaliyet.activity.id,
      5_000,
      NOW,
    );

    // Okundu bilgisi bir kolaylık göstergesidir, adli kayıt değil (§10.3).
    expect((await kayitlar()).length).toBe(oncekiSayi);
  });
});

describe("denetim izi içerik taşımaz (§15.1)", () => {
  // Denetim izini sistem yöneticisi görür; sistem yöneticisinin içeriğe
  // erişimi yoktur. `detail` alanına başlık, açıklama, gerekçe ya da mesaj
  // metni yazılsaydı denetim ekranı görünürlük katmanını atlayan bir okuma
  // yolu olurdu.
  it("faaliyet başlığı, açıklaması ve mesaj metni hiçbir kayda girmez", async () => {
    const { kok, admin } = await sirket();
    const departman = await createOrgUnit(
      testDb,
      { name: "Kalıphane", type: "Departman", parentId: kok.id, sortOrder: 0, requiresApproval: false, autoFlowsUp: true, attentionGroupId: null },
      admin.id,
      NOW,
    );
    if (!departman.ok) throw new Error("kurulum");

    const yazar = await createUser(
      testDb,
      {
        fullName: "Müdür",
        email: "mudur@ornek.test",
        orgUnitId: departman.value.id,
        isUnitManager: true,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: PAROLA,
      },
      admin.id,
      NOW,
    );
    if (!yazar.ok) throw new Error("kurulum");

    const GIZLI_BASLIK = "GIZLIBASLIK-müşteri-şikâyeti";
    const GIZLI_ACIKLAMA = "GIZLIACIKLAMA-hattaki-fire-oranı";
    const GIZLI_MESAJ = "GIZLIMESAJ-bu-soru-neden-cevapsız";
    const GIZLI_GEREKCE = "GIZLIGEREKCE-yanlış-girildi";

    const faaliyet = await createActivity(
      testDb,
      { id: yazar.user.id, orgUnitId: departman.value.id, requiresApproval: false },
      {
        activityDate: "2026-08-18",
        title: GIZLI_BASLIK,
        description: GIZLI_ACIKLAMA,
        targetDepartmentIds: [departman.value.id],
      },
      NOW,
    );
    if (!faaliyet.ok) throw new Error("kurulum");

    const soru = await askQuestion(
      testDb,
      { id: admin.id, isSystemAdmin: true },
      { activityId: faaliyet.activity.id, text: GIZLI_MESAJ },
      NOW,
    );
    if (!soru.ok) throw new Error("kurulum");

    await cancelActivity(
      testDb,
      { id: yazar.user.id, isSystemAdmin: false },
      faaliyet.activity.id,
      GIZLI_GEREKCE,
      new Date(NOW.getTime() + 60_000),
    );

    const hepsi = JSON.stringify(await kayitlar());
    for (const gizli of [GIZLI_BASLIK, GIZLI_ACIKLAMA, GIZLI_MESAJ, GIZLI_GEREKCE]) {
      expect(hepsi, `"${gizli}" denetim izine sızmış`).not.toContain(gizli);
    }

    // Kayıtlar yine de atılmış olmalı; boş bir iz de sınamayı geçerdi.
    expect((await kayitlar()).length).toBeGreaterThan(3);
  });
});
