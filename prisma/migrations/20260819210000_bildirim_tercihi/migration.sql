-- Bildirim tercihi (Görev 10.8).
--
-- **Elle yazıldı.** Prisma'nın ürettiği dosya `dailyDigestNotifications`
-- sütununu veriyi taşımadan düşürüyor ve yine `DROP SEQUENCE
-- "activity_no_seq"` satırı içeriyor.
--
-- Boolean üç seçeneği anlatamıyordu: "anlık" ile "yalnız benden iş isteyenler"
-- aynı değere düşüyordu.

CREATE TYPE "NotificationMode" AS ENUM ('INSTANT', 'DAILY_DIGEST', 'ACTION_ONLY');

ALTER TABLE "User"
  ADD COLUMN "notificationMode" "NotificationMode" NOT NULL DEFAULT 'INSTANT';

-- Mevcut tercih korunur: özet modundakiler özet modunda kalır.
UPDATE "User"
SET "notificationMode" = 'DAILY_DIGEST'
WHERE "dailyDigestNotifications" = true;

ALTER TABLE "User" DROP COLUMN "dailyDigestNotifications";
