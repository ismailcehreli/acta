-- Takdir katkısının dönemsel skora eklenmesi.

ALTER TYPE "ScoreFactKind" ADD VALUE 'APPRECIATION';

ALTER TABLE "UserScorePeriod"
  ADD COLUMN "appreciationPointsPer" INTEGER NOT NULL DEFAULT 0;

-- Temel bölümler 0–100 aralığında kalır; takdir katkısı genel toplamı
-- 100'ün üzerine çıkarabilir.
ALTER TABLE "UserScorePeriod"
  DROP CONSTRAINT "UserScorePeriod_valid_scores";

ALTER TABLE "UserScorePeriod"
  ADD CONSTRAINT "UserScorePeriod_valid_scores"
  CHECK (
    "regularity" BETWEEN 0 AND 100
    AND ("acceptance" IS NULL OR "acceptance" BETWEEN 0 AND 100)
    AND ("approval" IS NULL OR "approval" BETWEEN 0 AND 100)
    AND "followUp" BETWEEN 0 AND 100
    AND "total" >= 0
    AND "appreciationPointsPer" >= 0
  );

CREATE OR REPLACE FUNCTION forbid_frozen_period_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.demo_purge', true) = 'evet' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'FROZEN_PERIOD_IMMUTABLE: dondurulmuş skor sürümü silinemez'
      USING ERRCODE = '23514';
  END IF;

  IF NOT OLD."frozen" THEN
    RETURN NEW;
  END IF;

  IF NEW."frozen" IS DISTINCT FROM OLD."frozen"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart"
    OR NEW."revisionNo" IS DISTINCT FROM OLD."revisionNo"
    OR NEW."revisionReason" IS DISTINCT FROM OLD."revisionReason"
    OR NEW."sourceRequestId" IS DISTINCT FROM OLD."sourceRequestId"
    OR NEW."voided" IS DISTINCT FROM OLD."voided"
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
    OR NEW."appreciationPointsPer" IS DISTINCT FROM OLD."appreciationPointsPer"
    OR NEW."formulaVersion" IS DISTINCT FROM OLD."formulaVersion"
    OR NEW."computedAt" IS DISTINCT FROM OLD."computedAt"
  THEN
    RAISE EXCEPTION
      'FROZEN_PERIOD_IMMUTABLE: dondurulmuş skor sürümü değiştirilemez'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Yeni parametre de geçmiş skor ayarları gibi etkili-tarih geçmişine girer.
CREATE OR REPLACE FUNCTION capture_score_setting() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."key" NOT IN (
    'retroactive_entry_days', 'scoring_weight_regularity',
    'scoring_weight_acceptance', 'scoring_weight_approval',
    'scoring_weight_follow_up', 'scoring_appreciation_points',
    'pending_approval_business_days', 'overdue_answer_business_days',
    'follow_up_stale_business_days'
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."value" IS NOT DISTINCT FROM OLD."value" THEN
    RETURN NEW;
  END IF;

  INSERT INTO "ScoreSettingEvent" (
    "id", "key", "value", "effectiveAt", "reason", "actorId"
  ) VALUES (
    gen_random_uuid(), NEW."key", NEW."value",
    score_effective_at(CURRENT_TIMESTAMP), score_change_reason(),
    score_change_actor()
  );
  RETURN NEW;
END;
$$;
