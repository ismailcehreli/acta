-- P8-R3-1..4: değişmez skor sürümleri, yeniden hesaplama kuyruğu ve
-- etkili-tarih geçmişi. Migration elle yazıldı ve aşağıdaki reddetme
-- testleriyle sınanır; Prisma'nın başka tabloları yeniden yaratmasına izin
-- verilmez.

-- -------------------------------------------------------------------------
-- 1. Aynı kullanıcı-ay için birden çok değişmez sürüm
-- -------------------------------------------------------------------------

ALTER TABLE "UserScorePeriodFact"
  DROP CONSTRAINT "UserScorePeriodFact_userId_periodStart_fkey";

ALTER TABLE "UserScorePeriod"
  ADD COLUMN "revisionNo" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revisionReason" VARCHAR(60) NOT NULL DEFAULT 'INITIAL',
  ADD COLUMN "sourceRequestId" TEXT,
  ADD COLUMN "voided" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "UserScorePeriodFact"
  ADD COLUMN "revisionNo" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "UserScorePeriod" DROP CONSTRAINT "UserScorePeriod_pkey";
ALTER TABLE "UserScorePeriod"
  ADD CONSTRAINT "UserScorePeriod_pkey"
  PRIMARY KEY ("userId", "periodStart", "revisionNo");

ALTER TABLE "UserScorePeriod"
  ADD CONSTRAINT "UserScorePeriod_revision_positive"
  CHECK ("revisionNo" >= 1),
  ADD CONSTRAINT "UserScorePeriod_voided_frozen"
  CHECK (NOT "voided" OR "frozen");

CREATE UNIQUE INDEX "UserScorePeriod_sourceRequestId_key"
  ON "UserScorePeriod"("sourceRequestId");
CREATE INDEX "UserScorePeriod_periodStart_revisionNo_idx"
  ON "UserScorePeriod"("periodStart", "revisionNo");
CREATE INDEX "UserScorePeriod_userId_periodStart_frozen_revisionNo_idx"
  ON "UserScorePeriod"("userId", "periodStart", "frozen", "revisionNo");
DROP INDEX IF EXISTS "UserScorePeriod_periodStart_idx";

ALTER TABLE "UserScorePeriodFact"
  ADD CONSTRAINT "UserScorePeriodFact_userId_periodStart_revisionNo_fkey"
  FOREIGN KEY ("userId", "periodStart", "revisionNo")
  REFERENCES "UserScorePeriod"("userId", "periodStart", "revisionNo")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

DROP INDEX IF EXISTS "UserScorePeriodFact_userId_periodStart_idx";
CREATE INDEX "UserScorePeriodFact_userId_periodStart_revisionNo_idx"
  ON "UserScorePeriodFact"("userId", "periodStart", "revisionNo");

-- Katkı hangi kesin sürüme yazılıyor sorusu artık üç alanlıdır.
CREATE OR REPLACE FUNCTION score_fact_requires_frozen_period() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  donuk BOOLEAN;
BEGIN
  SELECT "frozen" INTO donuk
  FROM "UserScorePeriod"
  WHERE "userId" = NEW."userId"
    AND "periodStart" = NEW."periodStart"
    AND "revisionNo" = NEW."revisionNo";

  IF donuk IS NULL THEN
    RAISE EXCEPTION 'SCORE_FACT_PERIOD_MISSING: katkının sürümü yok'
      USING ERRCODE = '23514';
  END IF;

  IF donuk THEN
    RAISE EXCEPTION
      'SCORE_FACT_PERIOD_FROZEN: dondurulmuş sürüme katkı eklenemez'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

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

-- -------------------------------------------------------------------------
-- 2. İdempotent yeniden hesaplama istekleri
-- -------------------------------------------------------------------------

CREATE TABLE "ScoreRecalculationRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "sourceType" VARCHAR(60) NOT NULL,
  "sourceId" VARCHAR(150) NOT NULL,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  CONSTRAINT "ScoreRecalculationRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScoreRecalculationRequest_attempts_nonnegative" CHECK ("attempts" >= 0),
  CONSTRAINT "ScoreRecalculationRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "ScoreRecalculationRequest_userId_periodStart_sourceType_sourceId_key"
  ON "ScoreRecalculationRequest"("userId", "periodStart", "sourceType", "sourceId");
CREATE INDEX "ScoreRecalculationRequest_processedAt_requestedAt_idx"
  ON "ScoreRecalculationRequest"("processedAt", "requestedAt");
CREATE INDEX "ScoreRecalculationRequest_userId_periodStart_processedAt_idx"
  ON "ScoreRecalculationRequest"("userId", "periodStart", "processedAt");

ALTER TABLE "UserScorePeriod"
  ADD CONSTRAINT "UserScorePeriod_sourceRequestId_fkey"
  FOREIGN KEY ("sourceRequestId") REFERENCES "ScoreRecalculationRequest"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "ScoreHistoryControl" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "historyStart" DATE NOT NULL,
  "initializedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScoreHistoryControl_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScoreHistoryControl_singleton" CHECK ("id" = 1)
);

-- İlk tahminsiz tam ay, migrationın çalıştığı ayı izleyen aydır. Tarihi SQL'e
-- sabitlemek gecikmiş bir dağıtımda CUTOVER olayından önceki ayları varmış
-- gibi kapatırdı.
INSERT INTO "ScoreHistoryControl" ("id", "historyStart")
VALUES (1, (date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month')::date);

CREATE TABLE "ScorePeriodLedger" (
  "periodStart" DATE NOT NULL,
  "closedAt" TIMESTAMPTZ(3) NOT NULL,
  "retroactiveDays" INTEGER NOT NULL,
  "formulaVersion" INTEGER NOT NULL,
  CONSTRAINT "ScorePeriodLedger_pkey" PRIMARY KEY ("periodStart"),
  CONSTRAINT "ScorePeriodLedger_retroactive_nonnegative"
    CHECK ("retroactiveDays" >= 0),
  CONSTRAINT "ScorePeriodLedger_formula_positive"
    CHECK ("formulaVersion" >= 1)
);

-- -------------------------------------------------------------------------
-- 3. Append-only etkili-tarih olayları
-- -------------------------------------------------------------------------

CREATE TABLE "ScoreUserStateEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isActive" BOOLEAN NOT NULL,
  "isScored" BOOLEAN NOT NULL,
  "writesActivities" BOOLEAN NOT NULL,
  "isUnitManager" BOOLEAN NOT NULL,
  "orgUnitId" TEXT NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "actorId" TEXT,
  CONSTRAINT "ScoreUserStateEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScoreUserStateEvent_userId_effectiveAt_recordedAt_idx"
  ON "ScoreUserStateEvent"("userId", "effectiveAt", "recordedAt");
CREATE INDEX "ScoreUserStateEvent_orgUnitId_effectiveAt_idx"
  ON "ScoreUserStateEvent"("orgUnitId", "effectiveAt");

CREATE TABLE "ScoreOrgUnitStateEvent" (
  "id" TEXT NOT NULL,
  "orgUnitId" TEXT NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "parentId" TEXT,
  "isActive" BOOLEAN NOT NULL,
  "requiresApproval" BOOLEAN NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "actorId" TEXT,
  CONSTRAINT "ScoreOrgUnitStateEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScoreOrgUnitStateEvent_orgUnitId_effectiveAt_recordedAt_idx"
  ON "ScoreOrgUnitStateEvent"("orgUnitId", "effectiveAt", "recordedAt");

CREATE TABLE "ScoreCompanyCalendarEvent" (
  "id" TEXT NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "workingDays" INTEGER[] NOT NULL,
  "workStartMinute" INTEGER NOT NULL,
  "workEndMinute" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "actorId" TEXT,
  CONSTRAINT "ScoreCompanyCalendarEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScoreCompanyCalendarEvent_effectiveAt_recordedAt_idx"
  ON "ScoreCompanyCalendarEvent"("effectiveAt", "recordedAt");

CREATE TABLE "ScoreUnitCalendarEvent" (
  "id" TEXT NOT NULL,
  "orgUnitId" TEXT NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hasOwnCalendar" BOOLEAN NOT NULL,
  "workingDays" INTEGER[] NOT NULL,
  "workStartMinute" INTEGER NOT NULL,
  "workEndMinute" INTEGER NOT NULL,
  "worksOnHolidays" BOOLEAN NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "actorId" TEXT,
  CONSTRAINT "ScoreUnitCalendarEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScoreUnitCalendarEvent_orgUnitId_effectiveAt_recordedAt_idx"
  ON "ScoreUnitCalendarEvent"("orgUnitId", "effectiveAt", "recordedAt");

CREATE TABLE "ScoreHolidayEvent" (
  "id" TEXT NOT NULL,
  "holidayDate" DATE NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isHoliday" BOOLEAN NOT NULL,
  "description" VARCHAR(150),
  "reason" VARCHAR(500) NOT NULL,
  "actorId" TEXT,
  CONSTRAINT "ScoreHolidayEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScoreHolidayEvent_holidayDate_effectiveAt_recordedAt_idx"
  ON "ScoreHolidayEvent"("holidayDate", "effectiveAt", "recordedAt");

CREATE TABLE "ScoreSettingEvent" (
  "id" TEXT NOT NULL,
  "key" VARCHAR(100) NOT NULL,
  "value" VARCHAR(500) NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" VARCHAR(500) NOT NULL,
  "actorId" TEXT,
  CONSTRAINT "ScoreSettingEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScoreSettingEvent_key_effectiveAt_recordedAt_idx"
  ON "ScoreSettingEvent"("key", "effectiveAt", "recordedAt");

-- Normal yazma yolları tarihçeyi unutamaz: skoru etkileyen ana tabloların
-- değişiklikleri aynı transaction içinde tam durum olayı doğurur. Tarihsel
-- düzeltme servisi `app.score_effective_at`, `app.score_reason` ve
-- `app.score_actor_id` yerel transaction ayarlarını vererek etkili tarihi ve
-- gerekçeyi açıkça taşır.
CREATE OR REPLACE FUNCTION score_effective_at(fallback TIMESTAMPTZ)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.score_effective_at', true), '')::timestamptz,
    fallback
  )
$$;

CREATE OR REPLACE FUNCTION score_change_reason()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.score_reason', true), ''),
    'CURRENT_STATE_CHANGE'
  )
$$;

CREATE OR REPLACE FUNCTION score_change_actor()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.score_actor_id', true), '')
$$;

CREATE OR REPLACE FUNCTION capture_score_user_state() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  etki TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW."isActive" IS NOT DISTINCT FROM OLD."isActive"
    AND NEW."isScored" IS NOT DISTINCT FROM OLD."isScored"
    AND NEW."writesActivities" IS NOT DISTINCT FROM OLD."writesActivities"
    AND NEW."isUnitManager" IS NOT DISTINCT FROM OLD."isUnitManager"
    AND NEW."orgUnitId" IS NOT DISTINCT FROM OLD."orgUnitId"
  THEN
    RETURN NEW;
  END IF;

  etki := score_effective_at(
    CASE WHEN TG_OP = 'INSERT' THEN NEW."createdAt" ELSE CURRENT_TIMESTAMP END
  );
  INSERT INTO "ScoreUserStateEvent" (
    "id", "userId", "effectiveAt", "isActive", "isScored",
    "writesActivities", "isUnitManager", "orgUnitId", "reason", "actorId"
  ) VALUES (
    gen_random_uuid(), NEW."id", etki, NEW."isActive", NEW."isScored",
    NEW."writesActivities", NEW."isUnitManager", NEW."orgUnitId",
    score_change_reason(), score_change_actor()
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER "User_score_state_history"
  AFTER INSERT OR UPDATE OF "isActive", "isScored", "writesActivities",
    "isUnitManager", "orgUnitId" ON "User"
  FOR EACH ROW EXECUTE FUNCTION capture_score_user_state();

CREATE OR REPLACE FUNCTION capture_score_org_unit_state() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW."parentId" IS NOT DISTINCT FROM OLD."parentId"
    AND NEW."isActive" IS NOT DISTINCT FROM OLD."isActive"
    AND NEW."requiresApproval" IS NOT DISTINCT FROM OLD."requiresApproval"
  THEN
    RETURN NEW;
  END IF;

  INSERT INTO "ScoreOrgUnitStateEvent" (
    "id", "orgUnitId", "effectiveAt", "parentId", "isActive",
    "requiresApproval", "reason", "actorId"
  ) VALUES (
    gen_random_uuid(), NEW."id", score_effective_at(CURRENT_TIMESTAMP),
    NEW."parentId", NEW."isActive", NEW."requiresApproval",
    score_change_reason(), score_change_actor()
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER "OrgUnit_score_state_history"
  AFTER INSERT OR UPDATE OF "parentId", "isActive", "requiresApproval"
  ON "OrgUnit" FOR EACH ROW EXECUTE FUNCTION capture_score_org_unit_state();

CREATE OR REPLACE FUNCTION capture_score_company_calendar() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW."workingDays" IS NOT DISTINCT FROM OLD."workingDays"
    AND NEW."workStartMinute" IS NOT DISTINCT FROM OLD."workStartMinute"
    AND NEW."workEndMinute" IS NOT DISTINCT FROM OLD."workEndMinute"
  THEN
    RETURN NEW;
  END IF;

  INSERT INTO "ScoreCompanyCalendarEvent" (
    "id", "effectiveAt", "workingDays", "workStartMinute", "workEndMinute",
    "reason", "actorId"
  ) VALUES (
    gen_random_uuid(), score_effective_at(CURRENT_TIMESTAMP), NEW."workingDays",
    NEW."workStartMinute", NEW."workEndMinute", score_change_reason(),
    score_change_actor()
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER "WorkCalendar_score_history"
  AFTER INSERT OR UPDATE OF "workingDays", "workStartMinute", "workEndMinute"
  ON "WorkCalendar" FOR EACH ROW EXECUTE FUNCTION capture_score_company_calendar();

CREATE OR REPLACE FUNCTION capture_score_unit_calendar() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  satir "OrgUnitWorkCalendar"%ROWTYPE;
  var_mi BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW."workingDays" IS NOT DISTINCT FROM OLD."workingDays"
    AND NEW."workStartMinute" IS NOT DISTINCT FROM OLD."workStartMinute"
    AND NEW."workEndMinute" IS NOT DISTINCT FROM OLD."workEndMinute"
    AND NEW."worksOnHolidays" IS NOT DISTINCT FROM OLD."worksOnHolidays"
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    satir := OLD;
    var_mi := FALSE;
  ELSE
    satir := NEW;
    var_mi := TRUE;
  END IF;

  INSERT INTO "ScoreUnitCalendarEvent" (
    "id", "orgUnitId", "effectiveAt", "hasOwnCalendar", "workingDays",
    "workStartMinute", "workEndMinute", "worksOnHolidays", "reason", "actorId"
  ) VALUES (
    gen_random_uuid(), satir."orgUnitId", score_effective_at(CURRENT_TIMESTAMP),
    var_mi, satir."workingDays", satir."workStartMinute", satir."workEndMinute",
    satir."worksOnHolidays", score_change_reason(), score_change_actor()
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER "OrgUnitWorkCalendar_score_history"
  AFTER INSERT OR UPDATE OR DELETE ON "OrgUnitWorkCalendar"
  FOR EACH ROW EXECUTE FUNCTION capture_score_unit_calendar();

CREATE OR REPLACE FUNCTION capture_score_holiday() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  satir "Holiday"%ROWTYPE;
BEGIN
  satir := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  INSERT INTO "ScoreHolidayEvent" (
    "id", "holidayDate", "effectiveAt", "isHoliday", "description",
    "reason", "actorId"
  ) VALUES (
    gen_random_uuid(), satir."date", score_effective_at(CURRENT_TIMESTAMP),
    TG_OP <> 'DELETE', satir."description", score_change_reason(),
    score_change_actor()
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER "Holiday_score_history"
  AFTER INSERT OR UPDATE OR DELETE ON "Holiday"
  FOR EACH ROW EXECUTE FUNCTION capture_score_holiday();

CREATE OR REPLACE FUNCTION capture_score_setting() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."key" NOT IN (
    'retroactive_entry_days', 'scoring_weight_regularity',
    'scoring_weight_acceptance', 'scoring_weight_approval',
    'scoring_weight_follow_up', 'pending_approval_business_days',
    'overdue_answer_business_days', 'follow_up_stale_business_days'
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
CREATE TRIGGER "SystemSetting_score_history"
  AFTER INSERT OR UPDATE OF "value" ON "SystemSetting"
  FOR EACH ROW EXECUTE FUNCTION capture_score_setting();

-- Mevcut üretim durumunun kesim anındaki başlangıç görüntüsü. Kesim Eylül
-- olduğu için bu satırlar Ağustos'a geriye uygulanmaz.
INSERT INTO "ScoreUserStateEvent" (
  "id", "userId", "effectiveAt", "isActive", "isScored",
  "writesActivities", "isUnitManager", "orgUnitId", "reason"
)
SELECT gen_random_uuid(), "id", CURRENT_TIMESTAMP, "isActive", "isScored",
       "writesActivities", "isUnitManager", "orgUnitId", 'CUTOVER'
  FROM "User";

INSERT INTO "ScoreOrgUnitStateEvent" (
  "id", "orgUnitId", "effectiveAt", "parentId", "isActive",
  "requiresApproval", "reason"
)
SELECT gen_random_uuid(), "id", CURRENT_TIMESTAMP, "parentId", "isActive",
       "requiresApproval", 'CUTOVER'
  FROM "OrgUnit";

INSERT INTO "ScoreCompanyCalendarEvent" (
  "id", "effectiveAt", "workingDays", "workStartMinute", "workEndMinute",
  "reason"
)
SELECT gen_random_uuid(), CURRENT_TIMESTAMP, "workingDays", "workStartMinute",
       "workEndMinute", 'CUTOVER'
  FROM "WorkCalendar";

INSERT INTO "ScoreUnitCalendarEvent" (
  "id", "orgUnitId", "effectiveAt", "hasOwnCalendar", "workingDays",
  "workStartMinute", "workEndMinute", "worksOnHolidays", "reason"
)
SELECT gen_random_uuid(), "orgUnitId", CURRENT_TIMESTAMP, TRUE, "workingDays",
       "workStartMinute", "workEndMinute", "worksOnHolidays", 'CUTOVER'
  FROM "OrgUnitWorkCalendar";

INSERT INTO "ScoreHolidayEvent" (
  "id", "holidayDate", "effectiveAt", "isHoliday", "description", "reason"
)
SELECT gen_random_uuid(), "date", CURRENT_TIMESTAMP, TRUE, "description", 'CUTOVER'
  FROM "Holiday";

INSERT INTO "ScoreSettingEvent" (
  "id", "key", "value", "effectiveAt", "reason"
)
SELECT gen_random_uuid(), "key", "value", CURRENT_TIMESTAMP, 'CUTOVER'
  FROM "SystemSetting"
 WHERE "key" IN (
   'retroactive_entry_days', 'scoring_weight_regularity',
   'scoring_weight_acceptance', 'scoring_weight_approval',
   'scoring_weight_follow_up', 'pending_approval_business_days',
   'overdue_answer_business_days', 'follow_up_stale_business_days'
 );

CREATE OR REPLACE FUNCTION forbid_score_history_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.demo_purge', true) = 'evet' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'SCORE_HISTORY_IMMUTABLE: skor tarihçesi değiştirilemez'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "ScoreUserStateEvent_immutable"
  BEFORE UPDATE OR DELETE ON "ScoreUserStateEvent"
  FOR EACH ROW EXECUTE FUNCTION forbid_score_history_change();
CREATE TRIGGER "ScoreOrgUnitStateEvent_immutable"
  BEFORE UPDATE OR DELETE ON "ScoreOrgUnitStateEvent"
  FOR EACH ROW EXECUTE FUNCTION forbid_score_history_change();
CREATE TRIGGER "ScoreCompanyCalendarEvent_immutable"
  BEFORE UPDATE OR DELETE ON "ScoreCompanyCalendarEvent"
  FOR EACH ROW EXECUTE FUNCTION forbid_score_history_change();
CREATE TRIGGER "ScoreUnitCalendarEvent_immutable"
  BEFORE UPDATE OR DELETE ON "ScoreUnitCalendarEvent"
  FOR EACH ROW EXECUTE FUNCTION forbid_score_history_change();
CREATE TRIGGER "ScoreHolidayEvent_immutable"
  BEFORE UPDATE OR DELETE ON "ScoreHolidayEvent"
  FOR EACH ROW EXECUTE FUNCTION forbid_score_history_change();
CREATE TRIGGER "ScoreSettingEvent_immutable"
  BEFORE UPDATE OR DELETE ON "ScoreSettingEvent"
  FOR EACH ROW EXECUTE FUNCTION forbid_score_history_change();
