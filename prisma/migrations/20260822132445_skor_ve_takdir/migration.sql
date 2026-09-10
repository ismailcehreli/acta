-- Skor ve takdir (Görev 11.10, 11.11).
--
-- Prisma yine üç zararlı satır yazmıştı ve silindi (AGENTS.md kuralı):
-- `DROP SEQUENCE "activity_no_seq"` (faaliyet sıra numarasının kaynağı),
-- bir indeksin düşürülüp yeniden kurulması ve bir varsayılanın düşürülmesi.
-- Bu görevde üçüncü kez aynı satırlar üretildi.

-- DropIndex

-- AlterTable

-- AlterTable

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canAppreciate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isScored" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "UserScorePeriod" (
    "userId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "regularity" INTEGER NOT NULL,
    "acceptance" INTEGER,
    "approval" INTEGER,
    "followUp" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "expectedDays" INTEGER NOT NULL,
    "writtenDays" INTEGER NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserScorePeriod_pkey" PRIMARY KEY ("userId","periodStart")
);

-- CreateTable
CREATE TABLE "ActivityAppreciation" (
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityAppreciation_pkey" PRIMARY KEY ("activityId","userId")
);

-- CreateIndex
CREATE INDEX "UserScorePeriod_periodStart_idx" ON "UserScorePeriod"("periodStart");

-- CreateIndex
CREATE INDEX "ActivityAppreciation_userId_idx" ON "ActivityAppreciation"("userId");

-- CreateIndex

-- AddForeignKey
ALTER TABLE "UserScorePeriod" ADD CONSTRAINT "UserScorePeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ActivityAppreciation" ADD CONSTRAINT "ActivityAppreciation_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ActivityAppreciation" ADD CONSTRAINT "ActivityAppreciation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- İş kuralı veritabanında da durur (proje kuralı).
--
-- Puanlar 0–100 aralığında ve toplam da öyle. Aralık dışı bir puan, hesabı
-- yazan koddaki bir hatanın sessizce veriye geçmesi demekti.
ALTER TABLE "UserScorePeriod"
  ADD CONSTRAINT "UserScorePeriod_valid_scores"
  CHECK (
    "regularity" BETWEEN 0 AND 100
    AND ("acceptance" IS NULL OR "acceptance" BETWEEN 0 AND 100)
    AND ("approval" IS NULL OR "approval" BETWEEN 0 AND 100)
    AND "followUp" BETWEEN 0 AND 100
    AND "total" BETWEEN 0 AND 100
  );

-- Pay paydayı aşamaz: "20 iş gününün 25'inde yazdı" anlamsızdır.
ALTER TABLE "UserScorePeriod"
  ADD CONSTRAINT "UserScorePeriod_valid_days"
  CHECK ("expectedDays" >= 0 AND "writtenDays" BETWEEN 0 AND "expectedDays");
