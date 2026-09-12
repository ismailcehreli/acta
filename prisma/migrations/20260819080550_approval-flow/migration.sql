ALTER TABLE "Activity" ADD COLUMN     "approvalDecidedAt" TIMESTAMPTZ(3),
ADD COLUMN     "approverId" TEXT,
ADD COLUMN     "changesRequestedReason" VARCHAR(1000);

CREATE INDEX "Activity_approverId_approvalStatus_idx" ON "Activity"("approverId", "approvalStatus");

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approver_required_in_approval"
  CHECK (
    "approvalStatus" NOT IN ('PENDING_APPROVAL', 'CHANGES_REQUESTED')
    OR "approverId" IS NOT NULL
  );

ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approver_is_not_author"
  CHECK ("approverId" IS NULL OR "approverId" <> "authorId");

ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_changes_reason_matches_status"
  CHECK (
    ("approvalStatus" = 'CHANGES_REQUESTED') = ("changesRequestedReason" IS NOT NULL)
  );
