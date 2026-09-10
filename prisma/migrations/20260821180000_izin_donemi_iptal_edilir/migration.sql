-- "Faaliyet beklenmiyor" dönemi artık SİLİNMEZ, iptal edilir.
--
-- denetim 21.08.2026, bulgu 7. Dönem satırı `deleteMany` ile fiziksel
-- olarak siliniyordu ve bu tablo için silme engeli yoktu.
--
-- Neden önemli: vekilin **bütün** geçmiş görünürlüğü bu satırdan türer (§4.5).
-- `deputyClauses()` her dönem için bir tarih penceresi açar; satır gidince
-- pencere de gider. Yani "vekillik bittikten sonra da o dönemin kayıtlarını
-- görebilmeli ki sonradan soru gelirse cevap verebilsin" kuralı, yönetici
-- dönen kişinin izin kaydını temizlediği anda sessizce çöküyordu.
--
-- Çözüm, projedeki genel kuralın aynısı (§16.5): silme yok, iptal var.

ALTER TABLE "NoActivityPeriod"
  ADD COLUMN "cancelledAt"        TIMESTAMPTZ(3),
  ADD COLUMN "cancelledById"      TEXT,
  ADD COLUMN "cancellationReason" VARCHAR(500);

ALTER TABLE "NoActivityPeriod"
  ADD CONSTRAINT "NoActivityPeriod_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- İptal ya tamamen olmuştur ya hiç olmamıştır: kim, ne zaman ve **neden**
-- birlikte durur. Gerekçesiz iptal, "neden bu dönem yok" sorusunu
-- cevaplayamaz.
ALTER TABLE "NoActivityPeriod"
  ADD CONSTRAINT "NoActivityPeriod_cancellation_complete"
  CHECK (
    ("cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancellationReason" IS NULL)
    OR (
      "cancelledAt" IS NOT NULL
      AND "cancelledById" IS NOT NULL
      AND "cancellationReason" IS NOT NULL
      AND length(btrim("cancellationReason")) > 0
    )
  );

-- Çakışma kısıtı yalnız **geçerli** dönemler için işler. İptal edilmiş bir
-- dönem hiç yaşanmamış sayılır; aynı tarihlere doğrusu girilebilmeli.
ALTER TABLE "NoActivityPeriod" DROP CONSTRAINT "NoActivityPeriod_no_overlap";

ALTER TABLE "NoActivityPeriod"
  ADD CONSTRAINT "NoActivityPeriod_no_overlap"
  EXCLUDE USING gist (
    "userId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  ) WHERE ("cancelledAt" IS NULL);

-- Silme engeli. Uygulama katmanı devre dışıyken de geçerli olmalı: kuralın
-- bütün değeri burada.
CREATE TRIGGER "NoActivityPeriod_no_delete" BEFORE DELETE ON "NoActivityPeriod"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE INDEX "NoActivityPeriod_deputyId_cancelledAt_idx"
  ON "NoActivityPeriod"("deputyId", "cancelledAt");
