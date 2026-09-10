import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  resolveUnitWorkWindow,
  saveUnitWorkCalendar,
} from "@/server/calendar/unit-calendar";
import { saveWorkCalendar } from "@/server/calendar/settings";

import { createOrgUnit } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Birime özel mesai penceresi (Görev 11.9, tasarım Paket H).
//
// **Takvim ikiye ayrıldı.** Burası yalnız mesai penceresi: hangi günler
// çalışılıyor, mesai ne zaman bitiyor, resmî tatilde çalışılıyor mu. İş günü
// sayacı şirket geneli kalıyor ve bundan etkilenmiyor — o iki kişi arasındaki
// ortak süre ölçüsü.
//
// Birimin satırı yoksa **üst birime** bakılır, en sonda şirket varsayılanına
// düşülür.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function agac() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const fabrika = await createOrgUnit({ name: "Fabrika", parentId: kok.id });
  const depoA = await createOrgUnit({ name: "Depo A", parentId: fabrika.id });
  const depoB = await createOrgUnit({ name: "Depo B", parentId: fabrika.id });
  const satis = await createOrgUnit({ name: "Satış", parentId: kok.id });

  return { kok, fabrika, depoA, depoB, satis };
}

describe("miras", () => {
  it("birimin kendi satırı varsa o kullanılır", async () => {
    const { depoA } = await agac();
    await saveUnitWorkCalendar(testDb, depoA.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: false,
    });

    const pencere = await resolveUnitWorkWindow(testDb, depoA.id);

    expect(pencere.workEndMinute).toBe(17 * 60);
    expect(pencere.source).toBe("unit");
  });

  it("satırı yoksa üst birimden devralır", async () => {
    const { fabrika, depoB } = await agac();
    await saveUnitWorkCalendar(testDb, fabrika.id, {
      workingDays: [1, 2, 3, 4, 5, 6],
      workStartMinute: 8 * 60,
      workEndMinute: 18 * 60,
      worksOnHolidays: true,
    });

    const pencere = await resolveUnitWorkWindow(testDb, depoB.id);

    expect(pencere.workEndMinute).toBe(18 * 60);
    expect(pencere.worksOnHolidays).toBe(true);
    // Devralınan değer **hangi birimden geldiğini** söylüyor: ekranda
    // "Fabrika'dan devralındı" yazabilmek için.
    expect(pencere.source).toBe("inherited");
    expect(pencere.sourceUnitName).toBe("Fabrika");
  });

  it("hiçbir üstte yoksa şirket varsayılanına düşer", async () => {
    const { depoA } = await agac();
    await saveWorkCalendar(testDb, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 9 * 60,
      workEndMinute: 18 * 60,
    });

    const pencere = await resolveUnitWorkWindow(testDb, depoA.id);

    expect(pencere.workEndMinute).toBe(18 * 60);
    expect(pencere.source).toBe("company");
  });

  it("en yakın üst kazanır", async () => {
    const { kok, fabrika, depoA } = await agac();
    await saveUnitWorkCalendar(testDb, kok.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 9 * 60,
      workEndMinute: 18 * 60,
      worksOnHolidays: false,
    });
    await saveUnitWorkCalendar(testDb, fabrika.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: false,
    });

    const pencere = await resolveUnitWorkWindow(testDb, depoA.id);

    expect(pencere.workEndMinute).toBe(17 * 60);
    expect(pencere.sourceUnitName).toBe("Fabrika");
  });

  it("kardeş birim etkilenmez", async () => {
    const { depoA, satis } = await agac();
    await saveUnitWorkCalendar(testDb, depoA.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: false,
    });
    await saveWorkCalendar(testDb, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 9 * 60,
      workEndMinute: 18 * 60,
    });

    const pencere = await resolveUnitWorkWindow(testDb, satis.id);

    expect(pencere.workEndMinute).toBe(18 * 60);
    expect(pencere.source).toBe("company");
  });
});

describe("resmî tatil bayrağı", () => {
  it("bayrak açık birimde tatil çalışma günüdür", async () => {
    const { depoA } = await agac();
    await saveUnitWorkCalendar(testDb, depoA.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 8 * 60,
      workEndMinute: 18 * 60,
      worksOnHolidays: true,
    });

    const pencere = await resolveUnitWorkWindow(testDb, depoA.id);

    expect(pencere.worksOnHolidays).toBe(true);
  });

  it("varsayılan olarak tatilde çalışılmaz", async () => {
    const { satis } = await agac();

    const pencere = await resolveUnitWorkWindow(testDb, satis.id);

    expect(pencere.worksOnHolidays).toBe(false);
  });
});

describe("veritabanı kısıtları", () => {
  // Kısıtın değeri, uygulama katmanı devre dışıyken de geçerli olmasındadır.
  it("bitiş dakikası başlangıçtan küçük olamaz", async () => {
    const { depoA } = await agac();

    await expect(
      testDb.orgUnitWorkCalendar.create({
        data: {
          orgUnitId: depoA.id,
          workingDays: [1, 2, 3],
          workStartMinute: 18 * 60,
          workEndMinute: 8 * 60,
        },
      }),
    ).rejects.toThrow(/OrgUnitWorkCalendar_valid_window/);
  });

  it("çalışma günleri boş olamaz", async () => {
    const { depoA } = await agac();

    await expect(
      testDb.orgUnitWorkCalendar.create({
        data: {
          orgUnitId: depoA.id,
          workingDays: [],
          workStartMinute: 8 * 60,
          workEndMinute: 18 * 60,
        },
      }),
    ).rejects.toThrow(/OrgUnitWorkCalendar_valid_days/);
  });

  it("geçersiz gün numarası kabul edilmez", async () => {
    const { depoA } = await agac();

    await expect(
      testDb.orgUnitWorkCalendar.create({
        data: {
          orgUnitId: depoA.id,
          workingDays: [1, 9],
          workStartMinute: 8 * 60,
          workEndMinute: 18 * 60,
        },
      }),
    ).rejects.toThrow(/OrgUnitWorkCalendar_valid_days/);
  });
});
