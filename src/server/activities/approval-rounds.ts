import type { PrismaClient } from "@prisma/client";

// Onay turunun **değişmez** kaydı (denetim 23.08.2026, P3-R2-1).
//
// `Activity.approvalSubmittedAt` "şu an ne zamandır bekliyor" demektir ve
// karar verilirken **boşaltılır** — hatırlatma sayacı için doğru, ölçüm için
// yıkıcı: karar anında gönderim anı kayboluyor ve "kaç iş gününde karara
// bağladı" sorusu cevapsız kalıyordu. Skor bu yüzden canlı sütunlardan değil
// buradan besleniyor.
//
// Ayrı tablo olmasının ikinci sebebi: bir kayıt düzeltilip **yeniden
// gönderilebiliyor**. Tek sütun ikinci turu yazarken birincinin üstüne yazar;
// tur başına satır, her turun kendi süresini korur.

export type ApprovalRoundDb = Pick<PrismaClient, "approvalRound">;

/**
 * Turu kapatabilen kararlar.
 *
 * Bütün `ActivityApprovalStatus` kümesi değil: **iptal bir onay kararı
 * değildir** (kaydı yazan ya da üst zincir iptal eder, onay kuyruğu o anda
 * zaten boştur) ve "yönetici bulunamadı" da karar değil, bir arıza durumudur.
 * Veritabanı aynı daraltmayı `ApprovalRound_gecerli_karar` kısıtıyla tutuyor
 * (denetim 23.08.2026, P3-R3-1).
 */
export type ApprovalDecision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

/**
 * Yeni tur açar: iş onaylayıcının önüne düştü.
 *
 * Tur numarası mevcut en büyüğün bir fazlası; kısmi tekil indeks aynı anda
 * ikinci bir açık turu veritabanı düzeyinde engelliyor.
 */
export async function openApprovalRound(
  db: ApprovalRoundDb,
  activityId: string,
  now: Date,
): Promise<void> {
  const sonTur = await db.approvalRound.findFirst({
    where: { activityId },
    orderBy: { roundNo: "desc" },
    select: { roundNo: true },
  });

  await db.approvalRound.create({
    data: {
      activityId,
      roundNo: (sonTur?.roundNo ?? 0) + 1,
      submittedAt: now,
    },
  });
}

/**
 * Açık turu karara bağlar. **Ret de karardır** ve aynı satırı kapatır.
 *
 * Açık tur bulunamazsa sessizce geçilmez: kararın geçmişi eksik kalırsa skor
 * o kararı hiç görmez ve yönetici ölçülmediği bir boyuttan tam puan alır.
 */
export async function closeApprovalRound(
  db: ApprovalRoundDb,
  activityId: string,
  decidedById: string,
  decision: ApprovalDecision,
  now: Date,
  /**
   * Açık tur yoksa ne olacağı.
   *
   * `hata` varsayılandır: karar, iş onaylayıcının önündeyken verilir ve o
   * hâlde açık bir tur **olmak zorundadır**; bulunamaması geçmişin eksik
   * kalması demektir ve sessizce geçilirse yönetici ölçülmediği bir boyuttan
   * tam puan alır.
   *
   * `atla` yalnız tek bir durumda geçerli: düzeltme istenmiş kayıt
   * reddedildiğinde. O sırada iş **yazarın** önündedir, onaylayıcı
   * beklenmiyordur; ölçülecek bir süre yoktur.
   */
  acikTurYoksa: "hata" | "atla" = "hata",
): Promise<void> {
  const acik = await db.approvalRound.findFirst({
    where: { activityId, decidedAt: null },
    orderBy: { roundNo: "desc" },
    select: { id: true },
  });

  if (!acik) {
    if (acikTurYoksa === "atla") return;

    throw new Error(
      `Onay turu bulunamadı: ${activityId}. Karar, açık bir tur olmadan verilemez.`,
    );
  }

  await db.approvalRound.update({
    where: { id: acik.id },
    data: { decidedAt: now, decidedById, decision },
  });
}
