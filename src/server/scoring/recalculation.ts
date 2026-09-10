import type { Prisma, PrismaClient } from "@prisma/client";

export const SCORE_CLOSURE_LOCK_KEY = "faaliyet:skor_kapanisi";

/** Gün alanını ait olduğu aylık skor döneminin ilk gününe çevirir. */
export function scorePeriodStart(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

export type ScoreRecalculationDb = Pick<
  PrismaClient,
  | "scorePeriodLedger"
  | "scoreRecalculationRequest"
  | "userScorePeriod"
  | "$executeRaw"
>;

/** İlk kapanış ve tarihsel düzeltmenin dışlayıcı işlem kilidi. */
export async function acquireScoreClosureLock(
  db: Pick<Prisma.TransactionClient, "$executeRaw">,
  lockKey = SCORE_CLOSURE_LOCK_KEY,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
}

/**
 * Normal skor-etkili faaliyet mutasyonlarının ortak işlem kilidi.
 *
 * Paylaşımlı kipte iki faaliyet yazısı birbirini beklemez. İlk kapanış ise
 * dışlayıcı kipte aynı anahtarı alır: açık yazılar bitmeden başlayamaz ve
 * başladıktan sonra yeni yazıları karne/kuyruk kararını verene kadar tutar.
 */
export async function acquireScoreMutationLock(
  db: Pick<Prisma.TransactionClient, "$executeRaw">,
  lockKey = SCORE_CLOSURE_LOCK_KEY,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${lockKey}))`;
}

/**
 * Donmuş dönemi etkileyen mutasyonu idempotent kuyruğa yazar.
 *
 * Bu işlev asıl mutasyonun transaction istemcisiyle çağrılır. Dönem henüz ilk
 * kez kapanmadıysa kuyruk gerekmez; ilk kapanış zaten yeni veriyi toplayacaktır.
 */
export async function enqueueScoreRecalculation(
  db: ScoreRecalculationDb | Prisma.TransactionClient,
  input: {
    userId: string;
    activityDate: Date;
    sourceType: string;
    sourceId: string;
    now: Date;
  },
): Promise<void> {
  // İlk kapanışla mutasyon arasındaki pencereyi kapatır. Kapanış kilidi önce
  // aldıysa bu işlem ledger yazılana kadar bekler ve ardından kuyruk üretir;
  // mutasyon önce aldıysa kapanış yeni veriyi gördükten sonra dönemi mühürler.
  // Aksi hâlde ikisi aynı anda ilerleyip hem ilk sürümden hem kuyruktan düşen
  // bir karar/faaliyet bırakabilirdi.
  await acquireScoreMutationLock(db);

  const periodStart = scorePeriodStart(input.activityDate);
  const closed = await db.scorePeriodLedger.findUnique({
    where: { periodStart },
    select: { periodStart: true },
  });
  if (!closed) return;

  // Puan kapsamı dışındaki kullanıcının bu dönem için hiç karnesi yoktur.
  // Onay/iptal yine geçerlidir ama skor düzeltme isteği üretmek, işçinin
  // çözebileceği bir önceki sürüm olmadığı için kuyruğu zehirler.
  const previous = await db.userScorePeriod.findFirst({
    where: { userId: input.userId, periodStart, frozen: true },
    select: { revisionNo: true },
  });
  if (!previous) return;

  await db.scoreRecalculationRequest.upsert({
    where: {
      userId_periodStart_sourceType_sourceId: {
        userId: input.userId,
        periodStart,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
    update: {},
    create: {
      userId: input.userId,
      periodStart,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      requestedAt: input.now,
    },
  });
}
