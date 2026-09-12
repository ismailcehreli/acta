
CREATE OR REPLACE FUNCTION score_fact_requires_frozen_period() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  is_frozen BOOLEAN;
BEGIN
  SELECT "frozen" INTO is_frozen
  FROM "UserScorePeriod"
  WHERE "userId" = NEW."userId" AND "periodStart" = NEW."periodStart";

  IF is_frozen IS NULL THEN
    RAISE EXCEPTION 'SCORE_FACT_PERIOD_MISSING: the score fact has no period'
      USING ERRCODE = '23514';
  END IF;

  IF is_frozen THEN
    RAISE EXCEPTION
      'SCORE_FACT_PERIOD_FROZEN: a score fact cannot be added to a frozen period'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION forbid_frozen_period_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.demo_purge', true) = 'yes' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'FROZEN_PERIOD_IMMUTABLE: a frozen score period cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF NOT OLD."frozen" THEN
    RETURN NEW;
  END IF;

  IF NEW."frozen" IS DISTINCT FROM OLD."frozen"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart"
    OR NEW."expectedDays" IS DISTINCT FROM OLD."expectedDays"
    OR NEW."writtenDays" IS DISTINCT FROM OLD."writtenDays"
    OR NEW."regularity" IS DISTINCT FROM OLD."regularity"
    OR NEW."acceptance" IS DISTINCT FROM OLD."acceptance"
    OR NEW."approval" IS DISTINCT FROM OLD."approval"
    OR NEW."followUp" IS DISTINCT FROM OLD."followUp"
    OR NEW."total" IS DISTINCT FROM OLD."total"
    OR NEW."profile" IS DISTINCT FROM OLD."profile"
    OR NEW."weightRegularity" IS DISTINCT FROM OLD."weightRegularity"
    OR NEW."weightAcceptance" IS DISTINCT FROM OLD."weightAcceptance"
    OR NEW."weightApproval" IS DISTINCT FROM OLD."weightApproval"
    OR NEW."weightFollowUp" IS DISTINCT FROM OLD."weightFollowUp"
    OR NEW."formulaVersion" IS DISTINCT FROM OLD."formulaVersion"
    OR NEW."computedAt" IS DISTINCT FROM OLD."computedAt"
  THEN
    RAISE EXCEPTION
      'FROZEN_PERIOD_IMMUTABLE: a frozen score period cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
