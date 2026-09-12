
ALTER TABLE "NotificationQueue" ADD COLUMN "seenAt" TIMESTAMPTZ(3);

CREATE INDEX "NotificationQueue_userId_channel_seenAt_idx"
  ON "NotificationQueue"("userId", "channel", "seenAt");
