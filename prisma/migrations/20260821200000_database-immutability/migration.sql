
CREATE OR REPLACE FUNCTION assert_system_admin_remains() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."isSystemAdmin" AND OLD."isActive")
     AND NOT (NEW."isSystemAdmin" AND NEW."isActive") THEN

    PERFORM pg_advisory_xact_lock(hashtext('system_admin_roster'));

    IF NOT EXISTS (
      SELECT 1 FROM "User"
      WHERE "isSystemAdmin" AND "isActive" AND "id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION
        'LAST_SYSTEM_ADMIN: the last active system administrator cannot lose their privileges';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_keep_system_admin" BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION assert_system_admin_remains();

CREATE OR REPLACE FUNCTION assert_attachment_limit() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  maximum   INT;
  current_count  INT;
BEGIN
  PERFORM 1 FROM "Activity" WHERE "id" = NEW."activityId" FOR UPDATE;

  SELECT COALESCE(
           (SELECT "value"::int FROM "SystemSetting"
             WHERE "key" = 'attachment_max_count' AND "value" ~ '^[0-9]+$'),
           5)
    INTO maximum;

  SELECT count(*) INTO current_count FROM "Attachment" WHERE "activityId" = NEW."activityId";

  IF current_count > maximum THEN
    RAISE EXCEPTION
      'ATTACHMENT_LIMIT_EXCEEDED: an activity can have at most % attachments', maximum;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Attachment_limit" AFTER INSERT ON "Attachment"
  FOR EACH ROW EXECUTE FUNCTION assert_attachment_limit();

CREATE OR REPLACE FUNCTION assert_follow_up_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'CLOSED' AND NEW."status" = 'CLOSED'
     AND (
       OLD."closedAt"     IS DISTINCT FROM NEW."closedAt"
       OR OLD."closedById"  IS DISTINCT FROM NEW."closedById"
       OR OLD."closingNote" IS DISTINCT FROM NEW."closingNote"
     ) THEN
    RAISE EXCEPTION
      'FOLLOW_UP_ALREADY_CLOSED: a closed item cannot be closed again';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "FollowUpItem_transition" BEFORE UPDATE ON "FollowUpItem"
  FOR EACH ROW EXECUTE FUNCTION assert_follow_up_transition();

CREATE OR REPLACE FUNCTION assert_approval_reason_remains() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" AND NOT NEW."isActive" THEN
    PERFORM pg_advisory_xact_lock(hashtext('approval_reason:' || NEW."kind"::text));

    IF NOT EXISTS (
      SELECT 1 FROM "ApprovalReason"
      WHERE "kind" = NEW."kind" AND "isActive" AND "id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION
        'LAST_APPROVAL_REASON: the last active reason for this decision type cannot be deactivated';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ApprovalReason_keep_one_active" BEFORE UPDATE ON "ApprovalReason"
  FOR EACH ROW EXECUTE FUNCTION assert_approval_reason_remains();
