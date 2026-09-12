
CREATE SEQUENCE IF NOT EXISTS activity_no_seq;

ALTER TABLE "Activity" ADD COLUMN "activityNo" INTEGER;

WITH ordered_rows AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS sequence_no
  FROM "Activity"
)
UPDATE "Activity" a
SET "activityNo" = ordered_rows.sequence_no
FROM ordered_rows
WHERE a."id" = ordered_rows."id";

SELECT setval(
  'activity_no_seq',
  COALESCE((SELECT MAX("activityNo") FROM "Activity"), 0) + 1,
  false
);

ALTER TABLE "Activity"
  ALTER COLUMN "activityNo" SET DEFAULT nextval('activity_no_seq'),
  ALTER COLUMN "activityNo" SET NOT NULL;

ALTER SEQUENCE activity_no_seq OWNED BY "Activity"."activityNo";

CREATE UNIQUE INDEX "Activity_activityNo_key" ON "Activity"("activityNo");
