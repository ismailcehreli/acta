import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity, rejectActivity } from "@/server/activities/approval";
import { createActivity as yazFaaliyet } from "@/server/activities/write";
import { closeScorePeriod } from "@/server/scoring/close-period";
import { readUserScore } from "@/server/scoring/read";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Canlı dönemin paydası (denetim 23.08.2026, bulgu 7).
//
// İçinde bulunulan dönem için payda **ayın sonuna kadar** sayılıyordu: ayın
// 3'ünde kullanıcı, henüz yaşanmamış 20 iş gününde kayıt girmemiş sayılıp
// düzenlilik puanını kaybediyordu. Skor ay boyunca sistematik olarak düşük
// görünüyordu.
//
// Kural: canlı dönemde `to = min(şirket bugünü, dönem sonu)`; kapanmış
// dönemde tam ay.

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });
  return { kadir };
}

describe("canlı dönemde payda bugüne kadar sayılır", () => {
  // 3 Ağustos 2026 pazartesi. 1'i cumartesi, 2'si pazar: dönemin başından
  // bugüne kadar **tek** iş günü var.
  const AYIN_UCU = new Date("2026-08-03T09:00:00.000Z");

  it("ayın başında payda yalnız yaşanmış iş günlerini sayar", async () => {
    const { kadir } = await sirket();
    await createActivity(kadir, {
      activityDate: new Date("2026-08-03T00:00:00.000Z"),
    });

    const skor = await readUserScore(
      testDb,
      { id: kadir.id, isSystemAdmin: false },
      kadir.id,
      AYIN_UCU,
    );

    expect(skor?.expectedDays).toBe(1);
    expect(skor?.writtenDays).toBe(1);
  });

  it("yaşanmamış günler yüzünden düzenlilik düşmez", async () => {
    const { kadir } = await sirket();
    await createActivity(kadir, {
      activityDate: new Date("2026-08-03T00:00:00.000Z"),
    });

    const skor = await readUserScore(
      testDb,
      { id: kadir.id, isSystemAdmin: false },
      kadir.id,
      AYIN_UCU,
    );

    // Yaşanmış tek iş gününde kayıt var: düzenlilik tam.
    expect(skor?.regularity).toBe(90);
  });

  it("ay ilerledikçe payda büyür", async () => {
    const { kadir } = await sirket();

    const ucundeki = await readUserScore(
      testDb,
      { id: kadir.id, isSystemAdmin: false },
      kadir.id,
      AYIN_UCU,
    );
    const onundeki = await readUserScore(
      testDb,
      { id: kadir.id, isSystemAdmin: false },
      kadir.id,
      new Date("2026-08-10T09:00:00.000Z"),
    );

    expect(ucundeki?.expectedDays).toBe(1);
    expect(onundeki?.expectedDays).toBe(6);
  });

  it("kapanmış dönem tam ayı kullanır", async () => {
    const { kadir } = await sirket();
    await createActivity(kadir, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    // 3 Ağustos'ta koşar, Temmuz'u kapatır: payda ayın **tamamı**.
    // Ayın 1'i değil: geriye giriş penceresi kapanmadan dönem dondurulmuyor
    // (denetim 25.08.2026, P8-R2-2).
    await closeScorePeriod(testDb, new Date(Date.UTC(2026, 7, 3, 6, 0, 0)));

    const satir = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: kadir.id },
    });

    // Temmuz 2026'da 23 hafta içi gün var.
    expect(satir.expectedDays).toBe(23);
  });
});

// Canlı skorda **bugünün işlemleri** de görünmeli (denetim 23.08.2026,
// P3-3). Üst sınır bugünün 00:00'ı olduğu sürece gün içinde verilen kararlar,
// yazılan cevaplar ve açılan maddeler hiç sayılmıyordu.
describe("canlı skorda bugünün zaman damgalı işlemleri", () => {
  const BUGUN_OGLEDEN_SONRA = new Date("2026-08-20T15:00:00.000Z");

  it("bugün verilen kararlar onay süresi boyutuna girer", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({
      name: "Kalıphane",
      parentId: kok.id,
      requiresApproval: true,
    });
    const mudur = await createUser(birim.id, {
      fullName: "Kalıphane Müdürü",
      isUnitManager: true,
    });
    const kadir = await createUser(birim.id, { fullName: "Kadir Usta" });

    const yaz = async (gun: string, an: string) => {
      const sonuc = await yazFaaliyet(
        testDb,
        { id: kadir.id, orgUnitId: birim.id, requiresApproval: true },
        {
          activityDate: gun,
          title: "Kalıp bakımı yapıldı",
          description: "Kalıp söküldü, temizlendi ve yeniden kuruldu.",
          targetDepartmentIds: [birim.id],
        },
        new Date(an),
      );
      if (!sonuc.ok) throw new Error(`faaliyet yazılamadı: ${sonuc.error}`);
      return sonuc.activity;
    };

    // Bugün iki karar: biri zamanında (1 iş günü), biri geç (5 iş günü).
    const hizli = await yaz("2026-08-19", "2026-08-19T08:00:00.000Z");
    await approveActivity(
      testDb,
      mudur.id,
      hizli.id,
      new Date("2026-08-20T09:00:00.000Z"),
    );

    const gec = await yaz("2026-08-13", "2026-08-13T08:00:00.000Z");
    const gerekce = await createApprovalReason("REJECTED");
    await rejectActivity(
      testDb,
      mudur.id,
      gec.id,
      { reasonId: gerekce.id },
      new Date("2026-08-20T10:00:00.000Z"),
    );

    const skor = await readUserScore(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      mudur.id,
      BUGUN_OGLEDEN_SONRA,
    );

    // İkisinden biri zamanında: 30 ağırlığın yarısı. Bugünün kararları hiç
    // görünmeseydi payda sıfır kalır ve boyut **tam puan** verirdi.
    expect(skor?.approval).toBe(15);
  });
});
