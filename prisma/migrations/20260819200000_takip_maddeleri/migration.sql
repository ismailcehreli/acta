-- Takip maddeleri (§11, ürün sahibi kararı 19.08.2026 ile Sürüm 1'e alındı).
--
-- **Elle yazıldı.** Prisma'nın ürettiği dosya yine `DROP SEQUENCE
-- "activity_no_seq"` satırı içeriyor.
--
-- Madde bir boolean değil, **geçmişi olan bağımsız kayıttır** (§16.4).
-- Excel'de "Açık/Kapalı" sütunu vardı ve öldü: kimse sahibi değildi ve
-- kapatmanın bedeli yoktu. Sahiplik ve zorunlu kapanış notu bu ikisini çözer.

CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "FollowUpEventKind" AS ENUM (
  'OPENED', 'CLOSED', 'REOPENED', 'TRANSFERRED', 'UPDATED'
);

CREATE TABLE "FollowUpItem" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT NOT NULL,
    "nextStep" VARCHAR(500),
    "reviewDate" DATE,
    "lastMovedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "closingNote" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FollowUpItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FollowUpItemEvent" (
    "id" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "kind" "FollowUpEventKind" NOT NULL,
    "actorId" TEXT NOT NULL,
    "note" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpItemEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FollowUpItem_ownerId_status_lastMovedAt_idx"
  ON "FollowUpItem"("ownerId", "status", "lastMovedAt");
CREATE INDEX "FollowUpItem_activityId_status_idx"
  ON "FollowUpItem"("activityId", "status");
CREATE INDEX "FollowUpItemEvent_followUpId_createdAt_idx"
  ON "FollowUpItemEvent"("followUpId", "createdAt");

ALTER TABLE "FollowUpItem"
  ADD CONSTRAINT "FollowUpItem_activityId_fkey" FOREIGN KEY ("activityId")
    REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FollowUpItem_openedById_fkey" FOREIGN KEY ("openedById")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FollowUpItem_ownerId_fkey" FOREIGN KEY ("ownerId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FollowUpItem_closedById_fkey" FOREIGN KEY ("closedById")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "FollowUpItemEvent"
  ADD CONSTRAINT "FollowUpItemEvent_followUpId_fkey" FOREIGN KEY ("followUpId")
    REFERENCES "FollowUpItem"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FollowUpItemEvent_actorId_fkey" FOREIGN KEY ("actorId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- Değişmezler
-- ---------------------------------------------------------------------------

-- 1. Bir faaliyetin **aynı anda en fazla bir açık** takip maddesi olur.
--    Kapananın yanına yenisi açılabilir; kısmi indeks bunu mümkün kılıyor.
--    İki açık madde, "bu konu kapandı mı" sorusunu cevapsız bırakırdı.
CREATE UNIQUE INDEX "FollowUpItem_one_open_per_activity"
  ON "FollowUpItem"("activityId")
  WHERE "status" = 'OPEN';

-- 2. Kapanış notu **zorunludur** (§11.1) ve yalnız kapalı maddede bulunur.
--    Notsuz kapatma, Excel'deki ölü Açık/Kapalı sütununun ta kendisiydi:
--    kapatmanın bir bedeli yoksa herkes kapatır ve kimse ne olduğunu bilmez.
ALTER TABLE "FollowUpItem"
  ADD CONSTRAINT "FollowUpItem_closing_note_matches_status"
  CHECK (("status" = 'CLOSED') = ("closingNote" IS NOT NULL));

-- 3. Kapatan kişi ve kapanış anı da yalnız kapalı maddede bulunur ve orada
--    bulunmak zorundadır: "kim kapattı" sorusu sonradan sorulamaz hâle
--    gelmemeli.
ALTER TABLE "FollowUpItem"
  ADD CONSTRAINT "FollowUpItem_closer_matches_status"
  CHECK (
    ("status" = 'CLOSED') = ("closedById" IS NOT NULL)
    AND ("status" = 'CLOSED') = ("closedAt" IS NOT NULL)
  );
