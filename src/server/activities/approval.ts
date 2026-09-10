import type {
  Activity,
  ActivityApprovalStatus,
  ApprovalReasonKind,
  PrismaClient,
} from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  activityMaintenanceReader,
  lockActivityForMaintenance,
  listAuthorizedActivities,
} from "@/server/authz/activity-repository";
import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { activeDeputyFor } from "@/server/authz/deputy";
import { approvalQueueWhere } from "@/server/authz/visibility";
import { resolveManagers } from "@/server/org/resolve-manager";
import { REALTIME_EVENTS } from "@/server/realtime/events";
import { publishRealtimeEvent } from "@/server/realtime/publish";
import {
  acquireScoreMutationLock,
  enqueueScoreRecalculation,
} from "@/server/scoring/recalculation";

import { closeApprovalRound } from "./approval-rounds";

// Onay akışı (§5.4 durum modeli, §8.2 yetki matrisi).
//
// Akış tasarımdaki diyagramın birebir karşılığıdır:
//
//   onay_bekliyor → onaylandi
//        ↓
//   duzeltme_istendi → (düzeltilir) → onay_bekliyor
//
//   onay_bekliyor / duzeltme_istendi → yonetici_bulunamadi  (§4.4 hata durumu)
//
// **Onaylayan yalnız aktif onaylayıcıdır** ve o da §4.4'ün çözdüğü kişidir.
// Zincirde olmak yetmez: Genel Müdür de Kalıphane çalışanının zincirindedir
// ama onaylayıcısı Kalıphane Müdürü'dür. Akışın varlık sebebi zaten bu —
// süzülmemiş içerik yukarı akmasın.
//
// Sistem yöneticisi onaylayamaz: işlevsel yetki içerik erişimi vermez (§15.1).

export type ApprovalDb = Pick<
  PrismaClient,
  | "activity"
  | "approvalRound"
  | "approvalReason"
  | "user"
  | "orgUnit"
  | "notificationQueue"
  | "systemSetting"
  | "auditLog"
  | "$transaction"
  | "$executeRaw"
  | "$executeRawUnsafe"
  | "noActivityPeriod"
  | "scorePeriodLedger"
  | "scoreRecalculationRequest"
  | "userScorePeriod"
>;

export type ApprovalError =
  | "not_found"
  | "not_approver"
  | "wrong_status"
  | "reason_required"
  | "conflict";

export type ApprovalResult =
  | { ok: true; value: Activity }
  | { ok: false; error: ApprovalError; message: string };

const MESSAGES: Record<ApprovalError, string> = {
  not_found: "Faaliyet bulunamadı.",
  not_approver: "Bu faaliyetin onayı size düşmüyor.",
  wrong_status: "Faaliyet onay bekleyen durumda değil.",
  reason_required: "Geçerli bir gerekçe seçilmeli.",
  conflict: "Faaliyet bu sırada değişti. Sayfayı yenileyip tekrar deneyin.",
};

function fail(error: ApprovalError): ApprovalResult {
  return { ok: false, error, message: MESSAGES[error] };
}

/**
 * Yeni kaydın doğacağı durum (§5.4).
 *
 * Onaya tabi olmayan birimde kayıt doğrudan `onaylandi` doğar. Onaya tabi
 * birimde onaylayıcı çözülür; bulunamazsa kayıt **kaybolmaz**, hata durumunda
 * bekler ve sistem yöneticisine alarm gider (§4.4).
 *
 * **Birim yöneticisi kendi biriminin onay bayrağına tabi değildir** (§4.3,
 * §7.4). Tasarımın bayrak tablosu "departman çalışanı: evet, müdür ve üstü:
 * hayır" diyor ama bayrak birim **düğümünde** duruyor ve müdür yönettiği
 * birimin içinde oturuyor; bayrak tek başına ikisini ayıramaz. Ayrımı burada
 * `isUnitManager` yapıyor — süzgecin kendisi süzgeçten geçmez, müdürün kaydı
 * bugünkü gibi doğrudan yukarı akar.
 *
 * Karar **çağırana bırakılmıyor**: bayrağı taşıyan `author` nesnesini kuran
 * her yol kuralı yeniden hatırlamak zorunda kalırdı ve biri unuttuğunda kayıt
 * sessizce yanlış kuyruğa düşerdi.
 */
export async function resolveInitialApproval(
  db: Pick<PrismaClient, "user" | "orgUnit">,
  author: { id: string; requiresApproval: boolean },
): Promise<
  | { status: "APPROVED"; approverId: null; approverIds: string[] }
  | { status: "PENDING_APPROVAL"; approverId: string; approverIds: string[] }
  | { status: "MANAGER_NOT_FOUND"; approverId: null; approverIds: string[] }
> {
  if (!author.requiresApproval) {
    return { status: "APPROVED", approverId: null, approverIds: [] };
  }

  const yazan = await db.user.findUnique({
    where: { id: author.id },
    select: { isUnitManager: true },
  });

  // Kişi bulunamadıysa muafiyet **varsayılmaz**: karar aşağıdaki çözüme kalır,
  // o da kişiyi bulamayınca yöneticisiz durumu döndürür (§4.4).
  if (yazan?.isUnitManager) {
    return { status: "APPROVED", approverId: null, approverIds: [] };
  }

  // Birimde birden fazla müdür olabilir (20.08.2026 kararı): kayıt hepsinin
  // kuyruğuna düşer, ilk karar veren kapatır. `approverId` karar öncesinde
  // ilk çözüleni, karar sonrasında **kararı vereni** taşır.
  const managers = await resolveManagers(db, author.id);

  if (!managers.found) {
    return { status: "MANAGER_NOT_FOUND", approverId: null, approverIds: [] };
  }

  return {
    status: "PENDING_APPROVAL",
    approverId: managers.managerIds[0],
    approverIds: managers.managerIds,
  };
}

/** Onay kararının ortak kilit protokolü; iki karar aynı satırda yarışabilir. */
async function withLockedActivity(
  db: ApprovalDb,
  activityId: string,
  actorId: string,
  now: Date,
  beklenen: ActivityApprovalStatus[],
  islem: (
    tx: ApprovalDb,
    mevcut: {
      id: string;
      authorId: string;
      activityDate: Date;
      title: string;
      /** Karar duyurusunun gideceği diğer müdürler. */
      eligibleApproverIds: string[];
      /** Vekâletle karar veriliyorsa kimin adına; değilse `null`. */
      onBehalfOfId: string | null;
      /**
       * Kilit altında okunan **güncel** durum.
       *
       * Karar yolunun hangi durumdan geldiği kararın kendisini değiştiriyor:
       * bekleyen kayıtta açık bir onay turu **olmak zorundadır**, düzeltme
       * istenmiş kayıtta ise iş yazarın önündedir ve tur yoktur
       * (denetim 23.08.2026, P3-R3-2).
       */
      durum: ActivityApprovalStatus;
    },
  ) => Promise<Activity>,
): Promise<ApprovalResult> {
  const activity = await activityMaintenanceReader(db).findUnique({
    where: { id: activityId },
    select: {
      id: true,
      authorId: true,
      activityDate: true,
      title: true,
      approverId: true,
      approvalStatus: true,
      eligibleApprovers: { select: { userId: true } },
    },
  });

  // Onayı ona düşmeyen kişi kaydın **varlığını** da öğrenmez: "bulunamadı" ile
  // "yetkiniz yok" aynı cevabı verirdi ama burada ayrım güvenlik açığı değil,
  // yalnız kolaylık olurdu — yine de sızdırmamayı seçiyoruz (§8.2).
  if (!activity) return fail("not_found");

  // Yetki artık tek sütuna değil **uygun onaylayıcılar listesine** bakar:
  // iki müdürlü birimde ikisi de karar verebilir.
  const uygunlar = new Set(activity.eligibleApprovers.map((satir) => satir.userId));

  // Vekâlet süresince, vekâlet edilenin onayı vekile de açıktır (§4.5).
  // Bu hak **türetilir, dondurulmaz**: süre bitince kendiliğinden kapanır.
  //
  // Buradaki okuma yalnız **ucuz ön eleme**dir: yetkisi olmayan biri için
  // boşuna transaction açmamak içindir. Kararın dayandığı okuma kilitten
  // sonra, işlemin içinde yapılır (aşağıda).
  const onVekalet = await activeDeputyFor(db, actorId, now);

  if (!uygunlar.has(actorId) && !onVekalet.some((kisiId) => uygunlar.has(kisiId))) {
    return fail("not_found");
  }

  if (!beklenen.includes(activity.approvalStatus)) {
    return fail("wrong_status");
  }

  const sonuc = await db.$transaction(async (tx) => {
    const gecici = tx as unknown as ApprovalDb;

    // Kilit sırası: skor kapanışı → faaliyet satırı. Kuyruk kilidini karar
    // yazıldıktan sonra almak kapanışın FK okumasıyla kilitlenme sarmalı
    // doğurur ve kararın ilk sürüm/kuyruk arasından düşmesini engellemez.
    await acquireScoreMutationLock(tx);

    // Satır kilitlenir: iki karar (onayla / düzeltme iste) aynı anda
    // gelebiliyor ve ikincisi birincinin sonucunu ezerdi.
    await lockActivityForMaintenance(gecici, activityId);

    const taze = await activityMaintenanceReader(gecici).findUnique({
      where: { id: activityId },
      select: {
        approvalStatus: true,
        eligibleApprovers: { select: { userId: true } },
      },
    });

    if (!taze) return null;
    // Kilidi aldıktan sonra listeyi yeniden okuruz: iki müdür aynı anda
    // karar verirse ikincisi burada durur ve `conflict` alır. "İlk karar
    // veren kapatır" kuralı bu satırda uygulanıyor.
    const tazeUygunlar = new Set(taze.eligibleApprovers.map((s) => s.userId));

    // **Vekâlet de burada yeniden okunur** (denetim 21.08.2026,
    // bulgu 4). Önceden kilitten önce okunmuş liste yetki kanıtı olarak
    // kullanılıyordu: vekil onaya basıp kilitte beklerken yönetici dönemi
    // kaldırırsa, kilit açıldığında artık yetkisi olmayan kişi kararı
    // tamamlıyordu. Yetkinin dayandığı okuma, yazmanın yapıldığı işlemin
    // içinde olmalı.
    const tazeVekalet = await activeDeputyFor(gecici, actorId, now);
    const adinaKararVerilen = tazeVekalet.find((kisiId) => tazeUygunlar.has(kisiId));

    const hâlâYetkili = tazeUygunlar.has(actorId) || adinaKararVerilen !== undefined;

    if (!hâlâYetkili) return null;
    if (!beklenen.includes(taze.approvalStatus)) return null;

    return islem(gecici, {
      id: activity.id,
      authorId: activity.authorId,
      activityDate: activity.activityDate,
      title: activity.title,
      // Kilit altında okunan taze liste: karar duyurusu, kararın verildiği
      // andaki müdürlere gider.
      eligibleApproverIds: [...tazeUygunlar],
      // Vekâletle karar veriliyorsa kimin adına verildiği; denetim izine ve
      // ekrana "X adına Y" olarak yazılır.
      onBehalfOfId: adinaKararVerilen ?? null,
      durum: taze.approvalStatus,
    });
  });

  if (sonuc === null) return fail("conflict");
  return { ok: true, value: sonuc };
}

export async function approveActivity(
  db: ApprovalDb,
  actorId: string,
  activityId: string,
  now: Date,
): Promise<ApprovalResult> {
  return withLockedActivity(
    db,
    activityId,
    actorId,
    now,
    ["PENDING_APPROVAL"],
    async (tx, mevcut) => {
      const guncel = await tx.activity.update({
        where: { id: activityId },
        data: {
          approvalStatus: "APPROVED",
          // Karardan sonra `approverId` "kim onayladı"nın cevabıdır. İki
          // müdürlü birimde bu, kaydı ilk eline alan kişidir.
          approverId: actorId,
          approvalDecidedAt: now,
          approvalSubmittedAt: null,
          // Onaylanan kayıtta eski karar gerekçesi durmaz; kısıt da
          // durmasına izin vermez.
          approvalReasonId: null,
          approvalReasonKind: null,
          approvalReasonNote: null,
        },
      });

      // Turu karara bağla: gönderim anı burada kaybolmasın (P3-R2-1).
      // **Ret de karardır** ve aynı satırı kapatır.
      await closeApprovalRound(tx, activityId, actorId, "APPROVED", now);
      await enqueueScoreRecalculation(tx, {
        userId: mevcut.authorId,
        activityDate: mevcut.activityDate,
        sourceType: "ACTIVITY_APPROVED",
        sourceId: `${activityId}:${now.toISOString()}`,
        now,
      });

      await enqueueNotification(tx, {
        userId: mevcut.authorId,
        eventType: NOTIFICATION_EVENTS.activityApproved,
        payload: { activityId, activityTitle: mevcut.title },
        idempotencyKey: `activity_approved:${activityId}`,
        now,
      });

      await recordAudit(tx, {
        userId: actorId,
        // Vekâletle verilen karar izde "X adına Y" olarak durur.
        actualUserId: mevcut.onBehalfOfId,
        objectType: AUDIT_OBJECTS.activity,
        objectId: activityId,
        action: AUDIT_ACTIONS.activityApproved,
        // Denetim izi içerik taşımaz (§15.1).
        now,
      });

      // Karar, **diğer uygun onaylayıcılara da** duyurulur: kayıt onların
      // kuyruğundan düşmeli. Duyurulmazsa iki müdürlü birimde ikinci müdür
      // kapanmış bir işi kendi listesinde görmeye devam ederdi.
      await publishRealtimeEvent(tx, {
        kind: REALTIME_EVENTS.approvalDecided,
        userIds: [mevcut.authorId, actorId, ...mevcut.eligibleApproverIds],
      });

      return guncel;
    },
  );
}

/**
 * Gerekçe kategorisinin var, aktif ve **doğru türde** olduğunu doğrular.
 * Tür uyumunu veritabanı da bileşik yabancı anahtarla zorluyor; burada
 * kullanıcıya anlaşılır cevap vermek için bakılıyor.
 */
async function resolveReason(
  db: ApprovalDb,
  kind: ApprovalReasonKind,
  reasonId: string,
): Promise<{ id: string } | null> {
  const reason = await db.approvalReason.findFirst({
    where: { id: reasonId, kind, isActive: true },
    select: { id: true },
  });

  return reason;
}

export interface ApprovalDecisionInput {
  /** Sistem yöneticisinin tanımladığı kategori; zorunlu. */
  reasonId: string;
  /** Serbest açıklama; isteğe bağlı. */
  note?: string | null;
}

export async function requestChanges(
  db: ApprovalDb,
  actorId: string,
  activityId: string,
  input: ApprovalDecisionInput,
  now: Date,
): Promise<ApprovalResult> {
  const reason = await resolveReason(db, "CHANGES_REQUESTED", input.reasonId);
  if (!reason) return fail("reason_required");

  const not = input.note?.trim() ?? "";

  return withLockedActivity(
    db,
    activityId,
    actorId,
    now,
    ["PENDING_APPROVAL"],
    async (tx, mevcut) => {
      const guncel = await tx.activity.update({
        where: { id: activityId },
        data: {
          approvalStatus: "CHANGES_REQUESTED",
          approverId: actorId,
          approvalDecidedAt: now,
          // Top yazana geçti; onay sayacı durur.
          approvalSubmittedAt: null,
          approvalReasonId: reason.id,
          approvalReasonKind: "CHANGES_REQUESTED",
          approvalReasonNote: not === "" ? null : not,
        },
      });

      // Turu karara bağla: gönderim anı burada kaybolmasın (P3-R2-1).
      // **Ret de karardır** ve aynı satırı kapatır.
      await closeApprovalRound(tx, activityId, actorId, "CHANGES_REQUESTED", now);
      await enqueueScoreRecalculation(tx, {
        userId: mevcut.authorId,
        activityDate: mevcut.activityDate,
        sourceType: "ACTIVITY_CHANGES_REQUESTED",
        sourceId: `${activityId}:${now.toISOString()}`,
        now,
      });

      await enqueueNotification(tx, {
        userId: mevcut.authorId,
        eventType: NOTIFICATION_EVENTS.changesRequested,
        // Gerekçe metni bildirime **girmez**: içerik postada taşınmaz (§12.3).
        payload: { activityId, activityTitle: mevcut.title },
        idempotencyKey: `changes_requested:${activityId}:${now.getTime()}`,
        now,
      });

      await recordAudit(tx, {
        userId: actorId,
        // Vekâletle verilen karar izde "X adına Y" olarak durur.
        actualUserId: mevcut.onBehalfOfId,
        objectType: AUDIT_OBJECTS.activity,
        objectId: activityId,
        action: AUDIT_ACTIONS.activityChangesRequested,
        // Kategori denetim izine yazılır: raporlanabilir olan odur. Serbest
        // açıklama içeriktir, ize girmez (§15.1).
        detail: { reasonId: reason.id },
        now,
      });

      // Karar, **diğer uygun onaylayıcılara da** duyurulur: kayıt onların
      // kuyruğundan düşmeli. Duyurulmazsa iki müdürlü birimde ikinci müdür
      // kapanmış bir işi kendi listesinde görmeye devam ederdi.
      await publishRealtimeEvent(tx, {
        kind: REALTIME_EVENTS.approvalDecided,
        userIds: [mevcut.authorId, actorId, ...mevcut.eligibleApproverIds],
      });

      return guncel;
    },
  );
}

/**
 * Reddetme (ürün sahibi kararı, 19.08.2026). **İptalden farklıdır:** iptal
 * yayımlanmış bir kaydın geri çekilmesidir, reddetme kaydın hiç kabul
 * edilmemesi. İkisi aynı duruma tıkılsaydı denetim izinde "bu kayıt
 * yayımlandı mı" sorusu cevapsız kalırdı.
 *
 * `CHANGES_REQUESTED` durumundan da reddedilebilir: müdür düzeltme istedikten
 * sonra yazar kaydı hiç düzeltmezse, kayıt aksi hâlde sonsuza kadar askıda
 * kalırdı — ne kapanabilir ne de yukarı akabilirdi.
 *
 * Reddedilen kayıt **silinmez** (§16.6) ve **yukarı akmaz**: yazan ve kararı
 * veren görür, üst zincir görmez. Süzgecin bütün amacı budur.
 */
export async function rejectActivity(
  db: ApprovalDb,
  actorId: string,
  activityId: string,
  input: ApprovalDecisionInput,
  now: Date,
): Promise<ApprovalResult> {
  const reason = await resolveReason(db, "REJECTED", input.reasonId);
  if (!reason) return fail("reason_required");

  const not = input.note?.trim() ?? "";

  return withLockedActivity(
    db,
    activityId,
    actorId,
    now,
    ["PENDING_APPROVAL", "CHANGES_REQUESTED"],
    async (tx, mevcut) => {
      const guncel = await tx.activity.update({
        where: { id: activityId },
        data: {
          approvalStatus: "REJECTED",
          approverId: actorId,
          approvalDecidedAt: now,
          approvalSubmittedAt: null,
          approvalReasonId: reason.id,
          approvalReasonKind: "REJECTED",
          approvalReasonNote: not === "" ? null : not,
        },
      });

      // Turu karara bağla: gönderim anı burada kaybolmasın (P3-R2-1).
      // **Ret de karardır** ve aynı satırı kapatır.
      // Düzeltme istenmiş kayıt reddedilebiliyor (ürün sahibi kararı,
      // 19.08.2026). O sırada iş **yazarın** önünde olduğu için açık tur
      // yoktur ve ölçülecek bir bekleme süresi de yoktur. **Bekleyen** kayıtta
      // ise tur zorunlu: yokluğunu yutmak, kararın geçmişe hiç yazılmaması
      // ve yöneticinin ölçülmediği bir boyuttan tam puan alması demek olurdu.
      await closeApprovalRound(
        tx,
        activityId,
        actorId,
        "REJECTED",
        now,
        mevcut.durum === "CHANGES_REQUESTED" ? "atla" : "hata",
      );
      await enqueueScoreRecalculation(tx, {
        userId: mevcut.authorId,
        activityDate: mevcut.activityDate,
        sourceType: "ACTIVITY_REJECTED",
        sourceId: `${activityId}:${now.toISOString()}`,
        now,
      });

      await enqueueNotification(tx, {
        userId: mevcut.authorId,
        eventType: NOTIFICATION_EVENTS.activityRejected,
        payload: { activityId, activityTitle: mevcut.title },
        idempotencyKey: `activity_rejected:${activityId}`,
        now,
      });

      await recordAudit(tx, {
        userId: actorId,
        // Vekâletle verilen karar izde "X adına Y" olarak durur.
        actualUserId: mevcut.onBehalfOfId,
        objectType: AUDIT_OBJECTS.activity,
        objectId: activityId,
        action: AUDIT_ACTIONS.activityRejected,
        detail: { reasonId: reason.id },
        now,
      });

      // Karar, **diğer uygun onaylayıcılara da** duyurulur: kayıt onların
      // kuyruğundan düşmeli. Duyurulmazsa iki müdürlü birimde ikinci müdür
      // kapanmış bir işi kendi listesinde görmeye devam ederdi.
      await publishRealtimeEvent(tx, {
        kind: REALTIME_EVENTS.approvalDecided,
        userIds: [mevcut.authorId, actorId, ...mevcut.eligibleApproverIds],
      });

      return guncel;
    },
  );
}

/** Onayımı bekleyenler (§13.1 bloğu). Yalnız kendi önündeki iş. */
/**
 * Bu kişi bu kayda karar verebilir mi?
 *
 * **Ekranla eylem aynı kaynaktan beslenmeli.** Detay ekranı eskiden
 * `activity.approverId === user.id` diye bakıyordu; tek sütunlu dünyadan
 * kalma bir kontroldü ve iki durumda yanlış cevap veriyordu (21.08.2026'da
 * vekâlet testi yakaladı):
 *
 *   · İki müdürlü birimde **ikinci müdüre** onay paneli hiç çıkmıyordu.
 *   · Vekâlet süresince **vekile** çıkmıyordu.
 *
 * İkisinde de sunucu eylemi kararı kabul ederdi ama kullanıcı düğmeyi
 * göremediği için ulaşamıyordu. Yetki yine eylemde doğrulanıyor; buradaki
 * tek iş paneli göstermek.
 */
export async function canDecideOnActivity(
  db: Pick<PrismaClient, "activityApprover" | "noActivityPeriod">,
  userId: string,
  activityId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const vekaletEttikleri = await activeDeputyFor(db, userId, now);

  const satir = await db.activityApprover.findFirst({
    where: { activityId, userId: { in: [userId, ...vekaletEttikleri] } },
    select: { userId: true },
  });

  return satir !== null;
}

export async function listPendingApprovals(
  db: Pick<PrismaClient, "activity" | "noActivityPeriod">,
  approverId: string,
  now: Date = new Date(),
): Promise<
  {
    id: string;
    title: string;
    activityDate: Date;
    authorName: string;
    authorUnitName: string;
  }[]
> {
  const rows = await listAuthorizedActivities(db, approvalQueueWhere(approverId, now), {
    // Kuyruk koşulu görünürlük modülünden gelir (§8): "onayı bana düşenler"
    // sorusunu üç ekran soruyor ve her birinin kendi süzgecini yazması,
    // birinin diğerinden sessizce ayrışması demekti. Koşul vekâleti de
    // **sorgunun içinde** çözer; önceden okunan kimlik listesiyle değil
    // (denetim 21.08.2026, bulgu 2).
    where: { approvalStatus: "PENDING_APPROVAL" },
    orderBy: [{ activityDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      activityDate: true,
      author: { select: { fullName: true } },
      authorOrgUnit: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    activityDate: row.activityDate,
    authorName: row.author.fullName,
    authorUnitName: row.authorOrgUnit.name,
  }));
}
