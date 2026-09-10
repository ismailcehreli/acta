-- Onay turu gerçekten **değişmez** (denetim 23.08.2026, P3-R3-1).
--
-- Tablo "değişmez geçmiş" diye tanımlanmıştı ama veritabanı bunu zorlamıyordu:
-- açık tur silinebiliyor, karara bağlanmış tur yeniden yazılabiliyor ve
-- `decision` alanı gerçek karar olmayan durumları (`CANCELLED`,
-- `MANAGER_NOT_FOUND`) kabul ediyordu. Onay süresi skorunun tek kanıtı bu
-- tablo olduğu için bir bakım betiği ya da yeni bir yazma yolu geçmişi
-- sessizce yeniden yazabilirdi.

-- ---------------------------------------------------------------------------
-- 1. Karar kümesi dar
-- ---------------------------------------------------------------------------
-- Tur yalnız üç kararla kapanır. İptal bir onay kararı değildir: kaydı yazan
-- ya da üst zincir iptal eder ve onay kuyruğu o anda zaten boştur.
ALTER TABLE "ApprovalRound" ADD CONSTRAINT "ApprovalRound_gecerli_karar" CHECK (
  "decision" IS NULL
  OR "decision" IN ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED')
);

-- ---------------------------------------------------------------------------
-- 2. Silinemez (§16.6)
-- ---------------------------------------------------------------------------
-- Mevcut `forbid_physical_delete` kullanılıyor: örnek veri temizliğinin dar
-- kapısı (`app.demo_purge`) burada da geçerli, başka hiçbir yol silemez.
CREATE TRIGGER "ApprovalRound_no_delete" BEFORE DELETE ON "ApprovalRound"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

-- ---------------------------------------------------------------------------
-- 3. Yalnız bir kez ve yalnız kapanmak üzere güncellenir
-- ---------------------------------------------------------------------------
-- Turun kimliği, faaliyeti, sırası ve gönderim anı hiç değişmez; açık tur
-- yalnız karara bağlanarak kapanır; kapanmış tur bir daha güncellenmez.
CREATE OR REPLACE FUNCTION approval_round_immutability() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."decidedAt" IS NOT NULL THEN
    RAISE EXCEPTION
      'APPROVAL_ROUND_IMMUTABLE: karara bağlanmış tur değiştirilemez (%)', OLD."id";
  END IF;

  IF NEW."id" <> OLD."id"
     OR NEW."activityId" <> OLD."activityId"
     OR NEW."roundNo" <> OLD."roundNo"
     OR NEW."submittedAt" <> OLD."submittedAt" THEN
    RAISE EXCEPTION
      'APPROVAL_ROUND_IMMUTABLE: turun kimliği ve gönderim anı değiştirilemez (%)', OLD."id";
  END IF;

  IF NEW."decidedAt" IS NULL THEN
    RAISE EXCEPTION
      'APPROVAL_ROUND_IMMUTABLE: açık tur yalnız karara bağlanarak güncellenir (%)', OLD."id";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ApprovalRound_immutability_guard"
  BEFORE UPDATE ON "ApprovalRound"
  FOR EACH ROW EXECUTE FUNCTION approval_round_immutability();
