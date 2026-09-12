
CREATE OR REPLACE FUNCTION forbid_physical_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.demo_purge', true) = 'yes' THEN
    RETURN OLD;
  END IF;

  IF current_setting('app.activity_delete', true) = 'yes' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'PHYSICAL_DELETE_FORBIDDEN: records cannot be deleted from table %; users and units must be deactivated, and activities must be cancelled',
    TG_TABLE_NAME;
END;
$$;

CREATE TABLE "ActivityDeletionRequest" (
  "id"             TEXT NOT NULL,
  "activityId"     TEXT NOT NULL,
  "activityTitle"  VARCHAR(300) NOT NULL,
  "activityDate"   DATE NOT NULL,
  "activityAuthor" VARCHAR(200) NOT NULL,
  "requestedById"  TEXT NOT NULL,
  "codeHash"       VARCHAR(64) NOT NULL,
  "expiresAt"      TIMESTAMPTZ(3) NOT NULL,
  "attemptCount"   INTEGER NOT NULL DEFAULT 0,
  "consumedAt"     TIMESTAMPTZ(3),
  "cancelledAt"    TIMESTAMPTZ(3),
  "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ActivityDeletionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActivityDeletionRequest_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ActivityDeletionRequest_single_outcome"
    CHECK ("consumedAt" IS NULL OR "cancelledAt" IS NULL),
  CONSTRAINT "ActivityDeletionRequest_attempts_nonnegative"
    CHECK ("attemptCount" >= 0)
);

CREATE INDEX "ActivityDeletionRequest_requestedById_createdAt_idx"
  ON "ActivityDeletionRequest"("requestedById", "createdAt");
CREATE INDEX "ActivityDeletionRequest_activityId_idx"
  ON "ActivityDeletionRequest"("activityId");

CREATE TRIGGER "ActivityDeletionRequest_no_delete" BEFORE DELETE ON "ActivityDeletionRequest"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();
