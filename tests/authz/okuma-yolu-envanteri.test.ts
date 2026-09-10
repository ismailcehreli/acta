import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

// GÖRÜNÜRLÜK KAPSAMININ ENVANTERİ (denetim 21.08.2026, öneri B5).
//
// `AGENTS.md`: *"Her okuma yolu (liste, detay, arama, ek indirme) tek
// görünürlük modülünden geçer."* Bu kural, kod incelemesiyle korunuyordu ve
// korunamadı: `listApprovalGroups`, `listPendingApprovals` ve bildirim kutusu
// kendi süzgeçlerini yazmıştı (bulgu 2 ve 3). Hiçbir test kırılmadı, çünkü
// hiçbir test "yeni bir faaliyet sorgusu eklendi mi" diye sormuyordu.
//
// Bu test onu soruyor. Faaliyet okuyan her dosya ya görünürlük modülünü
// kullanır ya da **gerekçesiyle** aşağıdaki listede durur. Yeni bir okuma
// yolu eklendiğinde test kırılır ve yazan kişi iki şeyden birini yapmak
// zorunda kalır: kapsamı uygulamak ya da neden gerekmediğini yazmak.
//
// Test kodun ne yaptığını **kanıtlamaz** — bunu görünürlük testleri yapıyor.
// Yaptığı şey, kapsamın dışına çıkan bir eklemenin sessiz kalmasını
// engellemek.

const KAYNAK_KOK = path.join(process.cwd(), "src");

/** Faaliyet tablosunu okuyan Prisma çağrıları. */
const OKUMA_DESENI =
  /\bactivity\.(findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|groupBy|aggregate)\b/;

/** Görünürlük modülünden geçtiğini gösteren işaretler. */
const KAPSAM_DESENI =
  /(visibleActivityWhere|visibleActivitySql|canViewActivity|canCancelActivity|approvalQueueWhere|gorunurFaaliyetler|gorunurlugeGoreAyir|visibleReportScope)/;

const MODEL_OKUMA_DESENI =
  /\b(activity|attachment)\.(findMany|findFirst|findUnique|count|groupBy|aggregate)\b/;
const HAM_ACTIVITY_SQL_DESENI =
  /\b(?:FROM|JOIN)\s+["`]Activity["`]/i;

/**
 * Kapsam uygulamayan ama **gerekçeli** dosyalar.
 *
 * Buraya bir satır eklemek bilinçli bir karardır: "bu okuma neden görünürlük
 * sormuyor" sorusunun cevabı burada durmalı.
 */
const GEREKCELI_ISTISNALAR: Record<string, string> = {
  "server/authz/visibility.ts": "Kapsamın kendisi burada tanımlanıyor.",
  "server/activities/write.ts":
    "Yazma yolu: kaydı kullanıcı kendisi oluşturuyor, okuma değil.",
  "server/activities/approval.ts":
    "Onay kuyruğu approvalQueueWhere'den geçiyor; kalan sorgular karar anında " +
    "kilitli satırı okuyor ve yetkiyi ayrıca doğruluyor.",
  "server/attachments/service.ts":
    "Yükleme yolu yazarla daraltılmış; indirme canViewActivity'den geçiyor.",
  "server/demo/data.ts": "Örnek veri kurulumu; kullanıcı okuması değil.",
  "server/demo/purge.ts":
    "Örnek veri temizliği; kapsam değil sahiplik sorgulanıyor (§22.3).",
  "server/notifications/visible-rows.ts":
    "Bildirim süzgecinin kendisi; kapsamı buradan okuyor.",
  "worker/reminders/no-activity.ts":
    "İşleyici süreci: 'bu kişi bugün yazdı mı' — kendi kaydına bakıyor.",
  "worker/reminders/overdue-approvals.ts":
    "İşleyici süreci: onay bekleyen kayıtları onaylayıcısına hatırlatıyor; " +
    "içerik taşımıyor, kimseye gösterilmiyor.",
  "app/page.tsx":
    "Yalnız `authorId: user.id` sayıyor — kişi kendi kayıtlarını her durumda " +
    "görür (§8.1). Sayfadaki içerikli listelerin hepsi kapsamdan geçen " +
    "servislerden geliyor.",
  "server/dashboard/work-queue.ts":
    "Yalnız `authorId: viewer.id` — kendi düzeltme talepleri. Kuyruğun onay " +
    "kısmı approvalQueueWhere'den geçiyor.",
  "server/dashboard/summary.ts":
    "Katılım sayacı: kimin bugün yazdığını sayıyor, ne yazdığını değil. " +
    "Kapsam `subordinates` listesiyle zaten daraltılmış.",
  "server/activities/delete.ts":
    "Root'un silme yolu (karar 03.09.2026). Kapsam sorulmuyor çünkü sistem " +
    "yöneticisi zaten hiçbir faaliyetin kapsamında değil (§15.1) ve kapsam " +
    "sorulsaydı silme hiç mümkün olmazdı. Sızıntı riski projeksiyonla " +
    "kapatılıyor: okuma yalnız **üst veri** döndürüyor (başlık, tarih, yazar, " +
    "birim, durum) — açıklama metni hiçbir dalda seçilmiyor. Yetki `isRoot` " +
    "ile ayrıca aranıyor.",
};

async function tsDosyalari(kok: string): Promise<string[]> {
  const girisler = await readdir(kok, { withFileTypes: true });
  const sonuc: string[] = [];

  for (const giris of girisler) {
    const tamYol = path.join(kok, giris.name);

    if (giris.isDirectory()) {
      sonuc.push(...(await tsDosyalari(tamYol)));
      continue;
    }

    if (giris.name.endsWith(".ts") || giris.name.endsWith(".tsx")) {
      sonuc.push(tamYol);
    }
  }

  return sonuc;
}

describe("faaliyet okuyan her dosya kapsamdan geçer", () => {
  it("kapsamsız yeni bir okuma yolu eklenmemiş", async () => {
    const dosyalar = await tsDosyalari(KAYNAK_KOK);
    const kapsamsizlar: string[] = [];

    for (const dosya of dosyalar) {
      const icerik = await readFile(dosya, "utf8");
      if (!OKUMA_DESENI.test(icerik)) continue;
      if (KAPSAM_DESENI.test(icerik)) continue;

      const bagil = path.relative(KAYNAK_KOK, dosya).split(path.sep).join("/");
      if (bagil in GEREKCELI_ISTISNALAR) continue;

      kapsamsizlar.push(bagil);
    }

    if (kapsamsizlar.length > 0) {
      console.log(
        "Görünürlük modülünü kullanmayan faaliyet okuması:\n  " +
          kapsamsizlar.join("\n  ") +
          "\n\nYa kapsamı uygulayın ya da testteki GEREKCELI_ISTISNALAR " +
          "listesine gerekçesiyle ekleyin.",
      );
    }

    expect(kapsamsizlar).toEqual([]);
  });

  it("faaliyet ve ek model okumaları depo sınırından geçer", async () => {
    const dosyalar = await tsDosyalari(KAYNAK_KOK);
    const depoCekirdegi = new Set([
      "server/authz/visibility.ts",
      "server/authz/activity-repository.ts",
      // Arama SQL'i queryVisibleActivities'e yalnız daraltma olarak verilir;
      // ham sorgunun çalıştırılması yine depo içinde gerçekleşir.
      "server/search/activities.ts",
      // Rapor okuması yalnız `visibleReportScope` tarafından üretilen kişi ve
      // birim kapsamıyla toplu veri çıkarır; faaliyet metni okumaz.
      "server/reports/read.ts",
    ]);
    const sinirDisi: string[] = [];

    for (const dosya of dosyalar) {
      const icerik = await readFile(dosya, "utf8");
      const bagil = path.relative(KAYNAK_KOK, dosya).split(path.sep).join("/");
      if (depoCekirdegi.has(bagil)) continue;

      // Bir dosyanın depoyu import etmesi, aynı dosyada doğrudan Prisma
      // delegesi çağırma hakkı vermez. Aksi hâlde yeni bir kapsam dışı sorgu
      // ekleyen kişi yalnızca import satırı ekleyerek testi susturabilirdi.
      if (MODEL_OKUMA_DESENI.test(icerik)) sinirDisi.push(`${bagil}:model`);

      // Ham Activity SQL yalnız depo/görünürlük çekirdeğinde olabilir. Demo
      // temizliğinin kilit ve silme sorguları da kasıtlı bakım yolu olduğundan
      // doğrudan Activity SQL yerine bu çekirdeğin API'sine taşınmalıdır.
      if (HAM_ACTIVITY_SQL_DESENI.test(icerik)) {
        sinirDisi.push(`${bagil}:sql`);
      }
    }

    expect(sinirDisi).toEqual([]);
  });

  it("istisna listesi ölü satır taşımıyor", async () => {
    // Bir dosya kapsamı uygular hâle geldiğinde istisnası da kalkmalı; yoksa
    // liste zamanla anlamını yitirir ve gerçek bir istisnayı gizler.
    const dosyalar = await tsDosyalari(KAYNAK_KOK);
    const bagilYollar = new Set(
      dosyalar.map((dosya) =>
        path.relative(KAYNAK_KOK, dosya).split(path.sep).join("/"),
      ),
    );

    const olu = Object.keys(GEREKCELI_ISTISNALAR).filter(
      (yol) => !bagilYollar.has(yol),
    );

    expect(olu).toEqual([]);
  });
});
