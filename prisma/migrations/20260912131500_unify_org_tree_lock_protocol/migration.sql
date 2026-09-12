-- All database guards that protect organization-tree state must use the same
-- advisory-lock protocol as application-level scope checks.

CREATE OR REPLACE FUNCTION org_unit_tree_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  ancestor_id TEXT;
  depth_from_root INT := 1;
  subtree_height INT;
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

  IF OLD."isActive" AND NOT NEW."isActive" THEN
    IF EXISTS (
      SELECT 1 FROM "User" WHERE "orgUnitId" = NEW."id" AND "isActive"
    ) THEN
      RAISE EXCEPTION 'ORG_UNIT_HAS_ACTIVE_USERS: a unit with active users cannot be deactivated';
    END IF;

    IF EXISTS (
      SELECT 1 FROM "OrgUnit" WHERE "parentId" = NEW."id" AND "isActive"
    ) THEN
      RAISE EXCEPTION 'ORG_UNIT_HAS_ACTIVE_CHILDREN: a unit with active child units cannot be deactivated';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION org_unit_active_parent_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('activity:org_tree'));

  IF NEW."isActive" AND NEW."parentId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "OrgUnit" WHERE "id" = NEW."parentId" AND "isActive"
  ) THEN
    RAISE EXCEPTION 'ORG_UNIT_INACTIVE_PARENT: an active unit cannot be under an inactive parent';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION conversation_active_parties_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('activity:org_tree'));

  IF NEW."status" = 'OPEN' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "User" WHERE "id" = NEW."askerId" AND "isActive"
    ) THEN
      RAISE EXCEPTION 'CONVERSATION_INACTIVE_ASKER: an inactive user cannot ask a question';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM "User" WHERE "id" = NEW."responsibleId" AND "isActive"
    ) THEN
      RAISE EXCEPTION 'CONVERSATION_INACTIVE_RESPONSIBLE: an inactive user cannot be responsible for a conversation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

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
