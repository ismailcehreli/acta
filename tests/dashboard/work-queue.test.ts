import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { requestChanges } from "@/server/activities/approval";
import { listWorkQueue } from "@/server/dashboard/work-queue";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Tek iş kuyruğu (Görev 10.5).
//
// Kuyruk yeni bir yetki kaynağı değil; her kalem kendi mevcut yolundan geliyor.
// Sınanan şey: doğru işler doğru kişiye düşüyor mu, sıralama beklemeye göre mi,
// ve **başkasının işi** kuyruğa sızıyor mu.

const NOW = new Date("2026-08-19T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const gm = await createOrgUnit({ name: "Genel Müdürlük", parentId: kok.id });
  const kaliphane = await createOrgUnit({
    name: "Kalıphane",
    parentId: gm.id,
    requiresApproval: true,
  });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: gm.id });

  const genelMudur = await createUser(gm.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const mudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const calisan = await createUser(kaliphane.id, { fullName: "Kalıpçı" });
  const akran = await createUser(planlama.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });

  return { genelMudur, mudur, calisan, akran };
}

const bakan = (id: string) => ({ id, isSystemAdmin: false });

describe("kuyruğa ne düşer", () => {
  it("onay bekleyen kayıt onaylayıcının kuyruğuna düşer", async () => {
    const { mudur, calisan } = await sirket();
    await createActivity(calisan, {
      title: "Onay bekleyen iş",
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: NOW,
    });

    const kuyruk = await listWorkQueue(testDb, bakan(mudur.id), NOW);

    expect(kuyruk.items).toHaveLength(1);
    expect(kuyruk.items[0]?.kind).toBe("approve");
    expect(kuyruk.items[0]?.fromName).toBe("Kalıpçı");
  });

  it("düzeltme istenen kayıt yazanın kuyruğuna düşer", async () => {
    const { mudur, calisan } = await sirket();
    const activity = await createActivity(calisan, {
      title: "Düzeltilecek iş",
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: NOW,
    });
    const gerekce = await createApprovalReason("CHANGES_REQUESTED");
    await requestChanges(testDb, mudur.id, activity.id, { reasonId: gerekce.id }, NOW);

    const yazanin = await listWorkQueue(testDb, bakan(calisan.id), NOW);

    // Bu kalem bugüne kadar hiçbir listede yoktu: müdür "şunu düzelt" diyordu
    // ve talep yalnız faaliyet sayfasında duruyordu.
    expect(yazanin.items.map((is) => is.kind)).toEqual(["revise"]);
    expect(yazanin.items[0]?.fromName).toBe("Kalıphane Müdürü");
  });

  it("düzeltme istenen kayıt müdürün kuyruğundan düşer", async () => {
    const { mudur, calisan } = await sirket();
    const activity = await createActivity(calisan, {
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: NOW,
    });
    const gerekce = await createApprovalReason("CHANGES_REQUESTED");
    await requestChanges(testDb, mudur.id, activity.id, { reasonId: gerekce.id }, NOW);

    const mudurun = await listWorkQueue(testDb, bakan(mudur.id), NOW);

    // Top yazana geçti; müdürün yapacak bir şeyi yok.
    expect(mudurun.items).toHaveLength(0);
  });

  it("başkasının onayı kuyruğa sızmaz", async () => {
    const { mudur, calisan, genelMudur, akran } = await sirket();
    await createActivity(calisan, {
      title: "Müdürün onayında",
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: NOW,
    });

    for (const baskasi of [genelMudur, akran, calisan]) {
      const kuyruk = await listWorkQueue(testDb, bakan(baskasi.id), NOW);
      expect(kuyruk.items.filter((is) => is.kind === "approve")).toHaveLength(0);
    }
  });

  it("onaylanmış kayıt kuyrukta durmaz", async () => {
    const { mudur, calisan } = await sirket();
    await createActivity(calisan, {
      approvalStatus: "APPROVED",
      approverId: mudur.id,
    });

    expect((await listWorkQueue(testDb, bakan(mudur.id), NOW)).items).toHaveLength(0);
  });

  it("reddedilen kayıt kimsenin kuyruğunda kalmaz", async () => {
    const { mudur, calisan } = await sirket();
    const gerekce = await createApprovalReason("REJECTED");
    await createActivity(calisan, {
      approvalStatus: "REJECTED",
      approverId: mudur.id,
      approvalReasonId: gerekce.id,
      approvalReasonKind: "REJECTED",
    });

    // Ret bir son durumdur; yapılacak iş bırakmaz.
    expect((await listWorkQueue(testDb, bakan(mudur.id), NOW)).items).toHaveLength(0);
    expect((await listWorkQueue(testDb, bakan(calisan.id), NOW)).items).toHaveLength(0);
  });
});

describe("sıralama ve bekleme", () => {
  it("en uzun bekleyen en üstte", async () => {
    const { mudur, calisan } = await sirket();
    await createActivity(calisan, {
      title: "Yeni iş",
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: NOW,
    });
    await createActivity(calisan, {
      title: "Eski iş",
      activityDate: new Date("2026-08-13T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: NOW,
    });

    const kuyruk = await listWorkQueue(testDb, bakan(mudur.id), NOW);

    // Tür sırasına göre dizmek, üç gündür bekleyen bir işi bugün geleninin
    // altına düşürürdü.
    expect(kuyruk.items.map((is) => is.activityTitle)).toEqual([
      "Eski iş",
      "Yeni iş",
    ]);
  });

  it("bekleme iş günüyle sayılır, hafta sonu atlanır", async () => {
    const { mudur, calisan } = await sirket();
    // 14 Ağustos 2026 Cuma; 19 Ağustos Çarşamba. Aradaki takvim günü 5,
    // iş günü 3 (15-16 hafta sonu).
    await createActivity(calisan, {
      activityDate: new Date("2026-08-14T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: NOW,
    });

    const kuyruk = await listWorkQueue(testDb, bakan(mudur.id), NOW);

    expect(kuyruk.items[0]?.waitingBusinessDays).toBe(3);
  });

  it("bugün düşen iş sıfır gün bekliyor", async () => {
    const { mudur, calisan } = await sirket();
    await createActivity(calisan, {
      activityDate: new Date("2026-08-19T00:00:00.000Z"),
      approvalStatus: "PENDING_APPROVAL",
      approverId: mudur.id,
      approvalSubmittedAt: NOW,
    });

    expect(
      (await listWorkQueue(testDb, bakan(mudur.id), NOW)).items[0]
        ?.waitingBusinessDays,
    ).toBe(0);
  });
});

describe("boş kuyruk", () => {
  it("işi olmayanın kuyruğu boştur", async () => {
    const { akran } = await sirket();

    const kuyruk = await listWorkQueue(testDb, bakan(akran.id), NOW);

    expect(kuyruk.items).toHaveLength(0);
    expect(kuyruk.watched).toHaveLength(0);
  });
});
