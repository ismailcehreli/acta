import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  activityMaintenanceReader,
  attachmentMaintenanceReader,
} from "@/server/authz/activity-repository";
import { deleteStoredFile } from "@/server/attachments/storage";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import {
  acquireScoreMutationLock,
  scorePeriodStart,
} from "@/server/scoring/recalculation";

// Root'un faaliyet silmesi (ürün sahibi kararı, 03.09.2026; açık soru 25).
//
// Tasarım §16.5 "fiziksel silme yoktur" der ve kural yerinde durur. Bu, örnek
// veri temizliğinden sonraki **ikinci** istisnadır ve dört katmanla dar
// tutulmuştur; her katman tek başına silmeyi durdurur:
//
//   1. Yetki    — yalnız `isRoot`. Sistem yöneticisi olmak yetmez (§15.1).
//   2. Dönem    — kapanmış dönemin kaydı silinemez. Kapanmış bir karne, artık
//                 var olmayan bir kayda dayanamaz.
//   3. Kod      — root'un e-postasına giden, on dakika geçerli, tek
//                 kullanımlık altı hane.
//   4. Veritabanı — `app.activity_delete` kapısı kurulmadıkça tetikleyici
//                 silmeyi reddeder.
//
// **Dönem kontrolü iki kez yapılır**: talep açılırken ve kod doğrulanırken,
// kilit altında. Kod on dakika geçerli ve kapanış işi bu sürede koşabilir;
// tek kontrol, kuralı kâğıt üstünde bırakırdı.
//
// Root faaliyetin **içeriğini görmez** (§15.1 korunuyor): bu modül yalnız üst
// veri döndürür — yazar, birim, tarih, başlık, durum. Ne sildiğini bilir, ne
// yazdığını okumaz.

export const DELETION_CODE_TTL_MS = 10 * 60_000;
export const MAX_DELETION_ATTEMPTS = 5;

export type DeletionDb = Pick<
  PrismaClient,
  | "activity"
  | "activityDeletionRequest"
  | "activityRevision"
  | "activityApprover"
  | "activityTargetDept"
  | "activityAppreciation"
  | "approvalRound"
  | "attachment"
  | "auditLog"
  | "cancellationRecord"
  | "conversation"
  | "conversationMessage"
  | "followUpItem"
  | "followUpItemEvent"
  | "notificationQueue"
  | "readReceipt"
  | "scorePeriodLedger"
  | "systemSetting"
  | "user"
  | "userScorePeriodFact"
  | "$executeRaw"
  | "$executeRawUnsafe"
  | "$transaction"
>;

export type DeletionError =
  | "not_root"
  | "not_found"
  | "period_closed"
  | "no_request"
  | "invalid_code"
  | "expired";

export type DeletionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DeletionError; message: string };

const MESSAGES: Record<DeletionError, string> = {
  not_root: "Bu işlem yalnız ana sistem yöneticisine açıktır.",
  not_found: "Faaliyet bulunamadı.",
  period_closed:
    "Bu faaliyetin ait olduğu skor dönemi kapandı; kapanmış dönemin kaydı silinemez.",
  no_request:
    "Geçerli bir silme talebi yok. Yeniden kod isteyin.",
  invalid_code: "Kod doğrulanamadı.",
  expired: "Kodun süresi doldu. Yeniden kod isteyin.",
};

function fail<T>(error: DeletionError): DeletionResult<T> {
  return { ok: false, error, message: MESSAGES[error] };
}

export interface DeletionActor {
  id: string;
  isRoot: boolean;
}

/** Root'un gördüğü kadarı: üst veri ve dönem durumu. Açıklama metni yok. */
export interface ActivityDeletionTarget {
  id: string;
  title: string;
  activityDate: Date;
  authorName: string;
  authorUnitName: string;
  approvalStatus: string;
  attachmentCount: number;
  periodClosed: boolean;
  /** Dönem kapandıysa kapanış anı; ekranda gerekçe olarak gösterilir. */
  periodClosedAt: Date | null;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Zamanlama sızıntısına kapalı karşılaştırma; kod kısa ve tahmin edilebilir. */
function sameHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Dönem kapandı mı (§ skor kayıt defteri)?
 *
 * İki kanıt aranıyor: kapanış defterinde ayın satırı, **ve** kaydın bir karnede
 * geçip geçmediği. İkincisi güvenlik ağı: bir biçimde defter satırı olmadan
 * karne üretilmiş olsa bile o karnenin dayanağı silinmemeli.
 */
async function periodState(
  db: Pick<DeletionDb, "scorePeriodLedger" | "userScorePeriodFact">,
  activityId: string,
  activityDate: Date,
): Promise<{ closed: boolean; closedAt: Date | null }> {
  const [ledger, factCount] = await Promise.all([
    db.scorePeriodLedger.findUnique({
      where: { periodStart: scorePeriodStart(activityDate) },
      select: { closedAt: true },
    }),
    db.userScorePeriodFact.count({ where: { activityId } }),
  ]);

  if (ledger) return { closed: true, closedAt: ledger.closedAt };
  if (factCount > 0) return { closed: true, closedAt: null };
  return { closed: false, closedAt: null };
}

async function loadTarget(
  db: DeletionDb,
  activityId: string,
): Promise<ActivityDeletionTarget | null> {
  // Kapsam sorulmuyor ve bu bilinçli: sistem yöneticisi hiçbir faaliyetin
  // kapsamında değildir (§15.1), kapsam sorulsaydı silme hiç mümkün olmazdı.
  // Sızıntıya karşı koruma **projeksiyonda**: yalnız üst veri seçiliyor,
  // açıklama metni hiçbir dalda okunmuyor. Okuma, envanterin tanıdığı bakım
  // kapısından geçiyor.
  const activity = await activityMaintenanceReader(db).findUnique({
    where: { id: activityId },
    select: {
      id: true,
      title: true,
      activityDate: true,
      approvalStatus: true,
      author: { select: { fullName: true } },
      authorOrgUnit: { select: { name: true } },
      _count: { select: { attachments: true } },
    },
  });

  if (!activity) return null;

  const donem = await periodState(db, activity.id, activity.activityDate);

  return {
    id: activity.id,
    title: activity.title,
    activityDate: activity.activityDate,
    authorName: activity.author.fullName,
    authorUnitName: activity.authorOrgUnit.name,
    approvalStatus: activity.approvalStatus,
    attachmentCount: activity._count.attachments,
    periodClosed: donem.closed,
    periodClosedAt: donem.closedAt,
  };
}

/** Silinecek kaydın üst verisi; ekran bunu gösterir. */
export async function describeActivityForDeletion(
  db: DeletionDb,
  actor: DeletionActor,
  activityId: string,
): Promise<DeletionResult<ActivityDeletionTarget>> {
  if (!actor.isRoot) return fail("not_root");

  const target = await loadTarget(db, activityId);
  if (!target) return fail("not_found");

  return { ok: true, value: target };
}

/**
 * Silme talebi açar ve kodu root'un e-postasına gönderir.
 *
 * Aynı faaliyet için bekleyen eski talepler iptal edilir: iki geçerli kod aynı
 * anda dolaşırsa "tek kullanımlık" iddiası anlamını yitirir.
 */
export async function requestActivityDeletion(
  db: DeletionDb,
  actor: DeletionActor,
  activityId: string,
  now: Date,
): Promise<DeletionResult<{ requestId: string; expiresAt: Date }>> {
  if (!actor.isRoot) return fail("not_root");

  const target = await loadTarget(db, activityId);
  if (!target) return fail("not_found");
  if (target.periodClosed) return fail("period_closed");

  // Altı hane; `randomInt` kriptografik kaynaktan besleniyor.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(now.getTime() + DELETION_CODE_TTL_MS);

  const request = await db.$transaction(async (tx) => {
    await tx.activityDeletionRequest.updateMany({
      where: { activityId, consumedAt: null, cancelledAt: null },
      data: { cancelledAt: now },
    });

    const olusan = await tx.activityDeletionRequest.create({
      data: {
        activityId,
        activityTitle: target.title,
        activityDate: target.activityDate,
        activityAuthor: target.authorName,
        requestedById: actor.id,
        codeHash: hashCode(code),
        expiresAt,
        createdAt: now,
      },
      select: { id: true },
    });

    // Kod **bekleyemeyen** bir olaydır: on dakikalık ömrü akşam özetini
    // bekleyemez. `payload` faaliyet kimliğini `activityId` adıyla taşımıyor;
    // taşısaydı kuyruk satırı faaliyete yabancı anahtarla bağlanır ve silme
    // sırasında kendi kanıtını da götürürdü.
    await enqueueNotification(tx as unknown as DeletionDb, {
      userId: actor.id,
      eventType: NOTIFICATION_EVENTS.activityDeletionCode,
      payload: {
        code,
        requestId: olusan.id,
        targetId: activityId,
        title: target.title,
      },
      idempotencyKey: `activity-deletion:${olusan.id}`,
      now,
    });

    return olusan;
  });

  await recordAudit(db, {
    userId: actor.id,
    objectType: AUDIT_OBJECTS.activity,
    objectId: activityId,
    action: AUDIT_ACTIONS.activityDeletionRequested,
    detail: { requestId: request.id, title: target.title },
    now,
  });

  return { ok: true, value: { requestId: request.id, expiresAt } };
}

/**
 * Kodu doğrular ve kaydı **gerçekten** siler.
 *
 * Silme sırası yabancı anahtarların (hepsi `Restrict`) dayattığı sıradır:
 * yapraklardan köke. Sıra bozulursa işlem veritabanınca reddedilir — sessiz
 * bir yarım silme oluşmaz.
 */
export async function confirmActivityDeletion(
  db: DeletionDb,
  actor: DeletionActor,
  activityId: string,
  code: string,
  now: Date,
): Promise<DeletionResult<{ deletedTitle: string }>> {
  if (!actor.isRoot) return fail("not_root");

  const request = await db.activityDeletionRequest.findFirst({
    where: {
      activityId,
      requestedById: actor.id,
      consumedAt: null,
      cancelledAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!request) return fail("no_request");

  if (request.expiresAt.getTime() <= now.getTime()) {
    await db.activityDeletionRequest.update({
      where: { id: request.id },
      data: { cancelledAt: now },
    });
    return fail("expired");
  }

  if (!sameHash(request.codeHash, hashCode(code))) {
    const denemeler = request.attemptCount + 1;
    await db.activityDeletionRequest.update({
      where: { id: request.id },
      data: {
        attemptCount: denemeler,
        // Eşiğe varan talep kapanır: kalan süre boyunca deneme yapılamaz,
        // yeni kod istemek gerekir.
        ...(denemeler >= MAX_DELETION_ATTEMPTS ? { cancelledAt: now } : {}),
      },
    });
    return fail("invalid_code");
  }

  const target = await loadTarget(db, activityId);
  if (!target) return fail("not_found");

  // Ek dosyalarının yolları **silmeden önce** okunuyor: satırlar işlem içinde
  // gidiyor ve sonrasında sorulacak bir yer kalmıyor.
  const dosyaYollari = (
    await attachmentMaintenanceReader(db).findMany({
      where: { activityId },
      select: { storagePath: true },
    })
  ).map((ek) => ek.storagePath);

  // **İkinci dönem kontrolü.** Talep açıldıktan sonra kapanış işi koşmuş
  // olabilir; kilit altında tekrar sorulur.
  const silindi = await db.$transaction(async (tx) => {
    const gecici = tx as unknown as DeletionDb;
    await acquireScoreMutationLock(tx);

    const donem = await periodState(gecici, activityId, target.activityDate);
    if (donem.closed) return "period_closed" as const;

    const mevcut = await activityMaintenanceReader(gecici).findUnique({
      where: { id: activityId },
      select: { id: true, authorId: true, activityDate: true },
    });
    if (!mevcut) return "not_found" as const;

    // Fiziksel silme yasağının kapısı. `SET LOCAL` yalnız bu transaction
    // süresince geçerli; uygulamada bu değişkeni kuran tek yer burasıdır.
    await tx.$executeRawUnsafe("SET LOCAL app.activity_delete = 'evet'");

    const konusmalar = await gecici.conversation.findMany({
      where: { activityId },
      select: { id: true },
    });
    const maddeler = await gecici.followUpItem.findMany({
      where: { activityId },
      select: { id: true },
    });

    await gecici.conversationMessage.deleteMany({
      where: { conversationId: { in: konusmalar.map((satir) => satir.id) } },
    });
    await gecici.conversation.deleteMany({ where: { activityId } });

    await gecici.followUpItemEvent.deleteMany({
      where: { followUpId: { in: maddeler.map((satir) => satir.id) } },
    });
    await gecici.followUpItem.deleteMany({ where: { activityId } });

    await gecici.activityAppreciation.deleteMany({ where: { activityId } });
    await gecici.readReceipt.deleteMany({ where: { activityId } });
    await gecici.attachment.deleteMany({ where: { activityId } });
    await gecici.cancellationRecord.deleteMany({ where: { activityId } });
    await gecici.activityTargetDept.deleteMany({ where: { activityId } });
    await gecici.activityRevision.deleteMany({ where: { activityId } });
    await gecici.activityApprover.deleteMany({ where: { activityId } });
    await gecici.approvalRound.deleteMany({ where: { activityId } });
    await gecici.notificationQueue.deleteMany({ where: { activityId } });

    await gecici.activity.delete({ where: { id: activityId } });

    await gecici.activityDeletionRequest.update({
      where: { id: request.id },
      data: { consumedAt: now },
    });

    // **Skor için ayrıca bir şey yapılmıyor ve bu bilinçli.** Kapanmış dönem
    // zaten silinemiyor; açık dönemin skoru her sorguda canlı hesaplanıyor,
    // yani silinen kayıt kendiliğinden düşüyor. Yeniden hesaplama kuyruğu
    // yalnız **donmuş** karneler için vardır (`enqueueScoreRecalculation`
    // kapalı olmayan dönemde hiçbir şey yazmaz) — buraya çağrı koymak,
    // çalışmayan bir güvence görüntüsü verirdi.
    //
    // Kapanış işiyle yarış yukarıdaki `acquireScoreMutationLock` ile
    // kapatılıyor: kilit alınmadan ikinci dönem kontrolü güvenilir olmazdı.

    // Denetim izi aynı işlemde: "kayıt silindi ama izi yok" durumu mümkün
    // olmamalı (§15.2). `AuditLog.objectId` yabancı anahtar değil, bu yüzden
    // iz silinen kaydı gösterebiliyor.
    await recordAudit(gecici, {
      userId: actor.id,
      objectType: AUDIT_OBJECTS.activity,
      objectId: activityId,
      action: AUDIT_ACTIONS.activityDeleted,
      detail: {
        title: target.title,
        activityDate: target.activityDate.toISOString().slice(0, 10),
        author: target.authorName,
        requestId: request.id,
      },
      now,
    });

    return "ok" as const;
  });

  if (silindi === "period_closed") return fail("period_closed");
  if (silindi === "not_found") return fail("not_found");

  // Dosyalar **işlem başarıyla bittikten sonra** siliniyor: önce silinip
  // transaction geri alınsaydı kayıt kalır, dosyası kaybolurdu.
  for (const yol of dosyaYollari) {
    await deleteStoredFile(yol).catch((hata: unknown) => {
      // Dosya gitmese de kayıt gitti; sessiz geçmiyoruz ki disk artığı
      // operasyonda görünsün.
      console.error(
        "[faaliyet silme] ek dosyası silinemedi",
        JSON.stringify({ activityId, yol, hata: String(hata) }),
      );
    });
  }

  return { ok: true, value: { deletedTitle: target.title } };
}
