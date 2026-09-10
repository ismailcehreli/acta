-- İdari kapatmanın gerekçesi zorunludur; diğer kapanış türlerinde gerekçe
-- alanı boş kalır (§9.3, ürün sahibi kararı — plan açık soru 9 ve 10).
--
-- Kural uygulama katmanında da var; buraya indirilmesinin sebebi, kısıtın
-- uygulama devre dışıyken (elle SQL, veri aktarımı) de geçerli olmasıdır.
--
-- Ayrı migration: önceki dosya enum'a yeni değer ekliyor ve PostgreSQL yeni
-- enum değerini aynı işlem içinde kullandırmıyor.

-- 1. Faaliyet iptalinin kapattığı konuşmalar bugüne kadar ADMINISTRATIVE
--    yazılıyordu. Ayrı türe taşınıyorlar; gerekçe zaten iptal kaydındadır.
UPDATE "Conversation" c
SET "closeType" = 'CANCELLED_ACTIVITY'
WHERE c."closeType" = 'ADMINISTRATIVE'
  AND EXISTS (
    SELECT 1 FROM "CancellationRecord" r WHERE r."activityId" = c."activityId"
  );

-- 2. Kalan idari kapatmaların gerekçesi hiç tutulmamıştı. Uydurma bir metin
--    yazmak kaydı yanlış anlatırdı; durumu açıkça söyleyen bir işaret konur.
UPDATE "Conversation"
SET "closeReason" = '(geçmiş kayıt: gerekçe alanı yokken kapatıldı)'
WHERE "closeType" = 'ADMINISTRATIVE'
  AND btrim(coalesce("closeReason", '')) = '';

-- 3. İdari olmayan kapanışlarda gerekçe alanı boş kalır.
UPDATE "Conversation"
SET "closeReason" = NULL
WHERE "closeType" IS DISTINCT FROM 'ADMINISTRATIVE'
  AND "closeReason" IS NOT NULL;

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_close_reason_matches_type" CHECK (
    CASE
      WHEN "closeType" = 'ADMINISTRATIVE'
        THEN btrim(coalesce("closeReason", '')) <> ''
      ELSE "closeReason" IS NULL
    END
  );
