

CREATE OR REPLACE FUNCTION org_unit_tree_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  ancestor_id  TEXT;
  depth_from_root INT := 1;
  subtree_height  INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('activity:org_tree'));

  IF NEW."parentId" IS NOT NULL THEN
    IF NEW."parentId" = NEW."id" THEN
      RAISE EXCEPTION 'ORG_TREE_CYCLE: a unit cannot be its own parent';
    END IF;

    ancestor_id := NEW."parentId";
    WHILE ancestor_id IS NOT NULL LOOP
      IF ancestor_id = NEW."id" THEN
        RAISE EXCEPTION 'ORG_TREE_CYCLE: this move would create a cycle';
      END IF;

      depth_from_root := depth_from_root + 1;
      IF depth_from_root > 10 THEN
        RAISE EXCEPTION 'ORG_TREE_MAX_DEPTH: the tree cannot exceed 10 levels';
      END IF;

      SELECT "parentId" INTO ancestor_id FROM "OrgUnit" WHERE "id" = ancestor_id;
    END LOOP;
  END IF;

  SELECT COALESCE(MAX(level), 1) INTO subtree_height
  FROM (
    WITH RECURSIVE subtree(id, level) AS (
      SELECT "id", 1 FROM "OrgUnit" WHERE "id" = NEW."id"
      UNION ALL
      SELECT child."id", parent.level + 1
      FROM "OrgUnit" child
      JOIN subtree parent ON child."parentId" = parent.id
      WHERE parent.level < 20
    )
    SELECT level FROM subtree
  ) levels;

  IF depth_from_root + subtree_height - 1 > 10 THEN
    RAISE EXCEPTION 'ORG_TREE_MAX_DEPTH: this move would put a branch beyond 10 levels';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION user_active_unit_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('activity:org_tree'));

  IF NEW."isActive" AND NOT EXISTS (
    SELECT 1 FROM "OrgUnit" WHERE "id" = NEW."orgUnitId" AND "isActive"
  ) THEN
    RAISE EXCEPTION 'USER_INACTIVE_ORG_UNIT: an active user cannot belong to an inactive unit';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION org_unit_deactivation_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('activity:org_tree'));

  IF OLD."isActive" AND NOT NEW."isActive" AND EXISTS (
    SELECT 1 FROM "User" WHERE "orgUnitId" = NEW."id" AND "isActive"
  ) THEN
    RAISE EXCEPTION 'ORG_UNIT_HAS_ACTIVE_USERS: a unit with active users cannot be deactivated';
  END IF;

  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION activity_target_limit_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  target_count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('activity:target'), hashtext(NEW."activityId")
  );

  SELECT COUNT(*) INTO target_count
  FROM "ActivityTargetDept"
  WHERE "activityId" = NEW."activityId";

  IF target_count >= 5 THEN
    RAISE EXCEPTION 'ACTIVITY_TARGET_LIMIT: an activity can have at most 5 target departments';
  END IF;

  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION forbid_physical_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'PHYSICAL_DELETE_FORBIDDEN: records cannot be deleted from table %; users and units must be deactivated, and activities must be cancelled',
    TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "OrgUnit_no_delete" BEFORE DELETE ON "OrgUnit"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "User_no_delete" BEFORE DELETE ON "User"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "Activity_no_delete" BEFORE DELETE ON "Activity"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "ActivityRevision_no_delete" BEFORE DELETE ON "ActivityRevision"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "Attachment_no_delete" BEFORE DELETE ON "Attachment"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "CancellationRecord_no_delete" BEFORE DELETE ON "CancellationRecord"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "Conversation_no_delete" BEFORE DELETE ON "Conversation"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "ConversationMessage_no_delete" BEFORE DELETE ON "ConversationMessage"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "AuditLog_no_delete" BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE OR REPLACE FUNCTION forbid_audit_update() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: audit log cannot be modified';
END;
$$;

CREATE TRIGGER "AuditLog_no_update" BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_update();
