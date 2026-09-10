-- Taslak ekleri ve gönderilmiş faaliyette kısa süreli düzeltme (04.09.2026).
--
-- Taslak metni ayrı tabloda tutulduğu gibi taslak eki de ayrı tutulur. Faaliyet
-- eki tablosuna erken yazmak, taslak görünürlüğünü her ek okuma yoluna
-- taşırdı. Yabancı anahtarlar RESTRICT'tir; taslak eki önce özel işlemle
-- tüketilmeden taslak satırı kaldırılamaz.

CREATE TABLE "ActivityDraftAttachment" (
  "id"           TEXT NOT NULL,
  "draftId"      TEXT NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "storedName"   VARCHAR(255) NOT NULL,
  "storagePath"  VARCHAR(500) NOT NULL,
  "sizeBytes"    INTEGER NOT NULL,
  "mimeType"     VARCHAR(150) NOT NULL,
  "sha256"       CHAR(64) NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "createdAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ActivityDraftAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActivityDraftAttachment_storedName_key" UNIQUE ("storedName"),
  CONSTRAINT "ActivityDraftAttachment_draftId_sha256_originalName_key"
    UNIQUE ("draftId", "sha256", "originalName"),
  CONSTRAINT "ActivityDraftAttachment_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "ActivityDraft"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ActivityDraftAttachment_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "ActivityDraftAttachment_draftId_createdAt_idx"
  ON "ActivityDraftAttachment" ("draftId", "createdAt");
CREATE INDEX "ActivityDraftAttachment_sha256_idx"
  ON "ActivityDraftAttachment" ("sha256");

-- Taslak eki satırları, taslak silinmeden doğrudan silinemez. İki dar kapı
-- transaction'a özeldir ve bağlantı havuzuna sızmaz:
--   app.activity_draft_delete   → yazar kendi taslağını açıkça siliyor
--   app.activity_draft_promote  → taslak gönderilirken faaliyet ekine taşıyor
CREATE OR REPLACE FUNCTION forbid_activity_draft_attachment_delete()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.activity_draft_delete', true) = 'evet'
     OR current_setting('app.activity_draft_promote', true) = 'evet' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'PHYSICAL_DELETE_FORBIDDEN: ActivityDraftAttachment doğrudan silinemez; taslak silme veya gönderim işlemi kullanılmalı';
END;
$$;

CREATE TRIGGER "ActivityDraftAttachment_no_delete"
  BEFORE DELETE ON "ActivityDraftAttachment"
  FOR EACH ROW EXECUTE FUNCTION forbid_activity_draft_attachment_delete();
