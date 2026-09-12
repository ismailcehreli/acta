
CREATE TYPE "NoActivityPeriodStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "NoActivityPeriod"
  ADD COLUMN "status" "NoActivityPeriodStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "decidedAt" TIMESTAMPTZ(3),
  ADD COLUMN "decidedById" TEXT,
  ADD COLUMN "decisionReason" VARCHAR(500);

ALTER TABLE "NoActivityPeriod"
  ADD CONSTRAINT "NoActivityPeriod_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "NoActivityPeriod" DROP CONSTRAINT "NoActivityPeriod_no_overlap";

ALTER TABLE "NoActivityPeriod"
  ADD CONSTRAINT "NoActivityPeriod_no_overlap"
  EXCLUDE USING gist (
    "userId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  ) WHERE ("cancelledAt" IS NULL AND "status" IN ('PENDING', 'APPROVED'));

CREATE INDEX "NoActivityPeriod_userId_status_cancelledAt_idx"
  ON "NoActivityPeriod"("userId", "status", "cancelledAt");
CREATE INDEX "NoActivityPeriod_decidedById_decidedAt_idx"
  ON "NoActivityPeriod"("decidedById", "decidedAt");

CREATE OR REPLACE FUNCTION check_no_activity_period_decision() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'PENDING'
     AND (NEW."decidedAt" IS NOT NULL
       OR NEW."decidedById" IS NOT NULL
       OR NEW."decisionReason" IS NOT NULL) THEN
    RAISE EXCEPTION 'NO_ACTIVITY_PENDING_WITH_DECISION: a pending activity cannot carry decision data';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "NoActivityPeriod_status_consistency"
  BEFORE INSERT OR UPDATE ON "NoActivityPeriod"
  FOR EACH ROW EXECUTE FUNCTION check_no_activity_period_decision();

CREATE TABLE "HelpArticle" (
    "id" TEXT NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "HelpArticle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HelpArticle_category_archivedAt_isPublished_idx"
  ON "HelpArticle"("category", "archivedAt", "isPublished");
CREATE INDEX "HelpArticle_archivedAt_sortOrder_idx"
  ON "HelpArticle"("archivedAt", "sortOrder");

ALTER TABLE "HelpArticle"
  ADD CONSTRAINT "HelpArticle_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "HelpArticle_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER "HelpArticle_no_delete" BEFORE DELETE ON "HelpArticle"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

ALTER TABLE "User"
  ADD COLUMN "lastLoginAt" TIMESTAMPTZ(3);
