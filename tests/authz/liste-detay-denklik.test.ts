import type { ActivityApprovalStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  canViewActivity,
  subordinateUserIds,
  visibleActivityWhere,
} from "@/server/authz/visibility";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// LİSTE ↔ DETAY DENKLİĞİ.
//
// Görünürlük iki ayrı fonksiyonla ifade ediliyor: `visibleActivityWhere`
// listeleri süzüyor, `canViewActivity` tek bir kaydın detayına karar
// veriyor. İkisi **aynı kuralın iki gösterimi**; ayrıştıkları anda iki tür
// hata doğar:
//
//   · Liste gösterir, detay açılmaz → kullanıcı "yetkim yok" ekranı görür
//     ve sistem bozuk sanır. (21.08.2026'da tam olarak bu yaşandı: aynı
//     birimde iki yönetici olunca liste kaydı gösteriyor, detay 404
//     veriyordu.)
//   · Detay açılır, liste göstermez → **sızıntı.** Kimsenin görmemesi
//     gereken bir kayıt, bağlantısı eline geçen herkese açılır.
//
// Sabitlenen değişmez şudur:
//
//     canViewActivity(...) === "full"  ⟺  kayıt visibleActivityWhere içinde
//
// `"metadata"` bilerek dışarıda: sistem yöneticisi "yönetici bulunamadı"
// kayıtlarını yönlendirebilmek için **yalnız üst veriyle** görür (§8.2) ve o
// yüzey ayrı bir sorgudan beslenir (`listInterventionQueue`). Genel süzgeç
// içerik taşıyan listeleri (akış, arama, ek indirme) besliyor; oraya
// eklenseydi süzülmemiş içerik o listelere sızardı. Test bu ayrımı da
// doğruluyor: `metadata` çıkan her kaydın içerik listesinde **olmadığını**
// ayrıca sınıyor.
//
// Yeni bir görünürlük kuralı eklendiğinde buraya bir senaryo eklemek yeter;
// iki fonksiyondan birini güncellemeyi unutmak burada yakalanır.

const DURUMLAR: ActivityApprovalStatus[] = [
  "APPROVED",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "REJECTED",
  "CANCELLED",
  "MANAGER_NOT_FOUND",
];

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/**
 * Şirket ağacı:
 *
 *   Acta HQ (kök)
 *     ├─ genelMudur      (kök yöneticisi)
 *     ├─ ikinciGM        (kök yöneticisi — **aynı birimde ikinci yönetici**)
 *     ├─ yonetimKurulu   (yönetici değil, kökte çalışan)
 *     └─ Kalıphane
 *          ├─ kalipMudur (Kalıphane yöneticisi)
 *          └─ kalipci    (çalışan)
 *     └─ Planlama
 *          └─ planlamaci (çalışan, yöneticisiz birim)
 */
async function sirket() {
  const kok = await createOrgUnit({ name: "Acta HQ" });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const genelMudur = await createUser(kok.id, {
    email: "gm@ornek.test",
    isUnitManager: true,
    isSystemAdmin: true,
  });
  const ikinciGM = await createUser(kok.id, {
    email: "gm2@ornek.test",
    isUnitManager: true,
    isSystemAdmin: true,
  });
  const yonetimKurulu = await createUser(kok.id, { email: "yk@ornek.test" });
  const kalipMudur = await createUser(kaliphane.id, {
    email: "kalip-mudur@ornek.test",
    isUnitManager: true,
  });
  const kalipci = await createUser(kaliphane.id, { email: "kalipci@ornek.test" });
  const planlamaci = await createUser(planlama.id, { email: "planlamaci@ornek.test" });

  return {
    genelMudur,
    ikinciGM,
    yonetimKurulu,
    kalipMudur,
    kalipci,
    planlamaci,
  };
}

/** Bir kaydı listede görüyor mu? */
async function listedeMi(
  bakan: { id: string; isSystemAdmin?: boolean },
  activityId: string,
): Promise<boolean> {
  const viewer = { id: bakan.id, isSystemAdmin: bakan.isSystemAdmin ?? false };
  const where = await visibleActivityWhere(testDb, viewer);
  const satirlar = await testDb.activity.findMany({ where, select: { id: true } });

  return satirlar.some((satir) => satir.id === activityId);
}

/** Detayda hangi seviyede görüyor? */
async function detaySeviyesi(
  bakan: { id: string; isSystemAdmin?: boolean },
  activity: { id: string; authorId: string; approvalStatus: ActivityApprovalStatus },
) {
  const viewer = { id: bakan.id, isSystemAdmin: bakan.isSystemAdmin ?? false };
  return canViewActivity(testDb, viewer, activity);
}

describe("liste ve detay aynı cevabı verir", () => {
  it("aynı birimde iki yönetici — biri diğerinin kaydını hem görür hem açar", async () => {
    const { genelMudur, ikinciGM } = await sirket();
    const kayit = await createActivity(ikinciGM, { approvalStatus: "APPROVED" });

    // Bu senaryo 21.08.2026'da kırıktı: liste `true`, detay `none`.
    expect(await listedeMi(genelMudur, kayit.id)).toBe(true);
    expect(
      await detaySeviyesi(genelMudur, {
        id: kayit.id,
        authorId: kayit.authorId,
        approvalStatus: kayit.approvalStatus,
      }),
    ).toBe("full");
  });

  it("her kademe, her durum, her yazar için iki taraf uyuşur", async () => {
    const kisiler = await sirket();
    const yazarlar = Object.values(kisiler);
    const bakanlar = Object.values(kisiler);

    // Sistem yöneticisi bayrağını da değiştirerek deniyoruz: rol, ağaçtan
    // gelmeyen erişim eklememeli (§15.1) ve iki taraf bunu aynı görmeli.
    const bakisAcilari = bakanlar.flatMap((kisi) => [
      { id: kisi.id, isSystemAdmin: false },
      { id: kisi.id, isSystemAdmin: true },
    ]);

    const uyusmayanlar: string[] = [];
    const sizintiRiski: string[] = [];
    let metadataSayisi = 0;

    for (const yazar of yazarlar) {
      for (const durum of DURUMLAR) {
        const kayit = await kayitYaz(yazar, durum);
        // Kayıt istenen durumda doğmadıysa (yöneticisiz kişide onay akışı)
        // gerçek durumuyla karşılaştırılır.
        const gercekDurum = kayit.approvalStatus;

        for (const bakan of bakisAcilari) {
          const liste = await listedeMi(bakan, kayit.id);
          const seviye = await detaySeviyesi(bakan, {
            id: kayit.id,
            authorId: kayit.authorId,
            approvalStatus: gercekDurum,
          });

          const kunye =
            `yazar=${yazar.email} durum=${gercekDurum} bakan=${bakan.id} ` +
            `sysadmin=${bakan.isSystemAdmin}`;

          // Asıl değişmez: "full" ile liste birbirine denk.
          if ((seviye === "full") !== liste) {
            uyusmayanlar.push(`${kunye} liste=${liste} seviye=${seviye}`);
          }

          // Üst veri erişimi içerik listesine **sızmamalı**.
          if (seviye === "metadata") {
            metadataSayisi += 1;
            if (liste) sizintiRiski.push(`${kunye} — üst veri içerik listesinde!`);
          }
        }
      }
    }

    if (uyusmayanlar.length > 0) console.log(uyusmayanlar.slice(0, 8).join("\n"));
    expect(uyusmayanlar).toEqual([]);
    expect(sizintiRiski).toEqual([]);
    // Üst veri istisnası gerçekten sınanmış olmalı; sıfırsa test bir şey
    // kanıtlamıyor demektir.
    expect(metadataSayisi).toBeGreaterThan(0);
  });

  it("astların önceden hesaplanması sonucu değiştirmez", async () => {
    const { genelMudur, kalipci } = await sirket();
    const kayit = await createActivity(kalipci, { approvalStatus: "APPROVED" });

    const viewer = { id: genelMudur.id, isSystemAdmin: false };
    const astlar = await subordinateUserIds(testDb, genelMudur.id);

    const hedef = {
      id: kayit.id,
      authorId: kayit.authorId,
      approvalStatus: kayit.approvalStatus,
    };

    const hesaplanmadan = await canViewActivity(testDb, viewer, hedef);
    const hesaplanmisla = await canViewActivity(testDb, viewer, hedef, astlar);

    expect(hesaplanmisla).toBe(hesaplanmadan);
  });
});

/**
 * Durumu geçerli bir kayıt üretir.
 *
 * Onay sürecindeki durumlar onaylayıcı ister (veritabanı kısıtı) ve
 * gerekçeli durumlar kategori ister; test verisi gerçek kurala uyar.
 */
async function kayitYaz(
  yazar: { id: string; orgUnitId: string },
  durum: ActivityApprovalStatus,
) {
  const onayGerekir =
    durum === "PENDING_APPROVAL" ||
    durum === "CHANGES_REQUESTED" ||
    durum === "REJECTED";

  const onaylayanId = onayGerekir ? await onaylayiciBul(yazar) : null;

  // Yöneticisi çözülemeyen kişide bu durumlar üretimde de doğamaz.
  if (onayGerekir && onaylayanId === null) {
    return createActivity(yazar, { approvalStatus: "MANAGER_NOT_FOUND" });
  }

  const kayit = await createActivity(yazar, {
    approvalStatus: durum,
    approverId: onaylayanId,
    ...(await gerekceAlanlari(durum)),
  });

  return kayit;
}

async function onaylayiciBul(yazar: { id: string; orgUnitId: string }) {
  const { resolveManagers } = await import("@/server/org/resolve-manager");
  const sonuc = await resolveManagers(testDb, yazar.id);
  return sonuc.found ? sonuc.managerIds[0] : null;
}

async function gerekceAlanlari(durum: ActivityApprovalStatus) {
  if (durum !== "CHANGES_REQUESTED" && durum !== "REJECTED") return {};

  const gerekce = await testDb.approvalReason.upsert({
    where: { kind_label: { kind: durum, label: "Test gerekçesi" } },
    create: { kind: durum, label: "Test gerekçesi" },
    update: {},
  });

  return { approvalReasonId: gerekce.id, approvalReasonKind: durum };
}
