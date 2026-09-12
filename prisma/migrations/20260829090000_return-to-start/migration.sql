
ALTER TABLE "UserCredential"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "SystemResetStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "SystemResetRequest" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" "SystemResetStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "bootstrapFullName" VARCHAR(150) NOT NULL,
    "bootstrapEmail" VARCHAR(255) NOT NULL,
    "bootstrapPasswordHash" VARCHAR(255),
    "message" VARCHAR(1000),

    CONSTRAINT "SystemResetRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemResetRequest_status_requestedAt_idx"
  ON "SystemResetRequest"("status", "requestedAt");
CREATE INDEX "SystemResetRequest_requestedById_requestedAt_idx"
  ON "SystemResetRequest"("requestedById", "requestedAt");

CREATE UNIQUE INDEX "SystemResetRequest_one_active"
  ON "SystemResetRequest" ((1))
  WHERE "status" IN ('PENDING', 'RUNNING');

ALTER TABLE "SystemResetRequest"
  ADD CONSTRAINT "SystemResetRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
