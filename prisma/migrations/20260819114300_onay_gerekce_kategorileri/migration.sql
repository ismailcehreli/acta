-- Onay kararı gerekçe kategorileri (ürün sahibi kararı, 19.08.2026).
--
-- Serbest metin raporlanamaz: herkes kendi cümlesini yazarsa "faaliyetler
-- neden reddediliyor" sorusu sayıya dökülemez. Kategori zorunlu, serbest
-- açıklama isteğe bağlı.
--
-- **Bu dosya elle yazıldı.** Prisma'nın ürettiği sürüm iki yıkıcı satır
-- içeriyordu: `changesRequestedReason` sütununu veriyi taşımadan düşürüyordu
-- ve `activity_no_seq` dizisini (faaliyet sıra numaraları) tamamen siliyordu.
-- Prisma elle eklenen nesneleri tanımıyor; ürettiği SQL her zaman okunur.

-- ---------------------------------------------------------------------------
-- 1. Gerekçe kataloğu
-- ---------------------------------------------------------------------------
CREATE TYPE "ApprovalReasonKind" AS ENUM ('CHANGES_REQUESTED', 'REJECTED');

CREATE TABLE "ApprovalReason" (
    "id" TEXT NOT NULL,
    "kind" "ApprovalReasonKind" NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApprovalReason_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApprovalReason_kind_isActive_sortOrder_idx"
  ON "ApprovalReason"("kind", "isActive", "sortOrder");

-- Bileşik yabancı anahtarın hedefi.
CREATE UNIQUE INDEX "ApprovalReason_id_kind_key" ON "ApprovalReason"("id", "kind");

-- Aynı karar türünde aynı etiket iki kez tanımlanamaz.
CREATE UNIQUE INDEX "ApprovalReason_kind_label_key" ON "ApprovalReason"("kind", "label");

-- ---------------------------------------------------------------------------
-- 2. Başlangıç kataloğu
-- ---------------------------------------------------------------------------
-- Sistem yöneticisi bunları değiştirir, pasifleştirir ve yenisini ekler.
-- Boş bir katalogla açılış, ilk reddetme denemesinde kilitlenme demek olurdu.

INSERT INTO "ApprovalReason" ("id", "kind", "label", "sortOrder", "updatedAt")
VALUES
  (gen_random_uuid(), 'CHANGES_REQUESTED', 'Eksik bilgi', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHANGES_REQUESTED', 'Anlaşılmıyor, yeniden yazılmalı', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHANGES_REQUESTED', 'Muhatap departman yanlış', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHANGES_REQUESTED', 'Tarih yanlış', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHANGES_REQUESTED', 'Diğer', 90, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REJECTED', 'Faaliyet niteliği taşımıyor', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REJECTED', 'Mükerrer kayıt', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REJECTED', 'Bilgi hatalı', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REJECTED', 'Rutin iş, kayda değmez', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REJECTED', 'Diğer', 90, CURRENT_TIMESTAMP);

-- ---------------------------------------------------------------------------
-- 3. Faaliyete gerekçe alanları
-- ---------------------------------------------------------------------------
ALTER TABLE "Activity"
  ADD COLUMN "approvalReasonId" TEXT,
  ADD COLUMN "approvalReasonKind" "ApprovalReasonKind",
  ADD COLUMN "approvalReasonNote" VARCHAR(1000);

-- Mevcut düzeltme talepleri kaybolmaz: eski serbest metin **açıklamaya**
-- taşınır, kategorileri "Diğer" olur. Sütunu önce düşürmek veriyi yok ederdi.
UPDATE "Activity" AS a
SET "approvalReasonNote" = a."changesRequestedReason",
    "approvalReasonKind" = 'CHANGES_REQUESTED',
    "approvalReasonId" = (
      SELECT r."id" FROM "ApprovalReason" r
      WHERE r."kind" = 'CHANGES_REQUESTED' AND r."label" = 'Diğer'
    )
WHERE a."approvalStatus" = 'CHANGES_REQUESTED';

ALTER TABLE "Activity" DROP CONSTRAINT "Activity_changes_reason_matches_status";
ALTER TABLE "Activity" DROP COLUMN "changesRequestedReason";

ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approvalReasonId_approvalReasonKind_fkey"
  FOREIGN KEY ("approvalReasonId", "approvalReasonKind")
  REFERENCES "ApprovalReason"("id", "kind")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- 4. Değişmezler
-- ---------------------------------------------------------------------------

-- 4a. Gerekçe, yalnız "düzeltme istendi" ve "reddedildi" durumlarında bulunur
--     ve o durumlarda **bulunmak zorundadır**. Gerekçesiz bir reddetme,
--     yazana ne olduğunu söylemeyen bir karardır.
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approval_reason_matches_status"
  CHECK (
    ("approvalStatus" IN ('CHANGES_REQUESTED', 'REJECTED'))
    = ("approvalReasonId" IS NOT NULL)
  );

-- 4b. Gerekçenin türü kararın türüyle aynı olmak zorunda: "reddetme"
--     kararına "eksik bilgi" (düzeltme gerekçesi) iliştirilemez. Bileşik
--     yabancı anahtar türün var olduğunu, bu kısıt da doğru tür olduğunu
--     garanti eder.
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approval_reason_kind_matches_status"
  CHECK (
    "approvalReasonKind" IS NULL
    OR "approvalReasonKind"::text = "approvalStatus"::text
  );

-- 4c. Serbest açıklama, kategorisiz duramaz.
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approval_note_requires_reason"
  CHECK ("approvalReasonNote" IS NULL OR "approvalReasonId" IS NOT NULL);

-- 4d. Reddedilen kaydın da onaylayıcısı olmak zorunda: kararı kimin verdiği
--     kayıptan sonra sorulamaz hâle gelmemeli. (Mevcut kısıt yenileniyor.)
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_approver_required_in_approval";
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approver_required_in_approval"
  CHECK (
    "approvalStatus" NOT IN ('PENDING_APPROVAL', 'CHANGES_REQUESTED', 'REJECTED')
    OR "approverId" IS NOT NULL
  );
