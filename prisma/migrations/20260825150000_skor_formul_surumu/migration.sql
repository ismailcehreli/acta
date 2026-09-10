-- Dönem, kapandığı **formül sürümünü** taşır (denetim 25.08.2026, P8-5).
--
-- Ağırlıklar donduruluyordu ama algoritma değil. Yuvarlama, boş payda
-- davranışı, boyut tanımı ya da profil eşlemesi ileride değişirse kişinin
-- kendi gördüğü saklanmış `total` aynı kalır, yöneticisinin gördüğü aynı dönem
-- ise yeni algoritmayla hesaplanıp değişirdi — paketin bütün amacı buydu.

ALTER TABLE "UserScorePeriod" ADD COLUMN "formulaVersion" INTEGER;

-- **Mevcut donmuş dönemler geriye doldurulur.** Onlar zaten V1 koduyla
-- kapandı; sürümü 1 yazmak bir varsayım değil, olanın kaydı.
--
-- Değişmezlik tetikleyicisi bu güncellemeyi reddederdi (dondurulmuş satır
-- değiştirilemez). Şema geçişi mührün konduğu yer olduğu için tetikleyici
-- yalnız bu işlem boyunca devre dışı bırakılıyor.
ALTER TABLE "UserScorePeriod" DISABLE TRIGGER "UserScorePeriod_frozen_immutable";

UPDATE "UserScorePeriod"
   SET "formulaVersion" = 1
 WHERE "frozen" AND "formulaVersion" IS NULL;

ALTER TABLE "UserScorePeriod" ENABLE TRIGGER "UserScorePeriod_frozen_immutable";

-- Mühür `frozen_formula` kısıtına ekleniyor: dondurulmuş dönem sürümünü de
-- taşımak zorunda, dondurulmamış dönem taşımamalı.
ALTER TABLE "UserScorePeriod" DROP CONSTRAINT "UserScorePeriod_frozen_formula";

ALTER TABLE "UserScorePeriod"
  ADD CONSTRAINT "UserScorePeriod_frozen_formula" CHECK (
    (
      NOT "frozen"
      AND "profile" IS NULL
      AND "weightRegularity" IS NULL
      AND "weightAcceptance" IS NULL
      AND "weightApproval" IS NULL
      AND "weightFollowUp" IS NULL
      AND "formulaVersion" IS NULL
    )
    OR (
      "frozen"
      AND "profile" IS NOT NULL
      AND "weightRegularity" IS NOT NULL
      AND "weightAcceptance" IS NOT NULL
      AND "weightApproval" IS NOT NULL
      AND "weightFollowUp" IS NOT NULL
      AND "formulaVersion" IS NOT NULL
    )
  );

-- Sürüm de mühürlü: donduktan sonra değiştirilemez.
CREATE OR REPLACE FUNCTION forbid_frozen_period_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.demo_purge', true) = 'evet' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'FROZEN_PERIOD_IMMUTABLE: dondurulmuş skor dönemi silinemez'
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
  THEN
    RAISE EXCEPTION
      'FROZEN_PERIOD_IMMUTABLE: dondurulmuş skor dönemi değiştirilemez'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
