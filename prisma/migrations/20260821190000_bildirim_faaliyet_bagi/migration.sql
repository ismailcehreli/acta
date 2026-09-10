-- Bildirim satırına gerçek bir faaliyet bağı (denetim 21.08.2026, bulgu 3).
--
-- Sorun: bildirim kutusu, okunmamış sayacı ve e-posta göndericisi kuyruğu
-- yalnız `userId` ile okuyordu. Faaliyet kimliği JSON yükün içindeydi ve JSON
-- alanına görünürlük koşulu bağlanamıyor. Sonuç: bir müdür başka dala
-- taşındıktan sonra bile eski kaydın başlığını zil kutusunda görüyor, hatta
-- kuyrukta bekleyen e-posta **başlığı taşıyarak** ona gidiyordu.
--
-- Çözüm: kimliği ayrı sütuna çıkarmak. Böylece "her okuma yolu tek görünürlük
-- modülünden geçer" kuralı bu üç yol için de sorgunun içinde uygulanabiliyor.

ALTER TABLE "NotificationQueue" ADD COLUMN "activityId" TEXT;

-- Mevcut satırlar yükten doldurulur. Yalnız **hâlâ var olan** faaliyetler:
-- örnek veri temizliği geçmiş olabilir ve yabancı anahtar onu tutamaz.
UPDATE "NotificationQueue" q
   SET "activityId" = q."payload"->>'activityId'
 WHERE q."payload" ? 'activityId'
   AND EXISTS (
     SELECT 1 FROM "Activity" a WHERE a."id" = q."payload"->>'activityId'
   );

ALTER TABLE "NotificationQueue"
  ADD CONSTRAINT "NotificationQueue_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "NotificationQueue_activityId_idx" ON "NotificationQueue"("activityId");

-- Gönderilmeden kapatılan bildirim için ayrı durum. `FAILED` demek yanlış
-- olurdu: ortada arıza yok, gönderilmemesi doğru karar.
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
