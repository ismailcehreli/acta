import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { previewUnitMoveCalendar } from "@/server/calendar/move-preview";
import { DEFAULT_WORK_CALENDAR, saveWorkCalendar } from "@/server/calendar/settings";
import {
  clearUnitWorkCalendar,
  MESAI_PENCERESI_KILIDI,
  saveUnitWorkCalendar,
} from "@/server/calendar/unit-calendar";
import { moveOrgUnit } from "@/server/org/tree";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Birim taşımanın **görünmeyen yan etkisi** (denetim 23.08.2026,
// bulgu 14; tasarım Paket H).
//
// Taşıma yalnız ağaç görünümünü değiştirmiyor: birimin mesai penceresi
// üstünden devralınıyor, dolayısıyla o birimdeki herkesin hatırlatma saati
// ve skor paydası da kayıyor. Tasarım bunun için açık bir uyarı istiyor:
// *"Bu birim taşındığında mesai penceresi X'ten Y'ye değişecek."*
//
// Arayüz yeni üstü seçer seçmez taşıyordu; ne önizleme ne onay vardı.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function agac() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const fabrika = await createOrgUnit({ name: "Fabrika", parentId: kok.id });
  const ofis = await createOrgUnit({ name: "Ofis", parentId: kok.id });
  const depo = await createOrgUnit({ name: "Depo", parentId: fabrika.id });
  const yonetici = await createUser(kok.id, {
    fullName: "Sistem Yöneticisi",
    isSystemAdmin: true,
  });

  // Fabrika cumartesi de çalışıyor ve erken başlıyor; ofis standart.
  await saveUnitWorkCalendar(testDb, fabrika.id, {
    workingDays: [1, 2, 3, 4, 5, 6],
    workStartMinute: 7 * 60,
    workEndMinute: 17 * 60,
    worksOnHolidays: true,
  });
  await saveUnitWorkCalendar(testDb, ofis.id, {
    workingDays: [1, 2, 3, 4, 5],
    workStartMinute: 9 * 60,
    workEndMinute: 18 * 60,
    worksOnHolidays: false,
  });

  return { kok, fabrika, ofis, depo, yonetici };
}

describe("taşıma önizlemesi", () => {
  it("devralınan pencere değişiyorsa iki değeri de verir", async () => {
    const { ofis, depo } = await agac();

    const onizleme = await previewUnitMoveCalendar(testDb, depo.id, ofis.id);

    expect(onizleme.degisiyor).toBe(true);
    expect(onizleme.mevcut.workStartMinute).toBe(7 * 60);
    expect(onizleme.mevcut.worksOnHolidays).toBe(true);
    expect(onizleme.yeni.workStartMinute).toBe(9 * 60);
    expect(onizleme.yeni.worksOnHolidays).toBe(false);
    // Devralındığı birim de görünüyor: "Fabrika'dan devralındı" → "Ofis'ten".
    expect(onizleme.mevcut.sourceUnitName).toBe("Fabrika");
    expect(onizleme.yeni.sourceUnitName).toBe("Ofis");
  });

  it("kendi takvimi olan birimde pencere değişmez", async () => {
    const { ofis, depo } = await agac();
    await saveUnitWorkCalendar(testDb, depo.id, {
      workingDays: [1, 2, 3],
      workStartMinute: 8 * 60,
      workEndMinute: 16 * 60,
      worksOnHolidays: false,
    });

    const onizleme = await previewUnitMoveCalendar(testDb, depo.id, ofis.id);

    // Kendi satırı olan birim üstünden devralmıyor: taşıma penceresini
    // değiştirmez ve gereksiz onay istenmez.
    expect(onizleme.degisiyor).toBe(false);
  });

  it("aynı değerleri taşıyan iki üst arasında değişiklik yok", async () => {
    const { kok, fabrika, depo } = await agac();
    const ikizFabrika = await createOrgUnit({ name: "Fabrika 2", parentId: kok.id });
    await saveUnitWorkCalendar(testDb, ikizFabrika.id, {
      workingDays: [1, 2, 3, 4, 5, 6],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: true,
    });

    const onizleme = await previewUnitMoveCalendar(testDb, depo.id, ikizFabrika.id);

    expect(fabrika.id).not.toBe(ikizFabrika.id);
    expect(onizleme.degisiyor).toBe(false);
  });
});

describe("taşıma onayı", () => {
  it("pencere değişiyorsa onaysız taşıma geçmez", async () => {
    const { ofis, depo, yonetici } = await agac();

    const sonuc = await moveOrgUnit(
      testDb,
      { id: depo.id, newParentId: ofis.id },
      yonetici.id,
    );

    expect(sonuc.ok).toBe(false);
    if (!sonuc.ok) {
      expect(sonuc.error).toBe("calendar_change_unconfirmed");
      // Ekranın uyarıyı çizebilmesi için iki pencere de dönüyor.
      expect(sonuc.calendarChange?.yeni.workStartMinute).toBe(9 * 60);
    }

    const taze = await testDb.orgUnit.findUniqueOrThrow({ where: { id: depo.id } });
    expect(taze.parentId).not.toBe(ofis.id);
  });

  it("doğru imzayla onaylanan taşıma geçer", async () => {
    const { ofis, depo, yonetici } = await agac();
    const onizleme = await previewUnitMoveCalendar(testDb, depo.id, ofis.id);

    const sonuc = await moveOrgUnit(
      testDb,
      {
        id: depo.id,
        newParentId: ofis.id,
        confirmedCalendarSignature: onizleme.imza,
      },
      yonetici.id,
    );

    expect(sonuc.ok).toBe(true);
    const taze = await testDb.orgUnit.findUniqueOrThrow({ where: { id: depo.id } });
    expect(taze.parentId).toBe(ofis.id);
  });

  it("araya giren takvim değişikliği onayı geçersiz kılar", async () => {
    const { ofis, depo, yonetici } = await agac();
    const onizleme = await previewUnitMoveCalendar(testDb, depo.id, ofis.id);

    // Yönetici onaylamadan önce ofisin takvimi değişti: kullanıcının gördüğü
    // "X'ten Y'ye" cümlesi artık doğru değil.
    await saveUnitWorkCalendar(testDb, ofis.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 10 * 60,
      workEndMinute: 19 * 60,
      worksOnHolidays: false,
    });

    const sonuc = await moveOrgUnit(
      testDb,
      {
        id: depo.id,
        newParentId: ofis.id,
        confirmedCalendarSignature: onizleme.imza,
      },
      yonetici.id,
    );

    expect(sonuc.ok).toBe(false);
    if (!sonuc.ok) expect(sonuc.error).toBe("calendar_preview_stale");

    const taze = await testDb.orgUnit.findUniqueOrThrow({ where: { id: depo.id } });
    expect(taze.parentId).not.toBe(ofis.id);
  });

  it("pencere değişmiyorsa onay istenmez", async () => {
    const { kok, depo, yonetici } = await agac();
    const ikiz = await createOrgUnit({ name: "Fabrika 2", parentId: kok.id });
    await saveUnitWorkCalendar(testDb, ikiz.id, {
      workingDays: [1, 2, 3, 4, 5, 6],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: true,
    });

    const sonuc = await moveOrgUnit(
      testDb,
      { id: depo.id, newParentId: ikiz.id },
      yonetici.id,
    );

    expect(sonuc.ok).toBe(true);
  });
});

// **Kontrol ile yazma arasındaki pencere** (denetim 24.08.2026, P4-1).
//
// İmza karşılaştırması taşımayla aynı işlemde yapılıyordu ama takvim yazma
// yolları aynı kilide katılmıyordu: taşıma imzayı doğrulayıp satır kilidinde
// beklerken hedef birimin takvimi değiştirilebiliyor ve taşıma onaylanandan
// **başka** bir pencereyle tamamlanıyordu. Ardışık test bu pencereyi hiç
// açmıyor.
describe("taşıma ile takvim yazısı yarışı", () => {
  /** Taşıma işlemini, imza kontrolünden sonra, yazmadan hemen önce durdurur. */
  function bariyerliDb(hazirEt: () => void, bekle: Promise<void>) {
    return {
      ...testDb,
      $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
        testDb.$transaction((tx) =>
          fn(
            new Proxy(tx, {
              get(hedef, alan) {
                if (alan !== "orgUnit") return Reflect.get(hedef, alan);

                const tablo = Reflect.get(hedef, alan) as {
                  update: (...args: unknown[]) => Promise<unknown>;
                };

                return new Proxy(tablo, {
                  get(tabloHedef, tabloAlan) {
                    if (tabloAlan !== "update") {
                      return Reflect.get(tabloHedef, tabloAlan);
                    }

                    return async (...args: unknown[]) => {
                      hazirEt();
                      await bekle;
                      return tablo.update(...args);
                    };
                  },
                });
              },
            }),
          ),
        )) as typeof testDb.$transaction,
    } as unknown as typeof testDb;
  }

  it("araya giren takvim yazısı taşıma bitene kadar bekler", async () => {
    const { ofis, depo, yonetici } = await agac();
    const onizleme = await previewUnitMoveCalendar(testDb, depo.id, ofis.id);

    let hazirEt = () => {};
    const hazir = new Promise<void>((c) => (hazirEt = c));
    let birak = () => {};
    const bekle = new Promise<void>((c) => (birak = c));

    const tasima = moveOrgUnit(
      bariyerliDb(() => hazirEt(), bekle),
      {
        id: depo.id,
        newParentId: ofis.id,
        confirmedCalendarSignature: onizleme.imza,
      },
      yonetici.id,
    );

    await hazir;

    // Yönetici onayladıktan sonra, taşıma tamamlanmadan gelen takvim yazısı.
    let takvimBitti = false;
    const takvimYazisi = saveUnitWorkCalendar(testDb, ofis.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 10 * 60,
      workEndMinute: 19 * 60,
      worksOnHolidays: false,
    }).then(() => {
      takvimBitti = true;
    });

    await new Promise((c) => setTimeout(c, 200));

    // Ortak kilit olmadan bu yazı çoktan bitmiş olurdu ve taşıma onaylanan
    // 09:00 yerine 10:00 ile tamamlanırdı.
    expect(takvimBitti).toBe(false);

    birak();
    const sonuc = await tasima;
    await takvimYazisi;

    expect(sonuc.ok).toBe(true);
    expect(takvimBitti).toBe(true);
  });
});

// P4-R2-5: üç yazıcı üç ayrı üretim fonksiyonudur. Yalnız birini temsilci
// seçmek, diğer ikisindeki kilit satırı kaldırıldığında paketi yeşil bırakır.
// Burada süreye bakıp "herhalde bekliyor" demiyoruz; PostgreSQL'in ilgili
// bağlantıyı gerçekten `advisory` kilidinde beklettiğini pg_stat_activity'den
// doğruluyoruz.
describe("bütün mesai penceresi yazıcıları ortak kilide katılır", () => {
  function pidIzleyenDb(pidHazir: (pid: number) => void) {
    return {
      ...testDb,
      $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
        testDb.$transaction(async (tx) => {
          const [satir] = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid()::int AS pid
          `;
          if (!satir) throw new Error("Yazıcı bağlantısının pid değeri okunamadı.");
          pidHazir(satir.pid);
          return fn(tx);
        })) as typeof testDb.$transaction,
    } as unknown as typeof testDb;
  }

  async function advisoryBeklemesiniDogrula(pid: number): Promise<void> {
    for (let deneme = 0; deneme < 100; deneme += 1) {
      const [satir] = await testDb.$queryRaw<Array<{ bekliyor: boolean }>>`
        SELECT ("wait_event_type" = 'Lock' AND "wait_event" = 'advisory') AS bekliyor
        FROM pg_stat_activity
        WHERE pid = ${pid}
      `;
      if (satir?.bekliyor) return;
      await new Promise((coz) => setTimeout(coz, 10));
    }

    throw new Error(`PID ${pid} mesai penceresi danışma kilidinde beklemedi.`);
  }

  it.each(["şirket takvimi", "birim takvimi", "birim tanımını kaldırma"] as const)(
    "%s yazıcısı kilit tutulurken advisory beklemesine girer",
    async (yol) => {
      const birim = await createOrgUnit({ name: `Kilit ${yol}` });
      if (yol === "birim tanımını kaldırma") {
        await saveUnitWorkCalendar(testDb, birim.id, {
          workingDays: [1, 2, 3, 4, 5],
          workStartMinute: 8 * 60,
          workEndMinute: 17 * 60,
          worksOnHolidays: false,
        });
      }

      let kilitHazirEt = () => {};
      const kilitHazir = new Promise<void>((coz) => (kilitHazirEt = coz));
      let kilidiBirak = () => {};
      const birak = new Promise<void>((coz) => (kilidiBirak = coz));

      const kilitTutucu = testDb.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${MESAI_PENCERESI_KILIDI}))
        `;
        kilitHazirEt();
        await birak;
      });
      await kilitHazir;

      let pidHazirEt!: (pid: number) => void;
      const pidHazir = new Promise<number>((coz) => (pidHazirEt = coz));
      const db = pidIzleyenDb(pidHazirEt);

      const yazici =
        yol === "şirket takvimi"
          ? saveWorkCalendar(db, {
              ...DEFAULT_WORK_CALENDAR,
              workStartMinute: 9 * 60,
              workEndMinute: 18 * 60,
            })
          : yol === "birim takvimi"
            ? saveUnitWorkCalendar(db, birim.id, {
                workingDays: [1, 2, 3, 4, 5],
                workStartMinute: 9 * 60,
                workEndMinute: 18 * 60,
                worksOnHolidays: false,
              })
            : clearUnitWorkCalendar(db, birim.id);

      try {
        const pid = await pidHazir;
        await advisoryBeklemesiniDogrula(pid);
      } finally {
        kilidiBirak();
        await kilitTutucu;
        await yazici;
      }
    },
  );
});
