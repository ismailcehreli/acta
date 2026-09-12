
CREATE TYPE "BackupRequestSource" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "BackupRequestStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "BackupRequest" (
    "id" TEXT NOT NULL,
    "source" "BackupRequestSource" NOT NULL,
    "requestedById" TEXT,
    "status" "BackupRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "fileName" VARCHAR(500),
    "sizeBytes" BIGINT,
    "message" VARCHAR(1000),

    CONSTRAINT "BackupRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupRequest_status_requestedAt_idx"
  ON "BackupRequest"("status", "requestedAt");
CREATE INDEX "BackupRequest_requestedAt_idx"
  ON "BackupRequest"("requestedAt");
CREATE INDEX "BackupRequest_requestedById_requestedAt_idx"
  ON "BackupRequest"("requestedById", "requestedAt");

CREATE UNIQUE INDEX "BackupRequest_one_active"
  ON "BackupRequest" ((1))
  WHERE "status" IN ('PENDING', 'RUNNING');

ALTER TABLE "BackupRequest"
  ADD CONSTRAINT "BackupRequest_source_actor_check"
  CHECK (
    ("source" = 'MANUAL' AND "requestedById" IS NOT NULL)
    OR ("source" = 'SCHEDULED' AND "requestedById" IS NULL)
  );

ALTER TABLE "BackupRequest"
  ADD CONSTRAINT "BackupRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER "BackupRequest_no_delete" BEFORE DELETE ON "BackupRequest"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();
