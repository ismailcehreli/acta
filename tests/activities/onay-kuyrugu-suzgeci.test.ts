import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  countApprovalGroups,
  listApprovalGroups,
} from "@/server/activities/approval-groups";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Onay kuyruğunun süzgeçleri ve sayfalaması (Görev 11.3).
//
// Kuyruk kişi ve gün bazında **gruplu** gösteriliyor. Sayfalama da grup
// bazındadır: satırları sayfalamak grupları ortadan bölerdi ve müdür aynı
// kişinin aynı gününü iki sayfada görürdü.
//
// **Süzgeç yetki açmaz.** Kuyruk koşulu `approvalQueueWhere` ile gelir;
// buradaki alanlar yalnız daraltır.

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
  const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const mudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const akranMudur = await createUser(planlama.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });
  const kadir = await createUser(kaliphane.id, { fullName: "Kadir Usta" });
  const nazli = await createUser(kaliphane.id, { fullName: "Nazlı Usta" });

  return { kaliphane, planlama, mudur, akranMudur, kadir, nazli };
}

function bekleyen(gun: string, baslik: string, approverId: string) {
  return {
    title: baslik,
    activityDate: new Date(`${gun}T00:00:00.000Z`),
    approvalStatus: "PENDING_APPROVAL" as const,
    approverId,
    approvalSubmittedAt: NOW,
  };
}

describe("yazar süzgeci", () => {
  it("yalnız seçilen kişinin grupları gelir", async () => {
    const { mudur, kadir, nazli } = await sirket();
    await createActivity(kadir, bekleyen("2026-08-19", "Kadir'in işi", mudur.id));
    await createActivity(nazli, bekleyen("2026-08-19", "Nazlı'nın işi", mudur.id));

    const gruplar = await listApprovalGroups(testDb, mudur.id, NOW, {
      authorId: kadir.id,
    });

    expect(gruplar).toHaveLength(1);
    expect(gruplar[0]?.authorName).toBe("Kadir Usta");
  });
});

describe("dönem süzgeci", () => {
  it("bugün seçilince önceki günün grubu gelmez", async () => {
    const { mudur, kadir } = await sirket();
    await createActivity(kadir, bekleyen("2026-08-18", "Dünkü", mudur.id));
    await createActivity(kadir, bekleyen("2026-08-19", "Bugünkü", mudur.id));

    const gruplar = await listApprovalGroups(testDb, mudur.id, NOW, {
      period: "today",
    });

    expect(gruplar.flatMap((g) => g.items.map((i) => i.title))).toEqual([
      "Bugünkü",
    ]);
  });
});

describe("birim süzgeci", () => {
  it("yalnız seçilen birimde yazılmış kayıtlar gelir", async () => {
    const { kaliphane, planlama, mudur, kadir } = await sirket();
    const planlamaci = await createUser(planlama.id, { fullName: "Planlamacı" });

    await createActivity(kadir, bekleyen("2026-08-19", "Kalıphane işi", mudur.id));
    await createActivity(
      planlamaci,
      bekleyen("2026-08-19", "Planlama işi", mudur.id),
    );

    const gruplar = await listApprovalGroups(testDb, mudur.id, NOW, {
      authorOrgUnitId: kaliphane.id,
    });

    expect(gruplar.flatMap((g) => g.items.map((i) => i.title))).toEqual([
      "Kalıphane işi",
    ]);
  });
});

describe("sayfalama grup bazındadır", () => {
  it("grubu ortadan bölmez", async () => {
    const { mudur, kadir, nazli } = await sirket();
    // Kadir'in aynı gününde iki kayıt: tek grup, iki satır.
    await createActivity(kadir, bekleyen("2026-08-18", "Kadir 1", mudur.id));
    await createActivity(kadir, bekleyen("2026-08-18", "Kadir 2", mudur.id));
    await createActivity(nazli, bekleyen("2026-08-19", "Nazlı 1", mudur.id));

    const ilk = await listApprovalGroups(testDb, mudur.id, NOW, {}, { limit: 1 });

    expect(ilk).toHaveLength(1);
    // Grup bölünmedi: Kadir'in iki kaydı da aynı sayfada.
    expect(ilk[0]?.items).toHaveLength(2);
  });

  it("ikinci sayfa kalan grubu getirir", async () => {
    const { mudur, kadir, nazli } = await sirket();
    await createActivity(kadir, bekleyen("2026-08-18", "Kadir 1", mudur.id));
    await createActivity(nazli, bekleyen("2026-08-19", "Nazlı 1", mudur.id));

    const ikinci = await listApprovalGroups(testDb, mudur.id, NOW, {}, {
      limit: 1,
      skip: 1,
    });

    expect(ikinci).toHaveLength(1);
    expect(ikinci[0]?.authorName).toBe("Nazlı Usta");
  });

  it("sayaç grup sayısını verir, satır sayısını değil", async () => {
    const { mudur, kadir } = await sirket();
    await createActivity(kadir, bekleyen("2026-08-18", "Kadir 1", mudur.id));
    await createActivity(kadir, bekleyen("2026-08-18", "Kadir 2", mudur.id));

    expect(await countApprovalGroups(testDb, mudur.id, NOW, {})).toBe(1);
  });
});

describe("süzgeç yetki açmaz", () => {
  it("başka müdürün kuyruğunu hiçbir süzgeçle getirmez", async () => {
    const { mudur, akranMudur, kadir } = await sirket();
    await createActivity(kadir, bekleyen("2026-08-19", "Bana düşen", mudur.id));

    const gruplar = await listApprovalGroups(testDb, akranMudur.id, NOW, {
      authorId: kadir.id,
    });

    expect(gruplar).toHaveLength(0);
  });
});
