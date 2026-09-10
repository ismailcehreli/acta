import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { login } from "@/server/auth/login";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { sendWelcomeEmail } from "@/server/auth/reset";
import { createUser } from "@/server/users/create";
import { listUsers } from "@/server/users/list";

import { createOrgUnit, createUser as seedUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-17T09:00:00.000Z");
const noWait = async () => {};

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

afterAll(async () => {
  await testDb.$disconnect();
});

const baseInput = {
  fullName: "Yeni Kullanıcı",
  isUnitManager: false,
  isSystemAdmin: false,
  writesActivities: true,
  initialPassword: "baslangic-parolasi-1",
};

describe("kullanıcı ekleme", () => {
  it("eklenen kullanıcı başlangıç parolasıyla giriş yapabilir", async () => {
    const unit = await createOrgUnit();

    const result = await createUser(testDb, {
      ...baseInput,
      email: "yeni@ornek.test",
      orgUnitId: unit.id,
    });

    expect(result.ok).toBe(true);

    // Parolasız kullanıcı giriş yapamaz; kayıt ve parola birlikte oluşmalı.
    const attempt = await login(
      { db: testDb, now: NOW, rateLimitKey: "10.0.0.1", sleep: noWait },
      { email: "yeni@ornek.test", password: baseInput.initialPassword },
    );
    expect(attempt.ok).toBe(true);
  });

  it("aynı e-posta ikinci kez eklenemez", async () => {
    const unit = await createOrgUnit();
    await createUser(testDb, {
      ...baseInput,
      email: "ayni@ornek.test",
      orgUnitId: unit.id,
    });

    const result = await createUser(testDb, {
      ...baseInput,
      email: "ayni@ornek.test",
      orgUnitId: unit.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("duplicate_email");
  });

  // 20.08.2026 kararı: bir birimde birden fazla müdür olabilir. Kayıt her
  // ikisinin de onay kuyruğuna düşer, ilk karar veren kapatır.
  it("bir birime ikinci yönetici atanabilir", async () => {
    const unit = await createOrgUnit();
    await seedUser(unit.id, { isUnitManager: true });

    const result = await createUser(testDb, {
      ...baseInput,
      email: "ikinci-yonetici@ornek.test",
      orgUnitId: unit.id,
      isUnitManager: true,
    });

    expect(result.ok).toBe(true);
    expect(
      await testDb.user.count({
        where: { orgUnitId: unit.id, isUnitManager: true },
      }),
    ).toBe(2);
  });

  it("pasif birime kullanıcı eklenemez", async () => {
    const root = await createOrgUnit();
    const passive = await createOrgUnit({ parentId: root.id, isActive: false });

    const result = await createUser(testDb, {
      ...baseInput,
      email: "pasif-birim@ornek.test",
      orgUnitId: passive.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("inactive_unit");
  });

  it("olmayan birime kullanıcı eklenemez", async () => {
    const result = await createUser(testDb, {
      ...baseInput,
      email: "birimsiz@ornek.test",
      orgUnitId: "00000000-0000-0000-0000-000000000000",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unit_not_found");
  });

  it("başarısız eklemede yarım kayıt kalmaz", async () => {
    const unit = await createOrgUnit();
    const passive = await createOrgUnit({ parentId: unit.id, isActive: false });

    // Kullanıcı ve parolası tek işlemde yazılır; pasif birim reddedilince
    // ortada parolasız bir kullanıcı kalmamalı.
    await createUser(testDb, {
      ...baseInput,
      email: "yarim@ornek.test",
      orgUnitId: passive.id,
    });

    const stored = await testDb.user.findUnique({
      where: { email: "yarim@ornek.test" },
    });
    expect(stored).toBeNull();
  });

  it("rapor yetkilerini kullanıcı hesabında ayrı saklar", async () => {
    const unit = await createOrgUnit();

    const result = await createUser(testDb, {
      ...baseInput,
      email: "rapor-yetkili@ornek.test",
      orgUnitId: unit.id,
      canViewReports: true,
      canViewScoreReports: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await testDb.user.findUnique({
      where: { id: result.user.id },
      select: { canViewReports: true, canViewScoreReports: true },
    });
    expect(stored).toEqual({
      canViewReports: true,
      canViewScoreReports: true,
    });
  });
});

// Bu blok yalnızca **projeksiyonun dar olduğunu** kanıtlar: `listUsers` çağıranın
// rolünü hiç almaz, dolayısıyla "sistem yöneticisi içerik göremez" yetkisini
// sınamaz (denetim FAZ 2, bulgu 7). O yetkinin gerçek testi, içerik okuma
// yolu Görev 3.3'te oluştuğunda yazılacak: ağaç kapsamı olmayan bir sistem
// yöneticisiyle liste, detay, arama ve ek indirme denemelerinin tamamı
// reddedilmelidir.
describe("kullanıcı yönetim listesi dar projeksiyon döndürür", () => {
  it("yalnızca yönetim alanları döner, faaliyet içeriği taşınmaz", async () => {
    const unit = await createOrgUnit({ name: "Kalıphane" });
    const user = await seedUser(unit.id, {
      fullName: "Departman Müdürü",
      isUnitManager: true,
    });
    // Kişinin faaliyeti olsun; listede içeriğinden hiçbir iz olmamalı.
    await testDb.activity.create({
      data: {
        authorId: user.id,
        authorOrgUnitId: unit.id,
        activityDate: new Date("2026-08-17T00:00:00.000Z"),
        title: "GIZLI FAALIYET BASLIGI",
        description: "GIZLI FAALIYET ACIKLAMASI",
      },
    });

    const users = await listUsers(testDb);

    expect(users).toHaveLength(1);
    expect(Object.keys(users[0]).sort()).toEqual([
      // Profil resmi uzantısı yönetim alanıdır: resmin kendisi değil, yalnız
      // hangi türde olduğu taşınıyor (Görev 11.5).
      "avatarExtension",
      // Skorlama alanları da yönetim alanıdır (Görev 11.10, 11.11).
      "canAppreciate",
      "canViewReports",
      "canViewScoreReports",
      "email",
      "fullName",
      "id",
      "isActive",
      "isRoot",
      "isScored",
      "isSystemAdmin",
      "isUnitManager",
      "lastLoginAt",
      "orgUnitId",
      "orgUnitName",
      "title",
      "writesActivities",
    ]);

    const serialized = JSON.stringify(users);
    expect(serialized).not.toContain("GIZLI FAALIYET BASLIGI");
    expect(serialized).not.toContain("GIZLI FAALIYET ACIKLAMASI");
  });
});

// Hoş geldiniz e-postası (21.08.2026, ürün sahibi isteği).
//
// Sınanan asıl kural: **parola e-postaya girmez.** Kullanıcıya parolayı
// kendisi belirlesin diye tek kullanımlık bağlantı gider; sistem
// yöneticisinin belirlediği başlangıç parolası hiç dolaşıma girmez.
describe("hoş geldiniz e-postası", () => {
  it("kuyruğa yazılır ve parola taşımaz", async () => {
    const unit = await createOrgUnit();
    const sonuc = await createUser(testDb, {
      ...baseInput,
      email: "yeni-kullanici@ornek.test",
      orgUnitId: unit.id,
      initialPassword: "cok-gizli-parola-9876",
    });

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;

    const posta = await sendWelcomeEmail(testDb, sonuc.user.id, new Date());
    expect(posta.ok).toBe(true);

    const satirlar = await testDb.notificationQueue.findMany({
      where: { userId: sonuc.user.id, eventType: "account_created" },
    });

    expect(satirlar).toHaveLength(1);

    // Kuyruk satırının tamamında parola geçmemeli.
    const ham = JSON.stringify(satirlar[0]);
    expect(ham).not.toContain("cok-gizli-parola-9876");
    // Ama parola belirleme belirteci olmalı; olmazsa e-posta işe yaramaz.
    expect(satirlar[0]?.payload).toHaveProperty("token");
  });

  it("pasif hesaba gönderilmez", async () => {
    const unit = await createOrgUnit();
    const sonuc = await createUser(testDb, {
      ...baseInput,
      email: "pasif-yeni@ornek.test",
      orgUnitId: unit.id,
    });
    if (!sonuc.ok) throw new Error("kullanıcı açılamadı");

    await testDb.user.update({
      where: { id: sonuc.user.id },
      data: { isActive: false },
    });

    const posta = await sendWelcomeEmail(testDb, sonuc.user.id, new Date());
    expect(posta.ok).toBe(false);
    expect(
      await testDb.notificationQueue.count({
        where: { userId: sonuc.user.id, eventType: "account_created" },
      }),
    ).toBe(0);
  });
});

describe("hoş geldiniz bildirimi hesapla aynı işlemde", () => {
  it("kuyruk yazılamazsa hesap da oluşmaz", async () => {
    const unit = await createOrgUnit();

    // Gerçek işlem, gerçek veritabanı; yalnız **kuyruk yazımı** patlıyor.
    // Sınanan şey bir sahte nesnenin davranışı değil, işlemin geri alınması.
    const kuyrugu_patlayan = {
      ...testDb,
      $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
        testDb.$transaction((tx) =>
          fn(
            new Proxy(tx, {
              get(hedef, alan) {
                if (alan === "notificationQueue") {
                  return {
                    createMany: async () => {
                      throw new Error("kuyruk yazılamadı");
                    },
                  };
                }
                return Reflect.get(hedef, alan);
              },
            }),
          ),
        )) as typeof testDb.$transaction,
    } as unknown as typeof testDb;

    const sonuc = await createUser(
      kuyrugu_patlayan,
      {
        ...baseInput,
        email: "yarim-kalmasin@ornek.test",
        orgUnitId: unit.id,
      },
      null,
      NOW,
      { welcomeEmail: true },
    );

    expect(sonuc.ok).toBe(false);

    // Müdürün açtığı hesapta parolayı kimse bilmez ve tek giriş yolu bu
    // bağlantıdır. Bildirim yazılamadıysa hesabın kalması, kimsenin
    // giremediği bir kullanıcı bırakırdı.
    const kalan = await testDb.user.findUnique({
      where: { email: "yarim-kalmasin@ornek.test" },
    });
    expect(kalan).toBeNull();
  });

  it("kuyruk yazılabilirse hesap ve bildirim birlikte oluşur", async () => {
    const unit = await createOrgUnit();

    const sonuc = await createUser(
      testDb,
      { ...baseInput, email: "birlikte@ornek.test", orgUnitId: unit.id },
      null,
      NOW,
      { welcomeEmail: true },
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;

    const bildirim = await testDb.notificationQueue.findFirst({
      where: { userId: sonuc.user.id },
    });
    expect(bildirim).not.toBeNull();
  });
});
