import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// §16.6: fiziksel silme yoktur. Yabancı anahtarlardaki RESTRICT yalnızca
// referans verilen kayıtları korur; referanssız bir kullanıcı, boş bir birim
// veya alt kaydı olmayan bir faaliyet silinebiliyordu
// (denetim 17.08.2026, bulgu 9).

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("referanssız kayıtlar da silinemez", () => {
  it("hiçbir yerde kullanılmayan kullanıcı silinemez", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await expect(
      testDb.user.delete({ where: { id: user.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("boş birim silinemez", async () => {
    const root = await createOrgUnit();
    const empty = await createOrgUnit({ parentId: root.id });

    await expect(
      testDb.orgUnit.delete({ where: { id: empty.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("tek kök birim silinemez — ağaç köksüz kalamaz", async () => {
    const root = await createOrgUnit();

    await expect(
      testDb.orgUnit.delete({ where: { id: root.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("alt kaydı olmayan faaliyet silinemez", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    const activity = await createActivity(user);

    await expect(
      testDb.activity.delete({ where: { id: activity.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("toplu silme de reddedilir", async () => {
    const unit = await createOrgUnit();
    await createUser(unit.id);

    await expect(testDb.user.deleteMany({})).rejects.toThrow(
      /PHYSICAL_DELETE_FORBIDDEN/,
    );
  });

  it("ham SQL ile silme de reddedilir", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await expect(
      testDb.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = '${user.id}'`),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });
});

// §15.2: denetim kaydı değişmezdir. Görev 6.1 bu tabloyu kullanmaya
// başladığında koruma hazır olmalı.
describe("denetim kaydı değişmezliği", () => {
  async function createAuditLog() {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    return testDb.auditLog.create({
      data: {
        userId: user.id,
        objectType: "Activity",
        objectId: "ornek",
        action: "created",
      },
    });
  }

  it("denetim kaydı güncellenemez", async () => {
    const log = await createAuditLog();

    await expect(
      testDb.auditLog.update({
        where: { id: log.id },
        data: { action: "degistirildi" },
      }),
    ).rejects.toThrow(/AUDIT_LOG_IMMUTABLE/);
  });

  it("denetim kaydı silinemez", async () => {
    const log = await createAuditLog();

    await expect(
      testDb.auditLog.delete({ where: { id: log.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });
});

// Örnek veri temizliğinin açtığı **dar kapı** (20.08.2026).
//
// Yasak varsayılan olarak yerinde; yalnız `app.demo_purge` oturum değişkeni
// kurulmuşken silme geçiyor. Bu testler kapının kapalı kaldığını ve
// açıldığında transaction'la birlikte kapandığını sabitler — kapı sızarsa
// fiziksel silme yasağı fiilen ortadan kalkardı.
describe("örnek veri temizliğinin dar kapısı", () => {
  it("bayrak kurulmadan silme yine reddedilir", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await expect(
      testDb.user.delete({ where: { id: user.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("yanlış değerle kurulmuş bayrak kapıyı açmaz", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await expect(
      testDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL app.demo_purge = 'belki'");
        return tx.user.delete({ where: { id: user.id } });
      }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("bayrak kurulmuş transaction içinde silme geçer", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await testDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL app.demo_purge = 'evet'");
      await tx.user.delete({ where: { id: user.id } });
    });

    expect(await testDb.user.count({ where: { id: user.id } })).toBe(0);
  });

  it("bayrak transaction'dan sonra kalmaz — sonraki silme yine reddedilir", async () => {
    const unit = await createOrgUnit();
    const silinecek = await createUser(unit.id);
    const kalacak = await createUser(unit.id, { email: "kalacak@ornek.test" });

    await testDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL app.demo_purge = 'evet'");
      await tx.user.delete({ where: { id: silinecek.id } });
    });

    // `SET LOCAL` transaction'a bağlıdır; bağlantı havuzunda bir sonraki
    // isteğe sızsaydı bu silme de geçerdi.
    await expect(
      testDb.user.delete({ where: { id: kalacak.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("faaliyet silme kapısı da kurulmadan faaliyet silinemez (03.09.2026)", async () => {
    // Root'un silme yetkisi uygulama katmanında yaşıyor; veritabanı kapısı
    // ikinci kilittir. Servis dışındaki hiçbir yol — elle yazılmış bir sorgu
    // dâhil — faaliyeti silememeli.
    const unit = await createOrgUnit();
    const user = await createUser(unit.id, { email: "yazan@ornek.test" });
    const kayit = await createActivity(user);

    await expect(
      testDb.activity.delete({ where: { id: kayit.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);

    expect(await testDb.activity.count({ where: { id: kayit.id } })).toBe(1);
  });

  it("faaliyet kapısı kurulunca siler ve transaction sonrası kalmaz", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id, { email: "yazan2@ornek.test" });
    const silinecek = await createActivity(user);
    const kalacak = await createActivity(user);

    await testDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL app.activity_delete = 'evet'");
      await tx.activityRevision.deleteMany({ where: { activityId: silinecek.id } });
      await tx.activity.delete({ where: { id: silinecek.id } });
    });

    expect(await testDb.activity.count({ where: { id: silinecek.id } })).toBe(0);

    await expect(
      testDb.activity.delete({ where: { id: kalacak.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });

  it("silme talebi kaydı da silinemez: kendisi bir denetim izidir", async () => {
    const unit = await createOrgUnit();
    const root = await createUser(unit.id, {
      email: "root-kanit@ornek.test",
      isRoot: true,
      isSystemAdmin: true,
    });

    const talep = await testDb.activityDeletionRequest.create({
      data: {
        activityId: "silinmis-kayit",
        activityTitle: "Bir faaliyet",
        activityDate: new Date("2026-08-18T00:00:00.000Z"),
        activityAuthor: "Kalıpçı",
        requestedById: root.id,
        codeHash: "a".repeat(64),
        expiresAt: new Date("2026-08-18T01:00:00.000Z"),
      },
    });

    await expect(
      testDb.activityDeletionRequest.delete({ where: { id: talep.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
  });
});
