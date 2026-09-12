
UPDATE "Conversation" c
SET "closeType" = 'CANCELLED_ACTIVITY'
WHERE c."closeType" = 'ADMINISTRATIVE'
  AND EXISTS (
    SELECT 1 FROM "CancellationRecord" r WHERE r."activityId" = c."activityId"
  );

UPDATE "Conversation"
SET "closeReason" = '(legacy record: closed before a reason field existed)'
WHERE "closeType" = 'ADMINISTRATIVE'
  AND btrim(coalesce("closeReason", '')) = '';

UPDATE "Conversation"
SET "closeReason" = NULL
WHERE "closeType" IS DISTINCT FROM 'ADMINISTRATIVE'
  AND "closeReason" IS NOT NULL;

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_close_reason_matches_type" CHECK (
    CASE
      WHEN "closeType" = 'ADMINISTRATIVE'
        THEN btrim(coalesce("closeReason", '')) <> ''
      ELSE "closeReason" IS NULL
    END
  );
