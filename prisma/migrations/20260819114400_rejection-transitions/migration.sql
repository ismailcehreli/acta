
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
          AND NEW."approvalStatus" IN ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'MANAGER_NOT_FOUND'))
    OR (OLD."approvalStatus" = 'CHANGES_REQUESTED'
          AND NEW."approvalStatus" IN ('PENDING_APPROVAL', 'REJECTED', 'MANAGER_NOT_FOUND'))
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
