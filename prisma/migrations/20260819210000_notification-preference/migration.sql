
CREATE TYPE "NotificationMode" AS ENUM ('INSTANT', 'DAILY_DIGEST', 'ACTION_ONLY');

ALTER TABLE "User"
  ADD COLUMN "notificationMode" "NotificationMode" NOT NULL DEFAULT 'INSTANT';

UPDATE "User"
SET "notificationMode" = 'DAILY_DIGEST'
WHERE "dailyDigestNotifications" = true;

ALTER TABLE "User" DROP COLUMN "dailyDigestNotifications";
