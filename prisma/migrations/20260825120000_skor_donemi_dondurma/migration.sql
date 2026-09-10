-- Kapanmış dönemin dondurulması (denetim 23.08.2026, P3-R2-4).
--
-- Kapanmış dönem, başkası baktığında canlı tablolardan yeniden hesaplanıyordu
-- ve hesap **bugünün** verisiyle yapılıyordu: eylülde verilen onay ağustosun
-- kabul oranını değiştiriyor, sonradan iptal edilen izin paydayı büyütüyor,
-- ağırlık ayarı bütün geçmişi yeniden yazıyordu. Aynı tarihçe farklı günlerde
-- farklı toplam veriyordu ve "neden 64" sorusunun kalıcı cevabı yoktu.
--
-- Bundan sonra kapanışta **katkı satırları** yazılıyor; okuma anında yalnız
-- görünürlükten süzülüyor, değeri yeniden hesaplanmıyor. Payda ve formül de
-- dönemin kendi satırında donuyor.

CREATE TYPE "ScoreFactKind" AS ENUM ('WRITTEN', 'ACCEPTED', 'DECISION', 'OBLIGATION');

ALTER TABLE "UserScorePeriod"
  ADD COLUMN "frozen"           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "profile"          VARCHAR(20),
  ADD COLUMN "weightRegularity" INTEGER,
  ADD COLUMN "weightAcceptance" INTEGER,
  ADD COLUMN "weightApproval"   INTEGER,
  ADD COLUMN "weightFollowUp"   INTEGER;

-- **Dondurulmuş dönem formülünü taşımak zorundadır.** Aksi hâlde satır
-- "donduruldu" der ama hangi ağırlıklarla okunacağı bilinmez ve okuma sessizce
-- bugünkü ayara düşerdi — tam da kapatılmak istenen hata.
ALTER TABLE "UserScorePeriod"
  ADD CONSTRAINT "UserScorePeriod_frozen_formula" CHECK (
    (
      NOT "frozen"
      AND "profile" IS NULL
      AND "weightRegularity" IS NULL
      AND "weightAcceptance" IS NULL
      AND "weightApproval" IS NULL
      AND "weightFollowUp" IS NULL
    )
    OR (
      "frozen"
      AND "profile" IS NOT NULL
      AND "weightRegularity" IS NOT NULL
      AND "weightAcceptance" IS NOT NULL
      AND "weightApproval" IS NOT NULL
      AND "weightFollowUp" IS NOT NULL
    )
  );

CREATE TABLE "UserScorePeriodFact" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "activityId"  TEXT NOT NULL,
  "kind"        "ScoreFactKind" NOT NULL,
  "happenedOn"  DATE NOT NULL,
  "onTime"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserScorePeriodFact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserScorePeriodFact_userId_periodStart_idx"
  ON "UserScorePeriodFact" ("userId", "periodStart");
CREATE INDEX "UserScorePeriodFact_activityId_idx"
  ON "UserScorePeriodFact" ("activityId");

ALTER TABLE "UserScorePeriodFact"
  ADD CONSTRAINT "UserScorePeriodFact_userId_periodStart_fkey"
  FOREIGN KEY ("userId", "periodStart")
  REFERENCES "UserScorePeriod" ("userId", "periodStart")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "UserScorePeriodFact"
  ADD CONSTRAINT "UserScorePeriodFact_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- **Katkı yalnız dondurulmuş döneme yazılabilir.** Çapraz tablo kuralı
-- olduğu için `CHECK` ile ifade edilemiyor; tetikleyici uygulama katmanı
-- devre dışıyken de geçerli.
CREATE OR REPLACE FUNCTION score_fact_requires_frozen_period() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  donuk BOOLEAN;
BEGIN
  SELECT "frozen" INTO donuk
  FROM "UserScorePeriod"
  WHERE "userId" = NEW."userId" AND "periodStart" = NEW."periodStart";

  IF donuk IS NULL OR NOT donuk THEN
    RAISE EXCEPTION 'SCORE_FACT_PERIOD_NOT_FROZEN: katkı yalnız dondurulmuş döneme yazılabilir'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "UserScorePeriodFact_requires_frozen"
  BEFORE INSERT OR UPDATE ON "UserScorePeriodFact"
  FOR EACH ROW EXECUTE FUNCTION score_fact_requires_frozen_period();
