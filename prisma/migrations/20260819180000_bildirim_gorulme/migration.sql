-- Uygulama içi bildirim: görülme işareti (Görev 10.4).
--
-- **Elle yazıldı.** Prisma'nın ürettiği dosya yine `DROP SEQUENCE
-- "activity_no_seq"` satırı içeriyor; o dizi faaliyet sıra numaralarını
-- üretiyor ve düşürülürse numaralar kaybolur.
--
-- `seenAt` gönderimden bağımsızdır: e-posta gitmemiş olabilir ama kişi ekranda
-- görmüş olabilir, ya da tersi. Bu yüzden `sentAt` yeniden kullanılmadı.

ALTER TABLE "NotificationQueue" ADD COLUMN "seenAt" TIMESTAMPTZ(3);

CREATE INDEX "NotificationQueue_userId_channel_seenAt_idx"
  ON "NotificationQueue"("userId", "channel", "seenAt");
