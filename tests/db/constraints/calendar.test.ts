import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function createPeriod(
  userId: string,
  markedById: string,
  start: string,
  end: string,
) {
  return testDb.noActivityPeriod.create({
    data: {
      userId,
      markedById,
      startDate: day(start),
      endDate: day(end),
    },
  });
}

describe('"faaliyet beklenmiyor" dönemi kısıtları', () => {
  it("bitiş tarihi başlangıçtan önce olamaz", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    const manager = await createUser(unit.id);

    await expect(
      createPeriod(user.id, manager.id, "2026-08-20", "2026-08-18"),
    ).rejects.toThrow(/NoActivityPeriod_valid_range/);
  });

  it("aynı kullanıcı için çakışan aralık eklenemez", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    const manager = await createUser(unit.id);

    await createPeriod(user.id, manager.id, "2026-08-17", "2026-08-21");

    await expect(
      createPeriod(user.id, manager.id, "2026-08-21", "2026-08-25"),
    ).rejects.toThrow(/NoActivityPeriod_no_overlap/);
  });

  it("bitişik ama çakışmayan aralıklar eklenebilir", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);
    const manager = await createUser(unit.id);

    await createPeriod(user.id, manager.id, "2026-08-17", "2026-08-21");
    const second = await createPeriod(
      user.id,
      manager.id,
      "2026-08-22",
      "2026-08-25",
    );

    expect(second.startDate.toISOString()).toBe("2026-08-22T00:00:00.000Z");
  });

  it("farklı kullanıcıların aralıkları çakışabilir", async () => {
    const unit = await createOrgUnit();
    const first = await createUser(unit.id);
    const second = await createUser(unit.id);
    const manager = await createUser(unit.id);

    await createPeriod(first.id, manager.id, "2026-08-17", "2026-08-21");
    const other = await createPeriod(
      second.id,
      manager.id,
      "2026-08-17",
      "2026-08-21",
    );

    expect(other.userId).toBe(second.id);
  });
});

describe("çalışma takvimi tek kayıt kısıtı", () => {
  it("şirket takvimi kurulabilir", async () => {
    const calendar = await testDb.workCalendar.create({
      data: {
        // Pazartesi–Cuma, 08:30–18:00 (yerel saat, dakika cinsinden).
        workingDays: [1, 2, 3, 4, 5],
        workStartMinute: 510,
        workEndMinute: 1080,
      },
    });

    expect(calendar.id).toBe(1);
  });

  it("ikinci bir takvim kaydı yazılamaz", async () => {
    await testDb.workCalendar.create({
      data: { workingDays: [1, 2, 3, 4, 5], workStartMinute: 510, workEndMinute: 1080 },
    });

    await expect(
      testDb.workCalendar.create({
        data: {
          id: 2,
          workingDays: [1, 2, 3, 4, 5],
          workStartMinute: 510,
          workEndMinute: 1080,
        },
      }),
    ).rejects.toThrow(/WorkCalendar_singleton/);
  });
});

// İZİN DÖNEMİ SİLİNMEZ, İPTAL EDİLİR (denetim 21.08.2026, bulgu 7).
//
// Kural veritabanında durur çünkü değeri tam olarak orada: vekilin geçmiş
// görünürlüğü bu satırdan türüyor (§4.5) ve uygulama katmanındaki bir hata
// satırı silerse, vekil vekâlet ettiği dönemin kayıtlarını sessizce kaybeder.
describe("dönem satırı fiziksel silinemez", () => {
  it("silme denemesi veritabanı tarafından reddedilir", async () => {
    const birim = await createOrgUnit({ name: "Kalıphane" });
    const kisi = await createUser(birim.id, { email: "kisi@ornek.test" });
    const donem = await createPeriod(kisi.id, kisi.id, "2026-08-18", "2026-08-22");

    await expect(
      testDb.noActivityPeriod.delete({ where: { id: donem.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);

    expect(
      await testDb.noActivityPeriod.count({ where: { id: donem.id } }),
    ).toBe(1);
  });

  it("iptal alanları eksik yazılamaz", async () => {
    const birim = await createOrgUnit({ name: "Kalıphane" });
    const kisi = await createUser(birim.id, { email: "kisi@ornek.test" });
    const donem = await createPeriod(kisi.id, kisi.id, "2026-08-18", "2026-08-22");

    // Gerekçesiz iptal: "bu dönem neden yok" sorusunu cevaplayamaz.
    await expect(
      testDb.noActivityPeriod.update({
        where: { id: donem.id },
        data: { cancelledAt: new Date(), cancelledById: kisi.id },
      }),
    ).rejects.toThrow(/NoActivityPeriod_cancellation_complete/);

    // Boşluktan ibaret gerekçe de sayılmaz.
    await expect(
      testDb.noActivityPeriod.update({
        where: { id: donem.id },
        data: {
          cancelledAt: new Date(),
          cancelledById: kisi.id,
          cancellationReason: "   ",
        },
      }),
    ).rejects.toThrow(/NoActivityPeriod_cancellation_complete/);
  });

  it("iptal edilmiş dönem çakışma kısıtına girmez", async () => {
    const birim = await createOrgUnit({ name: "Kalıphane" });
    const kisi = await createUser(birim.id, { email: "kisi@ornek.test" });
    const donem = await createPeriod(kisi.id, kisi.id, "2026-08-18", "2026-08-22");

    await testDb.noActivityPeriod.update({
      where: { id: donem.id },
      data: {
        cancelledAt: new Date(),
        cancelledById: kisi.id,
        cancellationReason: "yanlış tarih",
      },
    });

    // Aynı tarihlere doğrusu girilebilmeli.
    await expect(
      createPeriod(kisi.id, kisi.id, "2026-08-18", "2026-08-22"),
    ).resolves.toBeTruthy();
  });
});
