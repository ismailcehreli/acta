
ALTER TYPE "FollowUpEventKind" ADD VALUE 'TOUCHED';

CREATE TABLE "ApprovalRound" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "roundNo" INTEGER NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,
    "decision" "ActivityApprovalStatus",

    CONSTRAINT "ApprovalRound_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApprovalRound_decidedById_decidedAt_idx" ON "ApprovalRound"("decidedById", "decidedAt");
CREATE UNIQUE INDEX "ApprovalRound_activityId_roundNo_key" ON "ApprovalRound"("activityId", "roundNo");

ALTER TABLE "ApprovalRound" ADD CONSTRAINT "ApprovalRound_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ApprovalRound" ADD CONSTRAINT "ApprovalRound_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "ApprovalRound_single_open_type"
  ON "ApprovalRound"("activityId") WHERE "decidedAt" IS NULL;

ALTER TABLE "ApprovalRound" ADD CONSTRAINT "ApprovalRound_decision_consistency" CHECK (
  ("decidedAt" IS NULL AND "decidedById" IS NULL AND "decision" IS NULL)
  OR ("decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL AND "decision" IS NOT NULL)
);

ALTER TABLE "ApprovalRound" ADD CONSTRAINT "ApprovalRound_decision_after_submission" CHECK (
  "decidedAt" IS NULL OR "decidedAt" >= "submittedAt"
);

INSERT INTO "ApprovalRound" ("id", "activityId", "roundNo", "submittedAt")
SELECT gen_random_uuid(), a."id", 1, a."approvalSubmittedAt"
FROM "Activity" a
WHERE a."approvalStatus" = 'PENDING_APPROVAL' AND a."approvalSubmittedAt" IS NOT NULL;
