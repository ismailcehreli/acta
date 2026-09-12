
ALTER TABLE "NoActivityPeriod"
  ADD COLUMN "cancelledAt"        TIMESTAMPTZ(3),
  ADD COLUMN "cancelledById"      TEXT,
  ADD COLUMN "cancellationReason" VARCHAR(500);

ALTER TABLE "NoActivityPeriod"
  ADD CONSTRAINT "NoActivityPeriod_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "NoActivityPeriod"
  ADD CONSTRAINT "NoActivityPeriod_cancellation_complete"
  CHECK (
    ("cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancellationReason" IS NULL)
    OR (
      "cancelledAt" IS NOT NULL
      AND "cancelledById" IS NOT NULL
      AND "cancellationReason" IS NOT NULL
      AND length(btrim("cancellationReason")) > 0
    )
  );

ALTER TABLE "NoActivityPeriod" DROP CONSTRAINT "NoActivityPeriod_no_overlap";

ALTER TABLE "NoActivityPeriod"
  ADD CONSTRAINT "NoActivityPeriod_no_overlap"
  EXCLUDE USING gist (
    "userId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  ) WHERE ("cancelledAt" IS NULL);

CREATE TRIGGER "NoActivityPeriod_no_delete" BEFORE DELETE ON "NoActivityPeriod"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE INDEX "NoActivityPeriod_deputyId_cancelledAt_idx"
  ON "NoActivityPeriod"("deputyId", "cancelledAt");
