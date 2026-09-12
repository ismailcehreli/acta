
CREATE UNIQUE INDEX "OrgUnit_single_root_idx"
  ON "OrgUnit" ((TRUE))
  WHERE "parentId" IS NULL;

CREATE UNIQUE INDEX "User_one_manager_per_unit_idx"
  ON "User" ("orgUnitId")
  WHERE "isUnitManager";

CREATE OR REPLACE FUNCTION org_unit_tree_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  ancestor_id  TEXT;
  depth_from_root INT := 1;
  subtree_height  INT;
BEGIN
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

CREATE TRIGGER "OrgUnit_tree_guard"
  BEFORE INSERT OR UPDATE OF "parentId" ON "OrgUnit"
  FOR EACH ROW EXECUTE FUNCTION org_unit_tree_guard();

CREATE OR REPLACE FUNCTION user_active_unit_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."isActive" AND NOT EXISTS (
    SELECT 1 FROM "OrgUnit" WHERE "id" = NEW."orgUnitId" AND "isActive"
  ) THEN
    RAISE EXCEPTION 'USER_INACTIVE_ORG_UNIT: an active user cannot belong to an inactive unit';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_active_unit_guard"
  BEFORE INSERT OR UPDATE OF "isActive", "orgUnitId" ON "User"
  FOR EACH ROW EXECUTE FUNCTION user_active_unit_guard();

CREATE OR REPLACE FUNCTION org_unit_deactivation_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" AND NOT NEW."isActive" AND EXISTS (
    SELECT 1 FROM "User" WHERE "orgUnitId" = NEW."id" AND "isActive"
  ) THEN
    RAISE EXCEPTION 'ORG_UNIT_HAS_ACTIVE_USERS: a unit with active users cannot be deactivated';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "OrgUnit_deactivation_guard"
  BEFORE UPDATE OF "isActive" ON "OrgUnit"
  FOR EACH ROW EXECUTE FUNCTION org_unit_deactivation_guard();

CREATE OR REPLACE FUNCTION activity_target_limit_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  target_count INT;
BEGIN
  SELECT COUNT(*) INTO target_count
  FROM "ActivityTargetDept"
  WHERE "activityId" = NEW."activityId";

  IF target_count >= 5 THEN
    RAISE EXCEPTION 'ACTIVITY_TARGET_LIMIT: an activity can have at most 5 target departments';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ActivityTargetDept_limit_guard"
  BEFORE INSERT ON "ActivityTargetDept"
  FOR EACH ROW EXECUTE FUNCTION activity_target_limit_guard();

CREATE OR REPLACE FUNCTION activity_status_transition_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."approvalStatus" = NEW."approvalStatus" THEN
    RETURN NEW;
  END IF;

  IF NOT (
       (OLD."approvalStatus" = 'DRAFT'
          AND NEW."approvalStatus" IN ('PENDING_APPROVAL', 'APPROVED'))
    OR (OLD."approvalStatus" = 'PENDING_APPROVAL'
          AND NEW."approvalStatus" IN ('APPROVED', 'CHANGES_REQUESTED', 'MANAGER_NOT_FOUND'))
    OR (OLD."approvalStatus" = 'CHANGES_REQUESTED'
          AND NEW."approvalStatus" IN ('PENDING_APPROVAL', 'MANAGER_NOT_FOUND'))
    OR (OLD."approvalStatus" = 'MANAGER_NOT_FOUND'
          AND NEW."approvalStatus" = 'PENDING_APPROVAL')
    OR (OLD."approvalStatus" = 'APPROVED'
          AND NEW."approvalStatus" = 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'ACTIVITY_INVALID_STATUS_TRANSITION: % → % transition is not defined',
      OLD."approvalStatus", NEW."approvalStatus";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Activity_status_transition_guard"
  BEFORE UPDATE OF "approvalStatus" ON "Activity"
  FOR EACH ROW EXECUTE FUNCTION activity_status_transition_guard();

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "NoActivityPeriod"
  ADD CONSTRAINT "NoActivityPeriod_valid_range"
  CHECK ("endDate" >= "startDate");

ALTER TABLE "NoActivityPeriod"
  ADD CONSTRAINT "NoActivityPeriod_no_overlap"
  EXCLUDE USING gist (
    "userId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  );

ALTER TABLE "WorkCalendar"
  ADD CONSTRAINT "WorkCalendar_singleton"
  CHECK ("id" = 1);

CREATE INDEX "Activity_fulltext_idx"
  ON "Activity"
  USING GIN (to_tsvector('turkish', "title" || ' ' || "description"));
