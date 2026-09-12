
ALTER TABLE "ApprovalRound" ADD CONSTRAINT "ApprovalRound_valid_decision" CHECK (
  "decision" IS NULL
  OR "decision" IN ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED')
);

CREATE TRIGGER "ApprovalRound_no_delete" BEFORE DELETE ON "ApprovalRound"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE OR REPLACE FUNCTION approval_round_immutability() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."decidedAt" IS NOT NULL THEN
    RAISE EXCEPTION
      'APPROVAL_ROUND_IMMUTABLE: a decided round cannot be changed (%)', OLD."id";
  END IF;

  IF NEW."id" <> OLD."id"
     OR NEW."activityId" <> OLD."activityId"
     OR NEW."roundNo" <> OLD."roundNo"
     OR NEW."submittedAt" <> OLD."submittedAt" THEN
    RAISE EXCEPTION
      'APPROVAL_ROUND_IMMUTABLE: the round identity and submission time cannot be changed (%)', OLD."id";
  END IF;

  IF NEW."decidedAt" IS NULL THEN
    RAISE EXCEPTION
      'APPROVAL_ROUND_IMMUTABLE: an open round can only be updated by recording a decision (%)', OLD."id";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ApprovalRound_immutability_guard"
  BEFORE UPDATE ON "ApprovalRound"
  FOR EACH ROW EXECUTE FUNCTION approval_round_immutability();
