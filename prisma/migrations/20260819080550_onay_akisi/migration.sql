-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "approvalDecidedAt" TIMESTAMPTZ(3),
ADD COLUMN     "approverId" TEXT,
ADD COLUMN     "changesRequestedReason" VARCHAR(1000);

-- CreateIndex
CREATE INDEX "Activity_approverId_approvalStatus_idx" ON "Activity"("approverId", "approvalStatus");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- Onay akışının değişmezleri (§5.4, §8.2)
-- ---------------------------------------------------------------------------
-- Uygulama katmanı devre dışıyken de geçerli olsunlar diye buradalar. Onay
-- akışı görünürlüğü belirliyor: onaylayıcısı boş kalan bir "onay bekliyor"
-- kaydı kimsenin önüne düşmez ve sessizce kaybolur.

-- 1. Onay sürecindeki kaydın onaylayıcısı olmak zorundadır.
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approver_required_in_approval"
  CHECK (
    "approvalStatus" NOT IN ('PENDING_APPROVAL', 'CHANGES_REQUESTED')
    OR "approverId" IS NOT NULL
  );

-- 2. Kimse kendi faaliyetinin onaylayıcısı olamaz (§4.4).
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approver_is_not_author"
  CHECK ("approverId" IS NULL OR "approverId" <> "authorId");

-- 3. Düzeltme gerekçesi yalnız "düzeltme istendi" durumunda bulunur ve o
--    durumda **bulunmak zorundadır**: gerekçesiz düzeltme talebi, yazana ne
--    yapacağını söylemeyen bir taleptir.
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_changes_reason_matches_status"
  CHECK (
    ("approvalStatus" = 'CHANGES_REQUESTED') = ("changesRequestedReason" IS NOT NULL)
  );
