-- Katkı kümesi mühürden **sonra** kapanır (denetim 25.08.2026, P8-R2-1).
--
-- İlk hâlde katkı tetikleyicisi dönemin `frozen = true` olmasını yazma izni
-- sayıyordu; UPDATE ve DELETE mühürlü olsa da INSERT açıktı. Sonuç: kapanış
-- bittikten günler sonra aynı döneme yeni `WRITTEN`/`ACCEPTED`/`DECISION`/
-- `OBLIGATION` satırı eklenebiliyordu. Başkasının kapanmış trendi katkılardan
-- yeniden hesaplandığı için tek bir satır tarihsel personel karnesini
-- değiştirebilir.
--
-- Değişmez olması gereken şey satır değil **kümenin kendisi**. Kapanış artık
-- durum geçişli: taslak dönem (`frozen = false`) açılır, katkılar yalnız
-- taslağa yazılır, son adımda mühür iner. Yön bu yüzden ters çevriliyor.

CREATE OR REPLACE FUNCTION score_fact_requires_frozen_period() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  donuk BOOLEAN;
BEGIN
  SELECT "frozen" INTO donuk
  FROM "UserScorePeriod"
  WHERE "userId" = NEW."userId" AND "periodStart" = NEW."periodStart";

  IF donuk IS NULL THEN
    RAISE EXCEPTION 'SCORE_FACT_PERIOD_MISSING: katkının dönemi yok'
      USING ERRCODE = '23514';
  END IF;

  IF donuk THEN
    RAISE EXCEPTION
      'SCORE_FACT_PERIOD_FROZEN: dondurulmuş döneme katkı eklenemez'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- `computedAt` de mühürün parçası: hesabın ne zaman yapıldığı da kanıtın
-- parçasıdır ve sonradan değiştirilememeli.
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
    OR NEW."computedAt" IS DISTINCT FROM OLD."computedAt"
  THEN
    RAISE EXCEPTION
      'FROZEN_PERIOD_IMMUTABLE: dondurulmuş skor dönemi değiştirilemez'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
