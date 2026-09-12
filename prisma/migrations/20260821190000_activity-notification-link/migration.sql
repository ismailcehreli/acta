
ALTER TABLE "NotificationQueue" ADD COLUMN "activityId" TEXT;

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

ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
