-- Tarayıcı push abonelikleri (§12.3, Görev 5.3b).
--
-- **Elle yazıldı.** Prisma'nın ürettiği sürüm yine `DROP SEQUENCE
-- "activity_no_seq"` satırı içeriyordu; o dizi faaliyet sıra numaralarını
-- üretiyor ve düşürülürse numaralar kaybolur. Prisma elle eklenen nesneleri
-- tanımadığı için bu satırı her seferinde yeniden üretiyor.

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    -- Aboneliğin kimliği. Aynı tarayıcı yeniden izin verdiğinde yeni kayıt
    -- açılmaz, mevcut kayıt tazelenir.
    "endpoint" VARCHAR(1000) NOT NULL,
    "p256dh" VARCHAR(255) NOT NULL,
    "auth" VARCHAR(255) NOT NULL,
    "userAgent" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMPTZ(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

ALTER TABLE "PushSubscription"
  ADD CONSTRAINT "PushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
