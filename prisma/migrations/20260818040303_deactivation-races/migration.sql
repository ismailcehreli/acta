
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
    RAISE EXCEPTION 'ORG_UNIT_INACTIVE_PARENT: an active unit cannot be placed under an inactive parent';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "OrgUnit_active_parent_guard"
  BEFORE INSERT OR UPDATE OF "parentId", "isActive" ON "OrgUnit"
  FOR EACH ROW EXECUTE FUNCTION org_unit_active_parent_guard();

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

CREATE TRIGGER "Conversation_active_parties_guard"
  BEFORE INSERT OR UPDATE OF "askerId", "responsibleId", "status" ON "Conversation"
  FOR EACH ROW EXECUTE FUNCTION conversation_active_parties_guard();

CREATE OR REPLACE FUNCTION user_deactivation_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('activity:org_tree'));

  IF OLD."isActive" AND NOT NEW."isActive" AND EXISTS (
    SELECT 1 FROM "Conversation"
    WHERE "status" = 'OPEN'
      AND ("askerId" = NEW."id" OR "responsibleId" = NEW."id")
  ) THEN
    RAISE EXCEPTION 'USER_HAS_OPEN_CONVERSATIONS: a user with open conversations cannot be deactivated';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_deactivation_guard"
  BEFORE UPDATE OF "isActive" ON "User"
  FOR EACH ROW EXECUTE FUNCTION user_deactivation_guard();
