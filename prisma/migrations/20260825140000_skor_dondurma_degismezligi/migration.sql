-- Dondurulmuş dönem ve katkılar **veritabanı katmanında** değişmez
-- (denetim 25.08.2026, P8-4).
--
-- İlk hâlde yalnız `UserScorePeriod_frozen_formula` vardı ve o kısıt
-- kolonların birlikte dolu/boş olmasını zorluyordu. Donmuş satır **tek
-- güncellemede** `frozen = false` ve profil/ağırlıklar `NULL` yapıldığında
-- kısıt geçiyordu; bağlı katkı satırları yerinde kalıyordu. Katkı
-- tetikleyicisi de yalnız yazma anında dönemin donmuş olmasına bakıyor,
-- katkının **içerik güncellemesini** engellemiyor ve DELETE için hiç
-- çalışmıyordu.
--
-- Yani kapanmış skorun kanıtı bir bakım betiği ya da doğrudan SQL ile
-- sessizce yeniden yazılabiliyordu. Bu paketin bütün amacı "dönem sonu
-- gerçeği değişmez" olduğu için kural veritabanında da durmalı.
--
-- Örnek veri temizliğinin dar kapısı (`app.demo_purge = 'evet'`) korunuyor:
-- sistem yöneticisinin belgelenmiş "örnek veriyi bütünüyle kaldır" işlemi
-- çalışmaya devam etmeli.

-- ── Dönem satırı ─────────────────────────────────────────────────────────
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

  -- Donmamış satır serbest; donduktan sonra her şey mühürlenir.
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
  THEN
    RAISE EXCEPTION
      'FROZEN_PERIOD_IMMUTABLE: dondurulmuş skor dönemi değiştirilemez'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "UserScorePeriod_frozen_immutable"
  BEFORE UPDATE OR DELETE ON "UserScorePeriod"
  FOR EACH ROW EXECUTE FUNCTION forbid_frozen_period_change();

-- ── Katkı satırı ─────────────────────────────────────────────────────────
--
-- Katkı bir olgudur: yazıldıktan sonra ne içeriği değişir ne de silinir.
CREATE OR REPLACE FUNCTION forbid_score_fact_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.demo_purge', true) = 'evet' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION
    'SCORE_FACT_IMMUTABLE: skor katkısı değiştirilemez ve silinemez'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "UserScorePeriodFact_immutable"
  BEFORE UPDATE OR DELETE ON "UserScorePeriodFact"
  FOR EACH ROW EXECUTE FUNCTION forbid_score_fact_change();
