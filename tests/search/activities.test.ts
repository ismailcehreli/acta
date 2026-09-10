import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  searchActivities,
  splitHighlights,
} from "@/server/search/activities";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Görev 5.2 (§16.2): Türkçe tam metin arama. Sonuçlar görünürlük kapsamıyla
// sınırlı; kapsam dışı bir kayıt hiçbir sorguyla dönmez (§18.4).

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const gm = await createOrgUnit({ name: "Genel Müdürlük", parentId: root.id });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: gm.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: gm.id });

  const genelMudur = await createUser(gm.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const kalipMudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const planlamaMudur = await createUser(planlama.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });

  const kalipCalisan = await createUser(kaliphane.id, {
    fullName: "Kalıphane Çalışanı",
  });

  return { genelMudur, kalipMudur, planlamaMudur, kalipCalisan };
}

async function faaliyet(
  author: { id: string; orgUnitId: string },
  title: string,
  description: string,
  approvalStatus: "APPROVED" | "CANCELLED" | "PENDING_APPROVAL" = "APPROVED",
) {
  const onaylayanId =
    approvalStatus === "PENDING_APPROVAL" ? await onaylayiciIdsi(author.id) : null;

  const kayit = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: author.orgUnitId,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title,
      description,
      approvalStatus,
      // Onay sürecindeki kayıt onaylayıcı ister (veritabanı kısıtı); §4.4'ün
      // çözdüğü gerçek yönetici yazılır.
      approverId: onaylayanId,
    },
  });

  // Uygun onaylayıcılar listesi, üretimde kayıtla birlikte doğuyor.
  if (onaylayanId) {
    await testDb.activityApprover.create({
      data: { activityId: kayit.id, userId: onaylayanId },
    });
  }

  return kayit;
}

const viewer = (u: { id: string }) => ({ id: u.id, isSystemAdmin: false });

describe("Türkçe tam metin arama", () => {
  it("ek almış kelimeyle eşleşir", async () => {
    const { genelMudur, kalipMudur } = await sirket();
    await faaliyet(kalipMudur, "Kalıp bakımı", "Presteki kalıplar sökülüp temizlendi.");

    // Kayıtta "kalıplar" geçiyor; kullanıcı "kalıp" arıyor.
    const sonuc = await searchActivities(testDb, viewer(genelMudur), "kalıp");

    expect(sonuc.total).toBe(1);
    expect(sonuc.hits[0].title).toBe("Kalıp bakımı");
  });

  it("başlıkta da açıklamada da arar", async () => {
    const { genelMudur, kalipMudur } = await sirket();
    await faaliyet(kalipMudur, "Enjeksiyon hattı", "Rutin kontrol yapıldı.");
    await faaliyet(kalipMudur, "Günlük tur", "Enjeksiyon makinesi durdu.");

    const sonuc = await searchActivities(testDb, viewer(genelMudur), "enjeksiyon");

    expect(sonuc.total).toBe(2);
  });

  it("eşleşmeyen sorgu boş döner", async () => {
    const { genelMudur, kalipMudur } = await sirket();
    await faaliyet(kalipMudur, "Kalıp bakımı", "Presteki kalıplar temizlendi.");

    const sonuc = await searchActivities(testDb, viewer(genelMudur), "muhasebe");

    expect(sonuc).toEqual({ hits: [], total: 0, page: 1, pageCount: 0 });
  });

  it("boş sorgu hiçbir şey döndürmez", async () => {
    const { genelMudur, kalipMudur } = await sirket();
    await faaliyet(kalipMudur, "Kalıp bakımı", "Presteki kalıplar temizlendi.");

    for (const bos of ["", "   "]) {
      const sonuc = await searchActivities(testDb, viewer(genelMudur), bos);
      expect(sonuc.total).toBe(0);
    }
  });

  it("eşleşen yer özet içinde işaretlenir", async () => {
    const { genelMudur, kalipMudur } = await sirket();
    await faaliyet(
      kalipMudur,
      "Hat duruşu",
      "Sabah vardiyasında enjeksiyon makinesi arıza verdi ve hat durdu.",
    );

    const sonuc = await searchActivities(testDb, viewer(genelMudur), "arıza");

    // Özet HTML değildir: `<mark>` üretmek, kullanıcının yazdığı metni HTML
    // olarak çalıştırmak demekti.
    expect(sonuc.hits[0].snippet).toContain(HIGHLIGHT_START);
    expect(sonuc.hits[0].snippet).not.toContain("<mark>");

    const parcalar = splitHighlights(sonuc.hits[0].snippet);
    expect(parcalar.some((p) => p.marked && /arıza/i.test(p.text))).toBe(true);
  });

  it("açıklamadaki HTML özetten geçse de etiket olarak taşınmaz", async () => {
    const { genelMudur, kalipMudur } = await sirket();
    await faaliyet(
      kalipMudur,
      "Betik denemesi",
      "<script>alert(1)</script> presinde arıza vardı.",
    );

    const sonuc = await searchActivities(testDb, viewer(genelMudur), "arıza");
    const parcalar = splitHighlights(sonuc.hits[0].snippet);

    // Parçalar düz metindir; ekran onları metin olarak basar.
    expect(parcalar.every((p) => typeof p.text === "string")).toBe(true);
    expect(sonuc.hits[0].snippet).not.toContain("<mark>");
  });
});

describe("arama görünürlük kapsamını aşamaz (§18.4)", () => {
  it("akranın kaydı hiçbir sorguyla dönmez", async () => {
    const { kalipMudur, planlamaMudur } = await sirket();
    const akranKaydi = await faaliyet(
      planlamaMudur,
      "Planlama toplantısı",
      "Haftalık üretim planı gözden geçirildi.",
    );

    const sonuc = await searchActivities(testDb, viewer(kalipMudur), "planlama");

    expect(sonuc.total).toBe(0);
    expect(sonuc.hits.map((h) => h.id)).not.toContain(akranKaydi.id);
  });

  it("onaylayıcının üstündeki kademe onay bekleyen kaydı bulamaz", async () => {
    // Çalışanın onaylayıcısı Kalıphane Müdürü'dür; Genel Müdür onun üstüdür ve
    // onay bitene kadar kaydı görmemeli (§8.2).
    const { genelMudur, kalipCalisan } = await sirket();
    const taslak = await faaliyet(
      kalipCalisan,
      "Taslak kalıp raporu",
      "Henüz tamamlanmadı.",
      "PENDING_APPROVAL",
    );

    const sonuc = await searchActivities(testDb, viewer(genelMudur), "kalıp");

    expect(sonuc.hits.map((h) => h.id)).not.toContain(taslak.id);
  });

  it("onaylayıcı kendi önündeki onay bekleyen kaydı bulur", async () => {
    const { kalipMudur, kalipCalisan } = await sirket();
    const taslak = await faaliyet(
      kalipCalisan,
      "Taslak kalıp raporu",
      "Henüz tamamlanmadı.",
      "PENDING_APPROVAL",
    );

    const sonuc = await searchActivities(testDb, viewer(kalipMudur), "kalıp");

    expect(sonuc.hits.map((h) => h.id)).toContain(taslak.id);
  });

  it("yazan kendi onaylanmamış kaydını bulur", async () => {
    const { kalipCalisan } = await sirket();
    const taslak = await faaliyet(
      kalipCalisan,
      "Taslak kalıp raporu",
      "Henüz tamamlanmadı.",
      "PENDING_APPROVAL",
    );

    const sonuc = await searchActivities(testDb, viewer(kalipCalisan), "kalıp");

    expect(sonuc.hits.map((h) => h.id)).toContain(taslak.id);
  });

  it("iptal edilmiş kayıt aramada kalır (§5.5)", async () => {
    const { genelMudur, kalipMudur } = await sirket();
    const iptal = await faaliyet(
      kalipMudur,
      "İptal edilen kalıp işi",
      "Yanlış girilmişti.",
      "CANCELLED",
    );

    const sonuc = await searchActivities(testDb, viewer(genelMudur), "kalıp");

    const bulunan = sonuc.hits.find((h) => h.id === iptal.id);
    expect(bulunan).toBeDefined();
    // Etiketi ekranın gösterebilmesi için durum sonuçta taşınır.
    expect(bulunan?.approvalStatus).toBe("CANCELLED");
  });
});

describe("sayfalama", () => {
  it("bütün sonuçlar gezilebilir, hiçbiri kesilmez", async () => {
    const { genelMudur, kalipMudur } = await sirket();
    for (let i = 0; i < 30; i += 1) {
      await faaliyet(kalipMudur, `Kalıp işi ${i + 1}`, "Kalıp bakımı yapıldı.");
    }

    const ilk = await searchActivities(testDb, viewer(genelMudur), "kalıp", 1, 10);
    expect(ilk.total).toBe(30);
    expect(ilk.pageCount).toBe(3);
    expect(ilk.hits).toHaveLength(10);

    const idler = new Set(ilk.hits.map((h) => h.id));
    for (const sayfa of [2, 3]) {
      const sonraki = await searchActivities(
        testDb,
        viewer(genelMudur),
        "kalıp",
        sayfa,
        10,
      );
      expect(sonraki.hits).toHaveLength(10);
      for (const hit of sonraki.hits) idler.add(hit.id);
    }

    // Tekrar eden ya da atlanan kayıt yok.
    expect(idler.size).toBe(30);
  });

  it("sayfa numarası bozuk verilse de sorgu çalışır", async () => {
    const { genelMudur, kalipMudur } = await sirket();
    await faaliyet(kalipMudur, "Kalıp işi", "Kalıp bakımı yapıldı.");

    const sonuc = await searchActivities(testDb, viewer(genelMudur), "kalıp", -5);

    expect(sonuc.page).toBe(1);
    expect(sonuc.hits).toHaveLength(1);
  });
});

describe("özet ayrıştırma", () => {
  it("işaretli ve işaretsiz parçalara böler", () => {
    const snippet = `Sabah ${HIGHLIGHT_START}arıza${HIGHLIGHT_END} vardı`;

    expect(splitHighlights(snippet)).toEqual([
      { text: "Sabah ", marked: false },
      { text: "arıza", marked: true },
      { text: " vardı", marked: false },
    ]);
  });

  it("işaretsiz metni olduğu gibi verir", () => {
    expect(splitHighlights("düz metin")).toEqual([
      { text: "düz metin", marked: false },
    ]);
  });

  it("eşleşmemiş işaretleyicide metin yutmaz", () => {
    const parcalar = splitHighlights(`açık ${HIGHLIGHT_START}kaldı`);

    expect(parcalar.map((p) => p.text).join("")).toBe("açık kaldı");
  });
});

/** §4.4'ün çözdüğü yönetici; onay kısıtını sağlamak için gerçek kural. */
async function onaylayiciIdsi(userId: string): Promise<string | null> {
  const { resolveManager } = await import("@/server/org/resolve-manager");
  const sonuc = await resolveManager(testDb, userId);
  return sonuc.found ? sonuc.managerId : null;
}

/** Süzgeç testleri için ortak kurulum: kalıphaneden iki kayıt. */
async function suzgecKurulumu() {
  const { kalipMudur, kalipCalisan, planlamaMudur } = await sirket();
  await faaliyet(kalipCalisan, "Kalıp bakımı", "Üç numaralı kalıpta aşınma.");
  await faaliyet(kalipMudur, "Kalıp devri", "Kalıp vardiyaya devredildi.");
  return { mudur: kalipMudur, calisan: kalipCalisan, akran: planlamaMudur };
}

describe("arama süzgeçleri (Görev 10.9)", () => {
  it("süzgeç kapsamı genişletemez", async () => {
    const { calisan, akran, mudur } = await suzgecKurulumu();

    // Akran, çalışanın kaydını süzgeçle **isteyerek** hedeflese bile göremez.
    const sonuc = await searchActivities(
      testDb,
      { id: akran.id, isSystemAdmin: false },
      "kalıp",
      1,
      undefined,
      undefined,
      {
        period: "all",
        authorId: calisan.id,
        authorOrgUnitId: "",
        targetOrgUnitId: "",
      },
    );

    expect(sonuc.hits).toHaveLength(0);

    // Aynı süzgeçle müdür görebiliyor: sonuç boşluğu süzgeçten değil,
    // görünürlükten geliyor.
    const mudurunSonucu = await searchActivities(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      "kalıp",
      1,
      undefined,
      undefined,
      {
        period: "all",
        authorId: calisan.id,
        authorOrgUnitId: "",
        targetOrgUnitId: "",
      },
    );
    expect(mudurunSonucu.hits.length).toBeGreaterThan(0);
  });

  it("kişi süzgeci sonucu daraltır", async () => {
    const { mudur, calisan } = await suzgecKurulumu();

    const hepsi = await searchActivities(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      "kalıp",
      1,
    );
    const daraltilmis = await searchActivities(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      "kalıp",
      1,
      undefined,
      undefined,
      {
        period: "all",
        authorId: calisan.id,
        authorOrgUnitId: "",
        targetOrgUnitId: "",
      },
    );

    expect(daraltilmis.hits.length).toBeLessThanOrEqual(hepsi.hits.length);
    expect(
      daraltilmis.hits.every((hit) => hit.authorName === "Kalıphane Çalışanı"),
    ).toBe(true);
  });

  it("dönem süzgeci eski kaydı eler", async () => {
    const { mudur } = await suzgecKurulumu();

    const bugun = await searchActivities(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      "kalıp",
      1,
      undefined,
      undefined,
      {
        period: "today",
        authorId: "",
        authorOrgUnitId: "",
        targetOrgUnitId: "",
      },
      new Date("2026-09-30T09:00:00.000Z"),
    );

    // Kayıtlar ağustosta; eylül sonundaki "bugün" süzgeci hepsini eler.
    expect(bugun.hits).toHaveLength(0);
  });
});
