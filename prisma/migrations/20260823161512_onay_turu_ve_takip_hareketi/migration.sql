-- Onay turu kaydı ve takip maddesi hareket olayı
-- (denetim 23.08.2026, P3-R2-1 ve P3-R2-3).
--
-- Prisma'nın ürettiği dosya okundu ve **üç satır silindi**: `activity_no_seq`
-- dizisini düşüren iki satır ve `ActivityDraft.targetOrgUnitIds` varsayılanını
-- kaldıran satır. Üçü de elle eklenmiş nesnelerdi; Prisma onları tanımıyor
-- (AGENTS.md'deki kural). Gereksiz indeks düşür/yeniden kur çifti de çıkarıldı.

-- Takip maddesine "hareket gördü" olayı: `lastMovedAt` güncel bir sütundur ve
-- geçmiş dönem hesabında kullanılamaz; hareket artık geçmişte de duruyor.
ALTER TYPE "FollowUpEventKind" ADD VALUE 'TOUCHED';

-- Onay turu: gönderim anı karar verilirken kaybolmasın.
CREATE TABLE "ApprovalRound" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "roundNo" INTEGER NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,
    "decision" "ActivityApprovalStatus",

    CONSTRAINT "ApprovalRound_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApprovalRound_decidedById_decidedAt_idx" ON "ApprovalRound"("decidedById", "decidedAt");
CREATE UNIQUE INDEX "ApprovalRound_activityId_roundNo_key" ON "ApprovalRound"("activityId", "roundNo");

ALTER TABLE "ApprovalRound" ADD CONSTRAINT "ApprovalRound_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ApprovalRound" ADD CONSTRAINT "ApprovalRound_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- **Bir faaliyette aynı anda en fazla bir açık tur olabilir.** Kısmi tekil
-- indeks Prisma şemasıyla ifade edilemiyor; iş kuralı veritabanında da durur.
CREATE UNIQUE INDEX "ApprovalRound_tek_acik_tur"
  ON "ApprovalRound"("activityId") WHERE "decidedAt" IS NULL;

-- Karar verilmiş turda karar sahibi ve kararın kendisi zorunlu; verilmemiş
-- turda ikisi de boş olmalı.
ALTER TABLE "ApprovalRound" ADD CONSTRAINT "ApprovalRound_karar_butunlugu" CHECK (
  ("decidedAt" IS NULL AND "decidedById" IS NULL AND "decision" IS NULL)
  OR ("decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL AND "decision" IS NOT NULL)
);

-- Karar, gönderimden önce olamaz.
ALTER TABLE "ApprovalRound" ADD CONSTRAINT "ApprovalRound_karar_gonderimden_sonra" CHECK (
  "decidedAt" IS NULL OR "decidedAt" >= "submittedAt"
);

-- **Geriye dönük doldurma yalnız bekleyen kayıtlar için mümkün.** Karar
-- verilmiş eski kayıtlarda gönderim anı zaten silinmişti; olmayan veri
-- uydurulmuyor. O kayıtlar onay süresi boyutuna girmez.
INSERT INTO "ApprovalRound" ("id", "activityId", "roundNo", "submittedAt")
SELECT gen_random_uuid(), a."id", 1, a."approvalSubmittedAt"
FROM "Activity" a
WHERE a."approvalStatus" = 'PENDING_APPROVAL' AND a."approvalSubmittedAt" IS NOT NULL;
