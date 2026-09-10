-- Faaliyet sıra numarası (ister belgesi §3.1).
--
-- "412 numaralı faaliyet" demeyi mümkün kılar. Kimlik hâlâ `id`dir; bu numara
-- yalnızca insanların birbirine atıf vermesi için.
--
-- Numara **departmandan bağımsız** ve yazım sırasına göre artar. Sıra
-- veritabanı dizisiyle üretilir: uygulama katmanında "en büyüğü bul, bir ekle"
-- demek, iki eşzamanlı kaydın aynı numarayı almasına açık kapı bırakırdı.

CREATE SEQUENCE IF NOT EXISTS activity_no_seq;

ALTER TABLE "Activity" ADD COLUMN "activityNo" INTEGER;

-- Mevcut kayıtlar kronolojik sırayla numaralanır: numaranın anlamı "kaçıncı
-- yazıldı" olduğu için fiziksel satır sırasına bırakılamaz.
WITH sirali AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS sira
  FROM "Activity"
)
UPDATE "Activity" a
SET "activityNo" = sirali.sira
FROM sirali
WHERE a."id" = sirali."id";

-- Dizi, dolu numaraların üstünden devam eder.
SELECT setval(
  'activity_no_seq',
  COALESCE((SELECT MAX("activityNo") FROM "Activity"), 0) + 1,
  false
);

ALTER TABLE "Activity"
  ALTER COLUMN "activityNo" SET DEFAULT nextval('activity_no_seq'),
  ALTER COLUMN "activityNo" SET NOT NULL;

ALTER SEQUENCE activity_no_seq OWNED BY "Activity"."activityNo";

CREATE UNIQUE INDEX "Activity_activityNo_key" ON "Activity"("activityNo");
