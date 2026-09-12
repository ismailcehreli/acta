
ALTER TABLE "User"
  ADD COLUMN "canViewReports" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "canViewScoreReports" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "User"
SET "canViewReports" = TRUE,
    "canViewScoreReports" = TRUE
WHERE "isRoot" = TRUE;
