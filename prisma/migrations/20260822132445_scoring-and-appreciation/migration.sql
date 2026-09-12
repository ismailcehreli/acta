



ALTER TABLE "User" ADD COLUMN     "canAppreciate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isScored" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "UserScorePeriod" (
    "userId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "regularity" INTEGER NOT NULL,
    "acceptance" INTEGER,
    "approval" INTEGER,
    "followUp" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "expectedDays" INTEGER NOT NULL,
    "writtenDays" INTEGER NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserScorePeriod_pkey" PRIMARY KEY ("userId","periodStart")
);

CREATE TABLE "ActivityAppreciation" (
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityAppreciation_pkey" PRIMARY KEY ("activityId","userId")
);

CREATE INDEX "UserScorePeriod_periodStart_idx" ON "UserScorePeriod"("periodStart");

CREATE INDEX "ActivityAppreciation_userId_idx" ON "ActivityAppreciation"("userId");


ALTER TABLE "UserScorePeriod" ADD CONSTRAINT "UserScorePeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ActivityAppreciation" ADD CONSTRAINT "ActivityAppreciation_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ActivityAppreciation" ADD CONSTRAINT "ActivityAppreciation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "UserScorePeriod"
  ADD CONSTRAINT "UserScorePeriod_valid_scores"
  CHECK (
    "regularity" BETWEEN 0 AND 100
    AND ("acceptance" IS NULL OR "acceptance" BETWEEN 0 AND 100)
    AND ("approval" IS NULL OR "approval" BETWEEN 0 AND 100)
    AND "followUp" BETWEEN 0 AND 100
    AND "total" BETWEEN 0 AND 100
  );

ALTER TABLE "UserScorePeriod"
  ADD CONSTRAINT "UserScorePeriod_valid_days"
  CHECK ("expectedDays" >= 0 AND "writtenDays" BETWEEN 0 AND "expectedDays");
