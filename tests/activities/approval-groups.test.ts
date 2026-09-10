import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  approveMany,
  listApprovalGroups,
} from "@/server/activities/approval-groups";
import { AUDIT_ACTIONS } from "@/server/audit/log";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Kişi + gün bazlı toplu onay (Görev 10.6).
//
// En kritik iki davranış:
//   1. Toplu onay **yeni bir yetki yolu açmaz** — başkasının kaydı geçmez.
//   2. Ekranda görünmeyen kayıt onaylanmaz — müdür okumadığını onaylamış
//      olmamalı.

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

  return { mudur, akranMudur, kadir, nazli };
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

describe("gruplama", () => {
  it("aynı kişinin aynı günü tek grupta toplanır", async () => {
    const { mudur, kadir } = await sirket();
    await createActivity(kadir, bekleyen("2026-08-19", "Sabah işi", mudur.id));
    await createActivity(kadir, bekleyen("2026-08-19", "Öğleden sonra", mudur.id));

    const gruplar = await listApprovalGroups(testDb, mudur.id, NOW);

    expect(gruplar).toHaveLength(1);
    expect(gruplar[0]?.items).toHaveLength(2);
    expect(gruplar[0]?.authorName).toBe("Kadir Usta");
  });

  it("farklı gün ayrı grup olur", async () => {
    const { mudur, kadir } = await sirket();
    await createActivity(kadir, bekleyen("2026-08-18", "Dünkü", mudur.id));
    await createActivity(kadir, bekleyen("2026-08-19", "Bugünkü", mudur.id));

    const gruplar = await listApprovalGroups(testDb, mudur.id, NOW);

    expect(gruplar).toHaveLength(2);
    // En eski gün üstte: en uzun bekleyen iş önce.
    expect(gruplar[0]?.day).toBe("2026-08-18");
  });

  it("farklı kişi ayrı grup olur", async () => {
    const { mudur, kadir, nazli } = await sirket();
    await createActivity(kadir, bekleyen("2026-08-19", "Kadir'in işi", mudur.id));
    await createActivity(nazli, bekleyen("2026-08-19", "Nazlı'nın işi", mudur.id));

    const gruplar = await listApprovalGroups(testDb, mudur.id, NOW);

    expect(gruplar).toHaveLength(2);
    expect(new Set(gruplar.map((g) => g.authorName))).toEqual(
      new Set(["Kadir Usta", "Nazlı Usta"]),
    );
  });

  it("başkasının onayındaki kayıt listede yer almaz", async () => {
    const { mudur, akranMudur, kadir } = await sirket();
    await createActivity(kadir, bekleyen("2026-08-19", "Müdürün onayında", mudur.id));

    expect(await listApprovalGroups(testDb, akranMudur.id, NOW)).toHaveLength(0);
  });

  it("onaylanmış kayıt listede yer almaz", async () => {
    const { mudur, kadir } = await sirket();
    await createActivity(kadir, {
      title: "Onaylanmış",
      approvalStatus: "APPROVED",
      approverId: mudur.id,
    });

    expect(await listApprovalGroups(testDb, mudur.id, NOW)).toHaveLength(0);
  });

  it("grup açıklamayı da taşır", async () => {
    const { mudur, kadir } = await sirket();
    await createActivity(kadir, {
      ...bekleyen("2026-08-19", "Kalıp bakımı", mudur.id),
      description: "Üç numaralı kalıpta erken aşınma tespit edildi.",
    });

    const gruplar = await listApprovalGroups(testDb, mudur.id, NOW);

    // Müdürün onaylamadan önce okuması gereken şey açıklamadır; yalnız başlık
    // gösterip "hepsini onayla" demek okumadan onaylamayı kolaylaştırırdı.
    expect(gruplar[0]?.items[0]?.description).toContain("erken aşınma");
  });
});

describe("toplu onay", () => {
  it("görünen kayıtların tamamını onaylar", async () => {
    const { mudur, kadir } = await sirket();
    const bir = await createActivity(kadir, bekleyen("2026-08-19", "Bir", mudur.id));
    const iki = await createActivity(kadir, bekleyen("2026-08-19", "İki", mudur.id));

    const sonuc = await approveMany(testDb, mudur.id, [bir.id, iki.id], NOW);

    expect(sonuc.approved).toBe(2);
    expect(sonuc.skipped).toHaveLength(0);
    const durumlar = await testDb.activity.findMany({
      where: { id: { in: [bir.id, iki.id] } },
      select: { approvalStatus: true },
    });
    expect(durumlar.every((k) => k.approvalStatus === "APPROVED")).toBe(true);
  });

  it("başkasının kaydı toplu onayla geçmez", async () => {
    const { mudur, akranMudur, kadir } = await sirket();
    const benim = await createActivity(kadir, bekleyen("2026-08-19", "Benim", mudur.id));
    const onun = await createActivity(
      kadir,
      bekleyen("2026-08-19", "Akranın", akranMudur.id),
    );

    // Müdür, elle kimlik uydurup başkasının kaydını listeye ekleyemez.
    const sonuc = await approveMany(testDb, mudur.id, [benim.id, onun.id], NOW);

    expect(sonuc.approved).toBe(1);
    expect(sonuc.skipped).toHaveLength(1);
    const digeri = await testDb.activity.findUniqueOrThrow({ where: { id: onun.id } });
    expect(digeri.approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("sonradan eklenen kayıt toplu onaya dahil olmaz", async () => {
    const { mudur, kadir } = await sirket();
    const gorulen = await createActivity(
      kadir,
      bekleyen("2026-08-19", "Ekranda görünen", mudur.id),
    );
    // Müdür ekranı açtıktan sonra gelen kayıt.
    const sonradan = await createActivity(
      kadir,
      bekleyen("2026-08-19", "Sonradan gelen", mudur.id),
    );

    await approveMany(testDb, mudur.id, [gorulen.id], NOW);

    const yeni = await testDb.activity.findUniqueOrThrow({ where: { id: sonradan.id } });
    // Kapsasaydı müdür **okumadığı bir kaydı** onaylamış olurdu.
    expect(yeni.approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("her onay kendi denetim izini ve bildirimini bırakır", async () => {
    const { mudur, kadir } = await sirket();
    const bir = await createActivity(kadir, bekleyen("2026-08-19", "Bir", mudur.id));
    const iki = await createActivity(kadir, bekleyen("2026-08-19", "İki", mudur.id));

    await approveMany(testDb, mudur.id, [bir.id, iki.id], NOW);

    // Toplu bir `updateMany` yazsaydık iz ve bildirim kaybolurdu.
    const izler = await testDb.auditLog.count({
      where: {
        action: AUDIT_ACTIONS.activityApproved,
        objectId: { in: [bir.id, iki.id] },
      },
    });
    expect(izler).toBe(2);

    const bildirimler = await testDb.notificationQueue.count({
      where: {
        userId: kadir.id,
        eventType: NOTIFICATION_EVENTS.activityApproved,
      },
    });
    expect(bildirimler).toBe(2);
  });

  it("durumu değişmiş kayıt sessizce atlanmaz", async () => {
    const { mudur, kadir } = await sirket();
    const kayit = await createActivity(kadir, bekleyen("2026-08-19", "Bir", mudur.id));
    await approveMany(testDb, mudur.id, [kayit.id], NOW);

    // İkinci kez gönderilirse (sayfa yenilenmemiş) sessiz başarı dönmez.
    const tekrar = await approveMany(testDb, mudur.id, [kayit.id], NOW);

    expect(tekrar.approved).toBe(0);
    expect(tekrar.skipped[0]?.message).toContain("onay bekleyen durumda değil");
  });
});
