import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { createUser } from "@/server/users/create";
import { deactivateUser } from "@/server/users/deactivate";
import {
  canDeactivate,
  setUserPassword,
  updateRootSelf,
  updateUser,
} from "@/server/users/update";

import { createOrgUnit } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Kullanıcı düzenleme ve yönetici eliyle parola belirleme (§4.6, §15.1).
//
// İki koruma geri dönüşü olmayan durumları engeller: son sistem yöneticisinin
// yetkisi kaldırılamaz, kişi kendini pasifleştiremez. İkisi de sistemi
// yönetilemez bırakırdı — kullanıcı açmak için giriş, giriş için kullanıcı
// gerekir.

const NOW = new Date("2026-08-18T12:00:00.000Z");
const ESKI = "eski-parola-1234";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kullanici(
  email: string,
  orgUnitId: string,
  overrides: {
    isUnitManager?: boolean;
    isSystemAdmin?: boolean;
    writesActivities?: boolean;
  } = {},
) {
  const sonuc = await createUser(testDb, {
    fullName: `Kişi ${email}`,
    email,
    orgUnitId,
    isUnitManager: overrides.isUnitManager ?? false,
    isSystemAdmin: overrides.isSystemAdmin ?? false,
    writesActivities: overrides.writesActivities ?? true,
    initialPassword: ESKI,
  });
  if (!sonuc.ok) throw new Error(`kurulum: ${sonuc.message}`);
  return sonuc.user;
}

async function sirket() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
  return { root, kaliphane };
}

describe("bilgi düzenleme", () => {
  it("ad, e-posta ve birim değiştirilir", async () => {
    const { root, kaliphane } = await sirket();
    const user = await kullanici("eski@ornek.test", root.id);

    const sonuc = await updateUser(testDb, {
      id: user.id,
      fullName: "Yeni Ad",
      email: "YENI@ornek.test",
      orgUnitId: kaliphane.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.user.fullName).toBe("Yeni Ad");
    // E-posta küçük harfe indirgenir; iç kimlik değişmez (§15.3).
    expect(sonuc.user.email).toBe("yeni@ornek.test");
    expect(sonuc.user.id).toBe(user.id);
    expect(sonuc.user.orgUnitId).toBe(kaliphane.id);
  });

  it("başka kullanıcının e-postası alınamaz", async () => {
    const { root } = await sirket();
    await kullanici("birinci@ornek.test", root.id);
    const ikinci = await kullanici("ikinci@ornek.test", root.id);

    const sonuc = await updateUser(testDb, {
      id: ikinci.id,
      fullName: "İkinci",
      email: "birinci@ornek.test",
      orgUnitId: root.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("duplicate_email");
  });

  // 20.08.2026 kararı: bir birimde birden fazla müdür olabilir.
  it("birime ikinci yönetici atanabilir", async () => {
    const { root, kaliphane } = await sirket();
    await kullanici("mudur@ornek.test", kaliphane.id, { isUnitManager: true });
    const digeri = await kullanici("digeri@ornek.test", root.id);

    const sonuc = await updateUser(testDb, {
      id: digeri.id,
      fullName: "Diğeri",
      email: "digeri@ornek.test",
      orgUnitId: kaliphane.id,
      isUnitManager: true,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(sonuc.ok).toBe(true);
    expect(
      await testDb.user.count({
        where: { orgUnitId: kaliphane.id, isUnitManager: true },
      }),
    ).toBe(2);
  });

  it("olmayan birim seçilemez", async () => {
    const { root } = await sirket();
    const user = await kullanici("kisi@ornek.test", root.id);

    const sonuc = await updateUser(testDb, {
      id: user.id,
      fullName: "Kişi",
      email: "kisi@ornek.test",
      orgUnitId: "11111111-1111-4111-8111-111111111111",
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("unit_not_found");
  });

  it("pasif birime aktif kullanıcı bağlanamaz", async () => {
    const { root } = await sirket();
    const pasif = await createOrgUnit({ name: "Kapanan", parentId: root.id });
    await testDb.orgUnit.update({ where: { id: pasif.id }, data: { isActive: false } });
    const user = await kullanici("kisi@ornek.test", root.id);

    const sonuc = await updateUser(testDb, {
      id: user.id,
      fullName: "Kişi",
      email: "kisi@ornek.test",
      orgUnitId: pasif.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("inactive_unit");
  });
});

describe("son sistem yöneticisi koruması", () => {
  it("tek sistem yöneticisinin yetkisi kaldırılamaz", async () => {
    const { root } = await sirket();
    const admin = await kullanici("admin@ornek.test", root.id, {
      isSystemAdmin: true,
    });

    const sonuc = await updateUser(testDb, {
      id: admin.id,
      fullName: "Admin",
      email: "admin@ornek.test",
      orgUnitId: root.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("last_system_admin");

    // Yetki gerçekten duruyor olmalı.
    const guncel = await testDb.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(guncel.isSystemAdmin).toBe(true);
  });

  it("ikinci yönetici varken yetki kaldırılabilir", async () => {
    const { root, kaliphane } = await sirket();
    const admin = await kullanici("admin@ornek.test", root.id, {
      isSystemAdmin: true,
    });
    await kullanici("admin2@ornek.test", kaliphane.id, { isSystemAdmin: true });

    const sonuc = await updateUser(testDb, {
      id: admin.id,
      fullName: "Admin",
      email: "admin@ornek.test",
      orgUnitId: root.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(sonuc.ok).toBe(true);
  });

  it("pasif yöneticiler sayıya katılmaz", async () => {
    const { root, kaliphane } = await sirket();
    const admin = await kullanici("admin@ornek.test", root.id, {
      isSystemAdmin: true,
    });
    const pasifAdmin = await kullanici("eski-admin@ornek.test", kaliphane.id, {
      isSystemAdmin: true,
    });
    await testDb.user.update({
      where: { id: pasifAdmin.id },
      data: { isActive: false },
    });

    const sonuc = await updateUser(testDb, {
      id: admin.id,
      fullName: "Admin",
      email: "admin@ornek.test",
      orgUnitId: root.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    // Pasif bir yönetici sistemi yönetemez; tek aktif yönetici hâlâ bu kişi.
    expect(sonuc.ok).toBe(false);
  });
});

describe("pasifleştirme koruması", () => {
  it("kişi kendini pasifleştiremez", async () => {
    const { root } = await sirket();
    const admin = await kullanici("admin@ornek.test", root.id, {
      isSystemAdmin: true,
    });

    const izin = await canDeactivate(testDb, admin.id, admin.id);

    expect(izin.allowed).toBe(false);
    if (izin.allowed) return;
    expect(izin.message).toContain("Kendi hesabınızı");
  });

  it("son sistem yöneticisi pasifleştirilemez", async () => {
    const { root, kaliphane } = await sirket();
    const admin = await kullanici("admin@ornek.test", root.id, {
      isSystemAdmin: true,
    });
    const baskasi = await kullanici("kisi@ornek.test", kaliphane.id);

    const izin = await canDeactivate(testDb, baskasi.id, admin.id);

    expect(izin.allowed).toBe(false);
  });

  it("ikinci yönetici varken pasifleştirilebilir", async () => {
    const { root, kaliphane } = await sirket();
    const admin = await kullanici("admin@ornek.test", root.id, {
      isSystemAdmin: true,
    });
    const admin2 = await kullanici("admin2@ornek.test", kaliphane.id, {
      isSystemAdmin: true,
    });

    const izin = await canDeactivate(testDb, admin2.id, admin.id);
    expect(izin.allowed).toBe(true);

    const sonuc = await deactivateUser(testDb, admin.id, NOW);
    expect(sonuc.ok).toBe(true);
  });
});

describe("yönetici eliyle parola belirleme", () => {
  it("yeni parola geçerli olur, eskisi geçersizleşir", async () => {
    const { root } = await sirket();
    const user = await kullanici("kisi@ornek.test", root.id);

    const sonuc = await setUserPassword(testDb, user.id, "yeni-parola-5678", NOW);

    expect(sonuc.ok).toBe(true);
    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(await verifyPassword(credential.passwordHash, "yeni-parola-5678")).toBe(true);
    expect(await verifyPassword(credential.passwordHash, ESKI)).toBe(false);
  });

  it("tüm oturumlar kapatılır ve kimlik kuşağı ilerler", async () => {
    const { root } = await sirket();
    const user = await kullanici("kisi@ornek.test", root.id);
    await createSession(testDb, user.id, NOW);
    await createSession(testDb, user.id, NOW);
    const onceki = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });

    const sonuc = await setUserPassword(testDb, user.id, "yeni-parola-5678", NOW);

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.revokedSessionCount).toBe(2);
    expect(
      await testDb.session.count({ where: { userId: user.id, revokedAt: null } }),
    ).toBe(0);

    const sonraki = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    // Kuşak ilerlediği için bekleyen sıfırlama bağlantıları da ölür.
    expect(sonraki.version).toBe(onceki.version + 1);
  });

  it("kilitli hesabın kilidi açılır", async () => {
    const { root } = await sirket();
    const user = await kullanici("kisi@ornek.test", root.id);
    await testDb.userCredential.update({
      where: { userId: user.id },
      data: { failedLoginCount: 10, lockedUntil: new Date(NOW.getTime() + 900_000) },
    });

    await setUserPassword(testDb, user.id, "yeni-parola-5678", NOW);

    const credential = await testDb.userCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    // Kilit açılmasaydı kullanıcı yeni parolasıyla da giremezdi.
    expect(credential.lockedUntil).toBeNull();
    expect(credential.failedLoginCount).toBe(0);
  });

  it("olmayan kullanıcıya parola belirlenemez", async () => {
    const sonuc = await setUserPassword(
      testDb,
      "11111111-1111-4111-8111-111111111111",
      "yeni-parola-5678",
      NOW,
    );

    expect(sonuc.ok).toBe(false);
  });
});

describe("ana sistem yöneticisi koruması", () => {
  it("root hesabı normal kullanıcı güncelleme yolundan değiştirilemez", async () => {
    const { root } = await sirket();
    const ana = await kullanici("ana.hesap@ornek.test", root.id, {
      isSystemAdmin: true,
    });
    await testDb.user.update({ where: { id: ana.id }, data: { isRoot: true } });

    const sonuc = await updateUser(testDb, {
      id: ana.id,
      fullName: "Başka Ad",
      email: ana.email,
      orgUnitId: root.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: false,
    });

    expect(sonuc).toMatchObject({ ok: false, error: "root_protected" });
  });

  it("veritabanı root hesabın kimliğini ve temel rolünü korur", async () => {
    const { root } = await sirket();
    const ana = await kullanici("ana.hesap@ornek.test", root.id, {
      isSystemAdmin: true,
      isUnitManager: true,
    });
    await testDb.user.update({ where: { id: ana.id }, data: { isRoot: true } });

    await expect(
      testDb.user.update({
        where: { id: ana.id },
        data: { fullName: "Değiştirilemez" },
      }),
    ).rejects.toThrow(/ROOT_USER_PROTECTED/);

    await expect(
      testDb.user.update({
        where: { id: ana.id },
        data: { email: "baska@ornek.test" },
      }),
    ).rejects.toThrow(/ROOT_USER_PROTECTED/);

    await expect(
      testDb.user.update({
        where: { id: ana.id },
        data: { isUnitManager: false },
      }),
    ).rejects.toThrow(/ROOT_USER_PROTECTED/);
  });

  it("root yalnız kendi operasyonel seçeneklerini değiştirebilir", async () => {
    const { root, kaliphane } = await sirket();
    const ana = await kullanici("ana.hesap@ornek.test", root.id, {
      isSystemAdmin: true,
      isUnitManager: true,
    });
    await testDb.user.update({ where: { id: ana.id }, data: { isRoot: true } });

    const sonuc = await updateRootSelf(
      testDb,
      {
        id: ana.id,
        orgUnitId: kaliphane.id,
        writesActivities: false,
        isScored: false,
        canAppreciate: true,
      },
      ana.id,
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    const guncel = await testDb.user.findUniqueOrThrow({ where: { id: ana.id } });
    expect(guncel).toMatchObject({
      orgUnitId: kaliphane.id,
      writesActivities: false,
      isScored: false,
      canAppreciate: true,
      isRoot: true,
      isSystemAdmin: true,
      isActive: true,
    });
  });

  it("root parola ve pasifleştirme yollarından korunur", async () => {
    const { root } = await sirket();
    const ana = await kullanici("ana.hesap@ornek.test", root.id, {
      isSystemAdmin: true,
    });
    await testDb.user.update({ where: { id: ana.id }, data: { isRoot: true } });

    const parola = await setUserPassword(testDb, ana.id, "yeni-parola-5678", NOW);
    expect(parola).toMatchObject({ ok: false, error: "root_protected" });

    const pasif = await canDeactivate(testDb, "başka-aktör", ana.id);
    expect(pasif).toMatchObject({ allowed: false });

    const sonuc = await deactivateUser(testDb, ana.id, NOW);
    expect(sonuc).toMatchObject({ ok: false, reason: "root_protected" });
  });
});
