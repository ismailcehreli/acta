
DROP INDEX IF EXISTS "User_one_manager_per_unit_idx";

CREATE INDEX IF NOT EXISTS "User_unit_managers_idx"
  ON "User" ("orgUnitId")
  WHERE "isUnitManager";

CREATE TABLE "ActivityApprover" (
  "activityId" TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

  CONSTRAINT "ActivityApprover_pkey" PRIMARY KEY ("activityId", "userId"),
  CONSTRAINT "ActivityApprover_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "Activity"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ActivityApprover_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "ActivityApprover_userId_idx" ON "ActivityApprover" ("userId");

INSERT INTO "ActivityApprover" ("activityId", "userId")
SELECT "id", "approverId" FROM "Activity" WHERE "approverId" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TRIGGER "ActivityApprover_no_delete" BEFORE DELETE ON "ActivityApprover"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();
