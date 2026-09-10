-- İzin vekâleti karar yolu ve uygulama içi geri bildirim kayıtları.

CREATE TYPE "NoActivityDecisionRoute" AS ENUM (
  'DIRECT_ENTRY',
  'DIRECT_MANAGER',
  'DEPUTY',
  'UPPER_MANAGER'
);

ALTER TABLE "NoActivityPeriod"
  ADD COLUMN "decisionRoute" "NoActivityDecisionRoute";

CREATE TYPE "FeedbackCategory" AS ENUM (
  'BUG',
  'SUGGESTION',
  'CRITIQUE',
  'QUESTION'
);

CREATE TYPE "FeedbackStatus" AS ENUM (
  'NEW',
  'IN_REVIEW',
  'RESOLVED'
);

CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "sourcePath" VARCHAR(500),
    "adminsOnly" BOOLEAN NOT NULL DEFAULT false,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "readAt" TIMESTAMPTZ(3),
    "readById" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedById" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" TEXT,
    "response" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Feedback_status_archivedAt_createdAt_idx"
  ON "Feedback"("status", "archivedAt", "createdAt");
CREATE INDEX "Feedback_submittedById_archivedAt_createdAt_idx"
  ON "Feedback"("submittedById", "archivedAt", "createdAt");
CREATE INDEX "Feedback_readAt_status_idx"
  ON "Feedback"("readAt", "status");

ALTER TABLE "Feedback"
  ADD CONSTRAINT "Feedback_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Feedback_readById_fkey"
  FOREIGN KEY ("readById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Feedback_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Feedback_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER "Feedback_no_delete" BEFORE DELETE ON "Feedback"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();
