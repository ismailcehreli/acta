
CREATE OR REPLACE FUNCTION user_deactivation_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('activity:org_tree'));

  IF OLD."isActive" AND NOT NEW."isActive" AND EXISTS (
    SELECT 1
    FROM "Conversation" c
    JOIN "Activity" a ON a."id" = c."activityId"
    WHERE c."status" = 'OPEN'
      AND (
        c."askerId" = NEW."id"
        OR c."responsibleId" = NEW."id"
        OR a."authorId" = NEW."id"
      )
  ) THEN
    RAISE EXCEPTION 'USER_HAS_OPEN_CONVERSATIONS: a user with open conversations cannot be deactivated';
  END IF;

  RETURN NEW;
END;
$$;
