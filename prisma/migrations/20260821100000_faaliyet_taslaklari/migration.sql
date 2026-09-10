-- Gönderilmemiş faaliyet taslakları (ürün sahibi isteği, 21.08.2026).
--
-- Bugüne kadar yarım kalan metin yalnız **tarayıcıda** (localStorage)
-- duruyordu: başka bir cihazdan görünmüyor, hiçbir ekranda listelenmiyor ve
-- tarayıcı verisi temizlenince kayboluyordu. Ürün sahibinin beklediği şey
-- Outlook'taki taslaklar kutusu: yazılmış ama gönderilmemiş metin bir yerde
-- durur, kullanıcı isterse gönderir, isterse siler.
--
-- İki durum, tek liste:
--   1. Bilerek bekletilen taslak — "son bir kontrol edeyim, sonra gönderirim".
--   2. Kazara kalan metin — sekme kapandı, telefon kapandı, tarayıcı çöktü.
--
-- **Neden ayrı tablo, neden `Activity.approvalStatus = DRAFT` değil:**
--
--   1. Sıra numarası. `Activity` satırı doğduğu anda `activityNo` alır ve o
--      numara insanların birbirine atıf verdiği kalıcı kimliktir. Hiç
--      gönderilmemiş bir müsvedde için numara yakmak, dizide açıklanamayan
--      boşluklar bırakırdı.
--   2. Görünürlük. Taslak yalnız yazarınındır. `Activity` içinde tutulsaydı
--      her okuma sorgusuna "ve taslak olmasın" koşulu eklemek gerekirdi;
--      unutulan tek sorgu sızıntı demekti (§18.4).
--   3. Silinebilirlik. Faaliyet silinemez (§16.6) çünkü **olmuş** bir şeyin
--      kaydıdır. Taslak hiç olmamış bir şeyin müsveddesidir; kullanıcı
--      gönderilmemiş notunu çöpe atabilmeli.
--
-- Bu yüzden bu tabloya fiziksel silme yasağı tetikleyicisi **bilerek
-- konmadı.** Yasak, tarihsel kaydı ve denetim izini korumak için var; taslak
-- ikisine de girmez.

CREATE TABLE "ActivityDraft" (
  "id"               TEXT NOT NULL,
  "authorId"         TEXT NOT NULL,
  "activityDate"     DATE NOT NULL,
  "title"            VARCHAR(150) NOT NULL,
  "description"      VARCHAR(10000) NOT NULL,
  "targetOrgUnitIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "openFollowUp"     BOOLEAN NOT NULL DEFAULT false,
  "savedManually"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ActivityDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActivityDraft_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- "Taslaklarım, en son değişen üstte."
CREATE INDEX "ActivityDraft_authorId_updatedAt_idx"
  ON "ActivityDraft" ("authorId", "updatedAt" DESC);

-- Bir kullanıcının biriktirebileceği taslak sayısı sınırlı: otomatik kaydetme
-- her form açılışında yeni satır üretirse liste çöpe döner. Sınır uygulama
-- katmanında da var; burada son savunma olarak duruyor.
CREATE OR REPLACE FUNCTION limit_activity_drafts() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  adet INTEGER;
BEGIN
  SELECT count(*) INTO adet FROM "ActivityDraft" WHERE "authorId" = NEW."authorId";

  IF adet > 50 THEN
    RAISE EXCEPTION
      'TOO_MANY_DRAFTS: bir kullanıcı en fazla 50 taslak tutabilir';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ActivityDraft_limit"
  AFTER INSERT ON "ActivityDraft"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION limit_activity_drafts();
