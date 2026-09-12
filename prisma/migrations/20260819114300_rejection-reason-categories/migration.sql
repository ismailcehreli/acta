
CREATE TYPE "ApprovalReasonKind" AS ENUM ('CHANGES_REQUESTED', 'REJECTED');

CREATE TABLE "ApprovalReason" (
    "id" TEXT NOT NULL,
    "kind" "ApprovalReasonKind" NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApprovalReason_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApprovalReason_kind_isActive_sortOrder_idx"
  ON "ApprovalReason"("kind", "isActive", "sortOrder");

CREATE UNIQUE INDEX "ApprovalReason_id_kind_key" ON "ApprovalReason"("id", "kind");

CREATE UNIQUE INDEX "ApprovalReason_kind_label_key" ON "ApprovalReason"("kind", "label");


INSERT INTO "ApprovalReason" ("id", "kind", "label", "sortOrder", "updatedAt")
VALUES
  (gen_random_uuid(), 'CHANGES_REQUESTED', 'Missing information', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHANGES_REQUESTED', 'Unclear; rewrite required', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHANGES_REQUESTED', 'Target department is incorrect', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHANGES_REQUESTED', 'Date is incorrect', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHANGES_REQUESTED', 'Other', 90, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REJECTED', 'Not an activity', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REJECTED', 'Duplicate record', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REJECTED', 'Information is incorrect', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REJECTED', 'Routine work; not worth recording', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REJECTED', 'Other', 90, CURRENT_TIMESTAMP);

ALTER TABLE "Activity"
  ADD COLUMN "approvalReasonId" TEXT,
  ADD COLUMN "approvalReasonKind" "ApprovalReasonKind",
  ADD COLUMN "approvalReasonNote" VARCHAR(1000);

UPDATE "Activity" AS a
SET "approvalReasonNote" = a."changesRequestedReason",
    "approvalReasonKind" = 'CHANGES_REQUESTED',
    "approvalReasonId" = (
      SELECT r."id" FROM "ApprovalReason" r
      WHERE r."kind" = 'CHANGES_REQUESTED' AND r."label" = 'Other'
    )
WHERE a."approvalStatus" = 'CHANGES_REQUESTED';

ALTER TABLE "Activity" DROP CONSTRAINT "Activity_changes_reason_matches_status";
ALTER TABLE "Activity" DROP COLUMN "changesRequestedReason";

ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approvalReasonId_approvalReasonKind_fkey"
  FOREIGN KEY ("approvalReasonId", "approvalReasonKind")
  REFERENCES "ApprovalReason"("id", "kind")
  ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approval_reason_matches_status"
  CHECK (
    ("approvalStatus" IN ('CHANGES_REQUESTED', 'REJECTED'))
    = ("approvalReasonId" IS NOT NULL)
  );

ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approval_reason_kind_matches_status"
  CHECK (
    "approvalReasonKind" IS NULL
    OR "approvalReasonKind"::text = "approvalStatus"::text
  );

ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approval_note_requires_reason"
  CHECK ("approvalReasonNote" IS NULL OR "approvalReasonId" IS NOT NULL);

ALTER TABLE "Activity" DROP CONSTRAINT "Activity_approver_required_in_approval";
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_approver_required_in_approval"
  CHECK (
    "approvalStatus" NOT IN ('PENDING_APPROVAL', 'CHANGES_REQUESTED', 'REJECTED')
    OR "approverId" IS NOT NULL
  );
