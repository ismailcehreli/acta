import type { Prisma, PrismaClient } from "@prisma/client";

import { deleteStoredFile } from "@/server/attachments/storage";
import {
  activityMaintenanceReader,
  attachmentMaintenanceReader,
  lockActivitiesForMaintenance,
} from "@/server/authz/activity-repository";
import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";

import {
  DEMO_EMAIL_DOMAIN,
  DEMO_OBJECT_ORG_UNIT,
  DEMO_ORIGIN_CREATED,
  listLegacyDemoOriginCandidates,
  type LegacyDemoOriginCandidate,
} from "./origin";

// Örnek verinin temizlenmesi.
//
// **Bu, projedeki "fiziksel silme yok" kuralının bilinçli ve dar bir
// istisnasıdır** (ürün sahibi kararı, 20.08.2026). Gerekçe: demo verisi bir iş
// kaydı değil, deneme malzemesidir; onu pasifleştirmek sistemi temizlemez,
// yalnızca çöpü görünmez yapar.
//
// ---------------------------------------------------------------------------
// 21.08.2026 — Denetim, bulgu 1. Bu dosya baştan yazıldı.
// ---------------------------------------------------------------------------
//
// Eski hâli üç güvence vaat ediyordu ve **üçü de fiilen boştu**:
//
//   1. "Yabancı anahtarlar gerçek veriye dokunulmasını engeller." Engellemiyordu:
//      kod çocuk satırları **önce** siliyordu, dolayısıyla yabancı anahtar hiç
//      devreye girmiyordu. Gerçek bir kullanıcının demo bir faaliyete yazdığı
//      mesaj sessizce siliniyordu.
//   2. "Denetim izi değişmezdir." Demo kullanıcının aktör olduğu bütün
//      `AuditLog` satırları, nesnenin gerçek olup olmadığına bakılmadan
//      siliniyordu.
//   3. "İşlem denetim izine yazılır." Yazılmıyordu.
//
// Yeni kurgu, vaat edileni yapıyor:
//
//   · **Önce bak, sonra sil.** Silinecek kümeye gerçek bir kullanıcının verisi
//     bağlıysa temizlik **hiç başlamaz** ve neyin engellediği söylenir. Yarım
//     temizlik ya da sessiz veri kaybı yok.
//   · **Denetim izine dokunulmaz** — yalnız aktörü *ve* nesnesi demo olan
//     satırlar silinir. Demo bir kullanıcı gerçek bir nesneye dokunmuşsa
//     temizlik durur.
//   · **Temizliğin kendisi iz bırakır.**

export interface PurgeSummary {
  users: number;
  activities: number;
  conversations: number;
  followUps: number;
  notifications: number;
  orgUnits: number;
  /** Diskten silinen ek dosyası sayısı. */
  files: number;
  helpArticles: number;
}

export type PurgeResult =
  | { ok: true; summary: PurgeSummary }
  | { ok: false; error: "nothing_to_purge" }
  | {
      ok: false;
      error: "legacy_demo_origin_unknown";
      candidates: LegacyDemoOriginCandidate[];
    }
  | { ok: false; error: "blocked"; detail: string };

export type PurgeDb = PrismaClient;

/** Demo verisi kurulu mu; ekranda düğmeleri buna göre çizmek için. */
export async function demoDataPresent(db: PurgeDb): Promise<boolean> {
  const sayi = await db.user.count({
    where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
  });
  return sayi > 0;
}

/**
 * Gerçek veriye dokunup dokunmadığımızı **silmeden önce** kontrol eder.
 *
 * Her madde ayrı ayrı sorulur ki kullanıcıya "şu yüzden silinemedi" diyebilelim.
 * Tek bir "bir şeyler ters gitti" mesajı, sistem yöneticisini kör bırakırdı.
 */
async function engelleriTopla(
  db: PurgeDb,
  kullaniciIds: string[],
  faaliyetIds: string[],
  /**
   * Temizlikte silinecek **bütün** demo nesnelerinin kimlikleri.
   *
   * Denetim izi kontrolü eskiden yalnız kullanıcı ve faaliyet kimliklerine
   * bakıyordu; kurulumun demo kullanıcı adına açtığı birim ve konuşma
   * kayıtlarının izleri "gerçek bir nesneye işaret ediyor" sayılıyor ve
   * **kurulumdan hemen sonraki temizlik bile** engelleniyordu
   * (denetim 23.08.2026, P3-R4-2).
   */
  demoNesneIds: string[],
): Promise<string[]> {
  const yabanci = { notIn: kullaniciIds };
  const engeller: string[] = [];

  const [
    mesaj,
    konusma,
    takip,
    takipOlay,
    ek,
    revizyon,
    iptal,
    onayTuru,
    donem,
    skorOlgusu,
    takdir,
    izKaydi,
  ] = await Promise.all([
    db.conversationMessage.count({
      where: {
        conversation: { activityId: { in: faaliyetIds } },
        authorId: yabanci,
      },
    }),
    db.conversation.count({
      where: {
        activityId: { in: faaliyetIds },
        OR: [{ askerId: yabanci }, { responsibleId: yabanci }, { closedById: yabanci }],
      },
    }),
    db.followUpItem.count({
      where: {
        activityId: { in: faaliyetIds },
        OR: [{ openedById: yabanci }, { ownerId: yabanci }, { closedById: yabanci }],
      },
    }),
    db.followUpItemEvent.count({
      where: { followUp: { activityId: { in: faaliyetIds } }, actorId: yabanci },
    }),
    attachmentMaintenanceReader(db).count({
      where: { activityId: { in: faaliyetIds }, uploadedById: yabanci },
    }),
    db.activityRevision.count({
      where: { activityId: { in: faaliyetIds }, changedById: yabanci },
    }),
    db.cancellationRecord.count({
      where: { activityId: { in: faaliyetIds }, cancelledById: yabanci },
    }),
    // Gerçek bir yönetici demo kayda karar vermiş olabilir; o karar geçmişi
    // ona aittir ve silinemez (P3-R3-3).
    db.approvalRound.count({
      where: { activityId: { in: faaliyetIds }, decidedById: yabanci },
    }),
    // Demo bir kullanıcı gerçek birinin izin kaydını girmiş ya da ona vekâlet
    // etmiş olabilir. O satır gerçek kişiye aittir; silinemez.
    db.noActivityPeriod.count({
      where: {
        userId: yabanci,
        OR: [{ markedById: { in: kullaniciIds } }, { deputyId: { in: kullaniciIds } }],
      },
    }),
    // **Skor katkısı** (denetim 25.08.2026, P8-6). Demo bir faaliyet
    // gerçek birinin kapanmış dönemine katkı yazmış olabilir — örneğin gerçek
    // bir yönetici demo kayda karar verdiyse. O olgu gerçek kişinin donmuş
    // geçmişine aittir; silinemez ve temizlik durur.
    db.userScorePeriodFact.count({
      where: { activityId: { in: faaliyetIds }, userId: yabanci },
    }),
    // Takdir de gerçek bir kullanıcının faaliyetle ilişkili işlemidir. Demo
    // faaliyetini gerçek biri takdir ettiyse veya demo kullanıcı gerçek bir
    // faaliyete takdir verdiyse, temizlik bunu sessizce silemez.
    db.activityAppreciation.count({
      where: {
        OR: [
          { activityId: { in: faaliyetIds }, userId: yabanci },
          { activityId: { notIn: faaliyetIds }, userId: { in: kullaniciIds } },
        ],
      },
    }),
    // Denetim izi: aktörü demo ama nesnesi silinmeyecek bir şey olan kayıt.
    // Böyle bir satır varsa temizlik değişmez izi bozardı (§15.2).
    db.auditLog.count({
      where: {
        OR: [{ userId: { in: kullaniciIds } }, { actualUserId: { in: kullaniciIds } }],
        NOT: { objectId: { in: demoNesneIds } },
      },
    }),
  ]);

  if (mesaj > 0) engeller.push(`${mesaj} konuşma mesajı gerçek bir kullanıcıya ait`);
  if (konusma > 0) engeller.push(`${konusma} konuşmanın tarafı gerçek bir kullanıcı`);
  if (takip > 0) engeller.push(`${takip} takip maddesi gerçek bir kullanıcıya bağlı`);
  if (takipOlay > 0) engeller.push(`${takipOlay} takip olayını gerçek bir kullanıcı yaptı`);
  if (ek > 0) engeller.push(`${ek} eki gerçek bir kullanıcı yükledi`);
  if (revizyon > 0) engeller.push(`${revizyon} revizyonu gerçek bir kullanıcı yaptı`);
  if (iptal > 0) engeller.push(`${iptal} iptali gerçek bir kullanıcı yaptı`);
  if (onayTuru > 0) {
    engeller.push(`${onayTuru} onay kararını gerçek bir kullanıcı verdi`);
  }
  if (donem > 0) engeller.push(`${donem} izin kaydı gerçek bir kullanıcıya ait`);
  if (skorOlgusu > 0) {
    engeller.push(
      `${skorOlgusu} skor katkısı gerçek bir kullanıcının kapanmış dönemine ait`,
    );
  }
  if (takdir > 0) {
    engeller.push(`${takdir} takdir kaydı gerçek bir kullanıcıya ait`);
  }
  if (izKaydi > 0) {
    engeller.push(
      `${izKaydi} denetim kaydı gerçek bir nesneye işaret ediyor (denetim izi silinemez)`,
    );
  }

  return engeller;
}

/** Kilit altında bulunan engel; işlemi geri almak için fırlatılıyor. */
class PurgeBlocked extends Error {
  constructor(readonly detay: string) {
    super(detay);
  }
}

class LegacyDemoOriginUnknown extends Error {
  constructor(readonly candidates: LegacyDemoOriginCandidate[]) {
    super("Eski örnek kurulumundaki birimlerin kökeni sınıflandırılmamış");
  }
}

export async function purgeDemoData(
  db: PurgeDb,
  actorId: string,
  now: Date = new Date(),
): Promise<PurgeResult> {
  const demoKullanicilar = await db.user.findMany({
    where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    select: { id: true },
  });

  if (demoKullanicilar.length === 0) {
    return { ok: false, error: "nothing_to_purge" };
  }

  const kullaniciIds = demoKullanicilar.map((k) => k.id);

  const demoFaaliyetler = await activityMaintenanceReader(db).findMany({
    where: { authorId: { in: kullaniciIds } },
    select: { id: true },
  });
  const faaliyetIds = demoFaaliyetler.map((f) => f.id);

  // Silinecek dosyaların yolları işlem öncesinde okunur; diskten silme
  // **commit'ten sonra** yapılır. Ters sırada yapılsaydı işlem geri alındığında
  // kaydı duran ama dosyası olmayan ekler kalırdı.
  const dosyalar = await attachmentMaintenanceReader(db).findMany({
    where: { activityId: { in: faaliyetIds } },
    select: { storagePath: true },
  });

  try {
    const ozet = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('faaliyet:demo_verisi'))`;

      // Fiziksel silme yasağının kapısı. `SET LOCAL` **yalnız bu
      // transaction** süresince geçerli: işlem bitince kendiliğinden kalkar
      // ve bağlantı havuzunda bir sonraki isteğe sızamaz. Uygulamada bu
      // değişkeni kuran tek yer burasıdır.
      await tx.$executeRawUnsafe("SET LOCAL app.demo_purge = 'evet'");

      // Migration öncesi kurulmuş birimlerde köken bilinmez. Ad veya ağaç
      // konumundan tahmin ederek silmek gerçek bir birimi yok edebilir;
      // belirsizlik tek satır değiştirilmeden yöneticiye taşınır (P3-R6-2).
      const belirsizBirimler = await listLegacyDemoOriginCandidates(
        tx as unknown as PurgeDb,
      );
      if (belirsizBirimler.length > 0) {
        throw new LegacyDemoOriginUnknown(belirsizBirimler);
      }

      // **Kontrol ile silme aynı işlemde ve kilit altında** (denetim
      // 23.08.2026, P3-R4-3). Kontroller işlem dışındayken, ön kontrol ile
      // silme arasında gerçek bir yönetici demo kaydı onaylayabiliyor ve
      // temizlik onun **değişmez** karar geçmişini siliyordu. Faaliyet
      // satırları burada kilitleniyor; onay yolu da aynı satırı kilitlediği
      // için ikisi sıraya giriyor.
      await lockActivitiesForMaintenance(tx, faaliyetIds);

      // Kilit altında **yeniden** okunuyor: aradaki pencerede yazılmış bir
      // bağlantı ön kontrolde görünmezdi.
      //
      // **Alt nesneler de kilitleniyor** (denetim 23.08.2026,
      // P3-R5-1). Faaliyet kilidi tek başına yetmiyordu: `closeFollowUp`
      // yalnız `FollowUpItem` satırını kilitliyor, `replyToConversation`
      // yalnız `Conversation` satırını. Ortak kilit olmadan gerçek bir
      // yönetici, engel kontrolünden sonra takip maddesini kapatabiliyor ve
      // temizlik onun geçmişini siliyordu. Sıra sabit: faaliyet → konuşma →
      // takip.
      const tazeKonusmalar = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Conversation"
        WHERE "activityId" = ANY(${faaliyetIds}::text[])
        ORDER BY "id"
        FOR UPDATE
      `;
      const tazeTakipler = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "FollowUpItem"
        WHERE "activityId" = ANY(${faaliyetIds}::text[])
        ORDER BY "id"
        FOR UPDATE
      `;
      // **Birim kimliği kökeninden geliyor, adından değil** (P3-R5-2).
      // Kurulum aynı adlı mevcut bir birimi yeniden kullanıyor; ada bakan
      // temizlik daha önceden var olan gerçek bir birimi silerdi.
      const demoBirimKayitlari = await tx.demoObject.findMany({
        where: { objectType: DEMO_OBJECT_ORG_UNIT },
        select: { objectId: true, origin: true },
      });
      const demoBirimIds = demoBirimKayitlari
        .filter((satir) => satir.origin === DEMO_ORIGIN_CREATED)
        .map((satir) => satir.objectId);

      // Örnek yardım yazıları, örnek genel müdür tarafından oluşturulan
      // içeriklerdir. Gerçek bir yönetici sonradan böyle bir yazıyı
      // düzenlediyse silme durur; ortak kullanılan içeriği sessizce yok
      // etmek yerine yöneticiye karar alanı bırakılır.
      const demoYardimYazilari = await tx.helpArticle.findMany({
        where: { createdById: { in: kullaniciIds } },
        select: { id: true },
      });
      const demoYardimIds = demoYardimYazilari.map((yazi) => yazi.id);
      if (demoYardimIds.length > 0) {
        const gercekKisiDuzenlemeleri = await tx.helpArticle.count({
          where: {
            id: { in: demoYardimIds },
            updatedById: { notIn: kullaniciIds },
          },
        });
        if (gercekKisiDuzenlemeleri > 0) {
          throw new PurgeBlocked(
            `${gercekKisiDuzenlemeleri} yardım yazısı gerçek bir yönetici tarafından düzenlenmiş`,
          );
        }
      }

      // Denetim izi kontrolünün "demo nesne" kümesi: kullanıcılar,
      // faaliyetler ve kurulumun açtığı birim/konuşma/takip/yardım satırları.
      const demoNesneIds = [
        ...kullaniciIds,
        ...faaliyetIds,
        ...tazeKonusmalar.map((k) => k.id),
        ...tazeTakipler.map((t) => t.id),
        ...demoBirimIds,
        ...demoYardimIds,
      ];

      const engeller = await engelleriTopla(
        tx as unknown as PurgeDb,
        kullaniciIds,
        faaliyetIds,
        demoNesneIds,
      );
      if (engeller.length > 0) {
        throw new PurgeBlocked(engeller.join("; "));
      }

      // Çocuklardan köke doğru. Sıra önemli: her adım bir üsttekinin
      // yabancı anahtarını serbest bırakır.
      //
      // **Silme koşulu dar** (P3-R5-1): yalnız her bağlantısı demo kişilere
      // ait satırlar siliniyor. Kontrol ile silme arasında kilit tutmayan bir
      // yoldan (örneğin yeni bir takip maddesi açılması) gerçek bir satır
      // doğarsa, o satır **silinmiyor** ve faaliyet silinirken yabancı anahtar
      // işlemin tamamını geri alıyor. Yanlışlıkla silmektense durmak.
      const demoKisi = { in: kullaniciIds };
      const takipler = await tx.followUpItem.findMany({
        where: {
          activityId: { in: faaliyetIds },
          openedById: demoKisi,
          ownerId: demoKisi,
          OR: [{ closedById: null }, { closedById: demoKisi }],
        },
        select: { id: true },
      });
      const takipIds = takipler.map((t) => t.id);

      await tx.followUpItemEvent.deleteMany({
        where: { followUpId: { in: takipIds }, actorId: demoKisi },
      });
      const silinenTakip = await tx.followUpItem.deleteMany({
        where: { id: { in: takipIds } },
      });

      const konusmalar = await tx.conversation.findMany({
        where: {
          activityId: { in: faaliyetIds },
          askerId: demoKisi,
          responsibleId: demoKisi,
          OR: [{ closedById: null }, { closedById: demoKisi }],
        },
        select: { id: true },
      });
      await tx.conversationMessage.deleteMany({
        where: { conversationId: { in: konusmalar.map((k) => k.id) } },
      });
      const silinenKonusma = await tx.conversation.deleteMany({
        where: { id: { in: konusmalar.map((k) => k.id) } },
      });

      // Okundu kaydı gerçek kullanıcıya ait olsa da silinir: faaliyet
      // gidince "kim okudu" sorusunun konusu kalmıyor. Denetim izi
      // kapsamında da değil (§10.3) — kolaylık göstergesidir.
      await tx.readReceipt.deleteMany({ where: { activityId: { in: faaliyetIds } } });
      await tx.attachment.deleteMany({ where: { activityId: { in: faaliyetIds } } });
      await tx.activityTargetDept.deleteMany({
        where: { activityId: { in: faaliyetIds } },
      });
      await tx.cancellationRecord.deleteMany({
        where: { activityId: { in: faaliyetIds } },
      });
      await tx.activityRevision.deleteMany({
        where: { activityId: { in: faaliyetIds } },
      });
      await tx.activityApprover.deleteMany({
        where: { activityId: { in: faaliyetIds } },
      });
      // Takdir kaydı hem faaliyete hem veren kullanıcıya RESTRICT ile bağlı.
      // Gerçek kullanıcıyla kesişim yukarıdaki kontrolde engellendi; burada
      // yalnızca örnek faaliyete verilen veya örnek kullanıcının verdiği
      // güvenli satırlar temizlenir.
      await tx.activityAppreciation.deleteMany({
        where: {
          OR: [
            { activityId: { in: faaliyetIds } },
            { userId: { in: kullaniciIds } },
          ],
        },
      });
      // Onay turları da faaliyetin çocuğu; silinmezse yabancı anahtar
      // temizliği bloke ediyordu (P3-R3-3).
      await tx.approvalRound.deleteMany({
        where: {
          activityId: { in: faaliyetIds },
          OR: [{ decidedById: null }, { decidedById: demoKisi }],
        },
      });

      // **Skor katkıları faaliyetten önce gitmeli** (denetim
      // 25.08.2026, P8-6). Katkı hem faaliyete hem döneme `RESTRICT` ile
      // bağlı; temizlenmediğinde faaliyet silme yabancı anahtar ihlaliyle
      // düşüyor ve ham Prisma metni kullanıcıya "engel" diye taşınıyordu.
      //
      // Buraya gelindiyse gerçek kullanıcıya ait katkı yok: engel kontrolü
      // onu zaten durdururdu. Silinenler yalnız demo kişilerin katkıları.
      await tx.userScorePeriodFact.deleteMany({
        where: { userId: { in: kullaniciIds } },
      });

      // Bildirim satırları faaliyete bağlı; faaliyetten önce gitmeli.
      const silinenBildirim = await tx.notificationQueue.deleteMany({
        where: {
          OR: [{ userId: { in: kullaniciIds } }, { activityId: { in: faaliyetIds } }],
        },
      });

      const silinenFaaliyet = await tx.activity.deleteMany({
        where: { id: { in: faaliyetIds } },
      });

      // Yardım yazıları örnek kullanıcıya bağlıdır; fiziksel silme yalnız
      // örnek temizleme transaction'ının özel kapısından geçer.
      const silinenYardim = await tx.helpArticle.deleteMany({
        where: { id: { in: demoYardimIds } },
      });

      // Yalnız demo kişilere **ait** dönemler. Gerçek birine ait olanlar
      // yukarıdaki kontrolde zaten temizliği durdururdu.
      await tx.noActivityPeriod.deleteMany({
        where: { userId: { in: kullaniciIds } },
      });

      // Skor dönemleri kullanıcıdan önce; katkıları yukarıda gitti.
      await tx.userScorePeriod.deleteMany({
        where: { userId: { in: kullaniciIds } },
      });
      // Sürüm isteği kullanıcıya RESTRICT ile bağlıdır ve dönem satırı onu
      // kaynak olarak gösterebilir. Bu yüzden sıra: katkı → dönem → istek.
      await tx.scoreRecalculationRequest.deleteMany({
        where: { userId: { in: kullaniciIds } },
      });
      // Etkili-tarih olayları bilerek FK taşımaz; aksi hâlde değişmez iş
      // geçmişi kullanıcı pasifleştirmesini zorlaştırırdı. Demo istisnasında
      // bu, kendiliğinden temizlenmeyecekleri anlamına gelir. Dar
      // `app.demo_purge` kapısı append-only tetikleyicisinde silmeye izin verir.
      await tx.scoreUserStateEvent.deleteMany({
        where: { userId: { in: kullaniciIds } },
      });
      await tx.pushSubscription.deleteMany({ where: { userId: { in: kullaniciIds } } });

      // Denetim izi: yalnız aktörü **ve** nesnesi demo olan satırlar.
      // Gerçek bir nesneye işaret eden satır varsa buraya hiç gelinmezdi.
      await tx.auditLog.deleteMany({
        where: {
          OR: [{ userId: { in: kullaniciIds } }, { actualUserId: { in: kullaniciIds } }],
          objectId: { in: demoNesneIds },
        },
      });

      await tx.session.deleteMany({ where: { userId: { in: kullaniciIds } } });
      await tx.userCredential.deleteMany({ where: { userId: { in: kullaniciIds } } });

      const silinenKullanici = await tx.user.deleteMany({
        where: { id: { in: kullaniciIds } },
      });

      await tx.scoreUnitCalendarEvent.deleteMany({
        where: { orgUnitId: { in: demoBirimIds } },
      });
      await tx.scoreOrgUnitStateEvent.deleteMany({
        where: { orgUnitId: { in: demoBirimIds } },
      });
      const silinenBirimIds = await birimleriTemizle(tx, demoBirimIds);
      const silinenBirim = silinenBirimIds.length;

      // Sabit nokta temizliği bütün sahipli birimleri silmeden dönmez. Başarı
      // halinde yeniden kullanılan gerçek birimlerin karar kayıtları da bu
      // demo kurulumuyla birlikte biter.
      await tx.demoObject.deleteMany({
        where: {
          objectType: DEMO_OBJECT_ORG_UNIT,
          objectId: { in: demoBirimKayitlari.map((kayit) => kayit.objectId) },
        },
      });

      // **Temizliğin kendisi iz bırakır** (§15.2). Aynı işlem içinde: "silindi
      // ama izi yok" durumu mümkün olmamalı.
      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.setting,
        objectId: "demo_data",
        action: AUDIT_ACTIONS.demoDataPurged,
        detail: {
          users: silinenKullanici.count,
          activities: silinenFaaliyet.count,
          conversations: silinenKonusma.count,
          followUps: silinenTakip.count,
          notifications: silinenBildirim.count,
          orgUnits: silinenBirim,
          files: dosyalar.length,
          helpArticles: silinenYardim.count,
        },
        now,
      });

      return {
        users: silinenKullanici.count,
        activities: silinenFaaliyet.count,
        conversations: silinenKonusma.count,
        followUps: silinenTakip.count,
        notifications: silinenBildirim.count,
        orgUnits: silinenBirim,
        files: dosyalar.length,
        helpArticles: silinenYardim.count,
      } satisfies PurgeSummary;
    });

    // Commit sonrası: diskteki dosyalar. Başarısız olursa kayıt zaten gitti;
    // artakalan dosyaya giden bir yol yok ve ikinci temizlik onu bulmaz —
    // bu yüzden hata yutulmaz, çağırana taşınmaz ama günlüğe düşer.
    for (const dosya of dosyalar) {
      try {
        await deleteStoredFile(dosya.storagePath);
      } catch (error) {
        console.error("[örnek veri] dosya silinemedi", dosya.storagePath, error);
      }
    }

    return { ok: true, summary: ozet };
  } catch (error) {
    if (error instanceof LegacyDemoOriginUnknown) {
      return {
        ok: false,
        error: "legacy_demo_origin_unknown",
        candidates: error.candidates,
      };
    }

    // Beklenmeyen bir bağ kalmışsa yabancı anahtar durdurur ve işlem tamamen
    // geri alınır. Kullanıcıya ne olduğu söylenir, sessizce "silindi" denmez.
    return {
      ok: false,
      error: "blocked",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Örnek birimler: yalnız içinde kimse kalmamışsa ve alt birimi yoksa.
 * Yapraklardan köke doğru gidilir; kök birim **hiç dokunulmaz**.
 */
async function birimleriTemizle(
  tx: Prisma.TransactionClient,
  demoBirimIds: string[],
): Promise<string[]> {
  const silinenler: string[] = [];
  const kalan = new Set(demoBirimIds);

  // `findMany` sırası sözleşme değildir. Her tur yalnız gerçek yaprakları
  // siler; en az bir silme oldukça üst katman yeni yaprağa dönüşür. Böylece
  // girdi hangi sırada gelirse gelsin aynı işlem içinde sabit noktaya varılır
  // (denetim 24.08.2026, P3-R6-1).
  while (kalan.size > 0) {
    let ilerleme = 0;

    for (const birimId of [...kalan]) {
      const birim = await tx.orgUnit.findUnique({
        where: { id: birimId },
        select: { id: true, parentId: true },
      });
      if (!birim) {
        kalan.delete(birimId);
        continue;
      }
      // Kök birim köken kaydında olsa bile asla silinmez; aşağıdaki tıkanma
      // bütün işlemi geri alır ve bozuk sınıflandırmayı görünür kılar.
      if (birim.parentId === null) continue;

      const [kullanan, alt, kayit] = await Promise.all([
        tx.user.count({ where: { orgUnitId: birim.id } }),
        tx.orgUnit.count({ where: { parentId: birim.id } }),
        activityMaintenanceReader(tx).count({ where: { authorOrgUnitId: birim.id } }),
      ]);
      if (kullanan > 0 || alt > 0 || kayit > 0) continue;

      await tx.orgUnit.delete({ where: { id: birim.id } });
      kalan.delete(birim.id);
      silinenler.push(birim.id);
      ilerleme += 1;
    }

    if (ilerleme === 0) break;
  }

  if (kalan.size > 0) {
    const adlar = await tx.orgUnit.findMany({
      where: { id: { in: [...kalan] } },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    throw new PurgeBlocked(
      `${kalan.size} örnek birim güvenle silinemedi: ${adlar
        .map((birim) => `${birim.name} (${birim.id})`)
        .join(", ")}`,
    );
  }

  return silinenler;
}
