import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { countTeamAbsences, listTeamAbsences } from "@/server/absence/service";
import {
  countDeputyPeriods,
  listDeputyPeriods,
} from "@/server/absence/deputy-read";
import { subordinateUserIds } from "@/server/authz/visibility";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Ekip ve vekâlet listelerinin süzgeçleri (Görev 11.4).
//
// İki liste de süzgeçsizdi ve tamamı tek sayfada çiziliyordu. İptal edilen
// kayıtlar da listede durduğu için (bilerek: kaybolan kayıt "ben bunu girmiş
// miydim?" sorusunu doğurur) liste zamanla uzuyor.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });

  const mudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const kadir = await createUser(kaliphane.id, { fullName: "Kadir Usta" });
  const nazli = await createUser(kaliphane.id, { fullName: "Nazlı Usta" });

  return { kok, mudur, kadir, nazli };
}

const gun = (g: string) => new Date(`${g}T00:00:00.000Z`);

async function donem(
  userId: string,
  markedById: string,
  bas: string,
  bit: string,
  opts: { deputyId?: string; iptal?: boolean } = {},
) {
  return testDb.noActivityPeriod.create({
    data: {
      userId,
      markedById,
      startDate: gun(bas),
      endDate: gun(bit),
      ...(opts.deputyId ? { deputyId: opts.deputyId } : {}),
      ...(opts.iptal
        ? {
            cancelledAt: NOW,
            cancelledById: markedById,
            cancellationReason: "Yanlış girildi",
          }
        : {}),
    },
  });
}

describe("ekip izin listesi: kişi süzgeci", () => {
  it("yalnız seçilen kişinin dönemlerini getirir", async () => {
    const { mudur, kadir, nazli } = await sirket();
    await donem(kadir.id, mudur.id, "2026-08-10", "2026-08-12");
    await donem(nazli.id, mudur.id, "2026-08-11", "2026-08-13");

    const asts = await subordinateUserIds(testDb, mudur.id);
    const sonuc = await listTeamAbsences(testDb, mudur.id, asts, {
      userId: kadir.id,
    });

    expect(sonuc.map((d) => d.userName)).toEqual(["Kadir Usta"]);
  });
});

describe("ekip izin listesi: durum süzgeci", () => {
  it("iptal edilenleri ayırır", async () => {
    const { mudur, kadir } = await sirket();
    await donem(kadir.id, mudur.id, "2026-08-10", "2026-08-12");
    await donem(kadir.id, mudur.id, "2026-08-14", "2026-08-15", { iptal: true });

    const asts = await subordinateUserIds(testDb, mudur.id);

    const gecerli = await listTeamAbsences(testDb, mudur.id, asts, {
      status: "active",
    });
    const iptalli = await listTeamAbsences(testDb, mudur.id, asts, {
      status: "cancelled",
    });

    expect(gecerli).toHaveLength(1);
    expect(gecerli[0]?.cancelledReason).toBeNull();
    expect(iptalli).toHaveLength(1);
    expect(iptalli[0]?.cancelledReason).toBe("Yanlış girildi");
  });
});

describe("ekip izin listesi: sayfalama", () => {
  it("istenen kadar döndürür ve sayaç süzgeçli toplamı verir", async () => {
    const { mudur, kadir } = await sirket();
    await donem(kadir.id, mudur.id, "2026-08-10", "2026-08-11");
    await donem(kadir.id, mudur.id, "2026-08-12", "2026-08-13");
    await donem(kadir.id, mudur.id, "2026-08-14", "2026-08-15");

    const asts = await subordinateUserIds(testDb, mudur.id);

    expect(await listTeamAbsences(testDb, mudur.id, asts, {}, { limit: 2 })).toHaveLength(2);
    expect(await countTeamAbsences(testDb, mudur.id, asts, {})).toBe(3);
  });
});

describe("ekip izin listesi kapsam açmaz", () => {
  it("ast olmayan kişinin dönemini hiçbir süzgeçle getirmez", async () => {
    const { kok, mudur, kadir } = await sirket();
    // Ağaçta tek kök olabilir (veritabanı kısıtı); yabancı, kökün altındaki
    // ayrı bir birimde durur ve müdürün astı değildir.
    const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });
    const disardaki = await createUser(planlama.id, { fullName: "Yabancı" });
    await donem(disardaki.id, disardaki.id, "2026-08-10", "2026-08-12");
    await donem(kadir.id, mudur.id, "2026-08-10", "2026-08-12");

    const asts = await subordinateUserIds(testDb, mudur.id);
    const sonuc = await listTeamAbsences(testDb, mudur.id, asts, {
      userId: disardaki.id,
    });

    expect(sonuc).toHaveLength(0);
  });
});

describe("vekâlet listesi", () => {
  it("yerine bakılan kişiye göre daraltır", async () => {
    const { mudur, kadir, nazli } = await sirket();
    await donem(kadir.id, mudur.id, "2026-08-10", "2026-08-12", {
      deputyId: mudur.id,
    });
    await donem(nazli.id, mudur.id, "2026-08-10", "2026-08-12", {
      deputyId: mudur.id,
    });

    const sonuc = await listDeputyPeriods(testDb, mudur.id, NOW, {
      personId: kadir.id,
    });

    expect(sonuc.map((d) => d.personName)).toEqual(["Kadir Usta"]);
  });

  it("sayfalar ve süzgeçli toplamı bildirir", async () => {
    const { mudur, kadir, nazli } = await sirket();
    await donem(kadir.id, mudur.id, "2026-08-10", "2026-08-12", {
      deputyId: mudur.id,
    });
    await donem(nazli.id, mudur.id, "2026-08-14", "2026-08-16", {
      deputyId: mudur.id,
    });

    expect(
      await listDeputyPeriods(testDb, mudur.id, NOW, {}, { limit: 1 }),
    ).toHaveLength(1);
    expect(await countDeputyPeriods(testDb, mudur.id, {})).toBe(2);
  });

  it("başkasının vekâletini hiçbir süzgeçle getirmez", async () => {
    const { mudur, kadir, nazli } = await sirket();
    await donem(kadir.id, mudur.id, "2026-08-10", "2026-08-12", {
      deputyId: mudur.id,
    });

    // Nazlı hiç vekil değil; kendi kimliğiyle sorunca boş dönmeli.
    const sonuc = await listDeputyPeriods(testDb, nazli.id, NOW, {
      personId: kadir.id,
    });

    expect(sonuc).toHaveLength(0);
  });
});
