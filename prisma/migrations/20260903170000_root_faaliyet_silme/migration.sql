-- Root'un faaliyet silmesi (ürün sahibi kararı, 03.09.2026).
--
-- Fiziksel silme yasağına **ikinci dar kapı**. Yasak yerinde duruyor:
-- kullanıcı ve birim pasifleştirilir, faaliyet iptal edilir. Sessiz silme
-- tarihsel raporlamayı ve denetim izini geri döndürülemez biçimde bozar.
--
-- İstisnanın gerekçesi ve sınırı §16.5'e ekleniyor; kapının kendisi örnek veri
-- temizliğindeki (`20260820120000_ornek_veri_temizligi`) kalıbın aynısı:
--
--   * Yasak **varsayılan**. Tetikleyici yalnız `app.activity_delete` oturum
--     değişkeni tam olarak 'evet' iken siliyor.
--   * Değişken `SET LOCAL` ile, yalnız o transaction süresince kuruluyor;
--     işlem bitince kalkar ve bağlantı havuzunda bir sonraki isteğe sızamaz.
--   * Uygulamada bu değişkeni kuran tek yer `src/server/activities/delete.ts`.
--
-- Kapının veritabanı katmanında açılıyor olması "kim silebilir" sorusunun
-- cevabını değiştirmiyor: yetki (yalnız root), kapanmamış dönem ve e-postayla
-- gelen tek kullanımlık kod uygulama katmanında ayrıca aranıyor.

CREATE OR REPLACE FUNCTION forbid_physical_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Örnek veri temizliği: yalnız transaction'a özel bayrak kurulmuşsa.
  IF current_setting('app.demo_purge', true) = 'evet' THEN
    RETURN OLD;
  END IF;

  -- Root'un faaliyet silmesi: aynı biçimde dar, aynı biçimde transaction'a özel.
  IF current_setting('app.activity_delete', true) = 'evet' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'PHYSICAL_DELETE_FORBIDDEN: % tablosundan kayıt silinemez; kullanıcı ve birim pasifleştirilir, faaliyet iptal edilir',
    TG_TABLE_NAME;
END;
$$;

-- Silme talebi. `activityId` bilerek yabancı anahtar değil: hedefi silinen
-- talep kaydı yaşamaya devam etmeli, yoksa silmenin kanıtı silinen şeyle
-- birlikte giderdi.
CREATE TABLE "ActivityDeletionRequest" (
  "id"             TEXT NOT NULL,
  "activityId"     TEXT NOT NULL,
  "activityTitle"  VARCHAR(300) NOT NULL,
  "activityDate"   DATE NOT NULL,
  "activityAuthor" VARCHAR(200) NOT NULL,
  "requestedById"  TEXT NOT NULL,
  "codeHash"       VARCHAR(64) NOT NULL,
  "expiresAt"      TIMESTAMPTZ(3) NOT NULL,
  "attemptCount"   INTEGER NOT NULL DEFAULT 0,
  "consumedAt"     TIMESTAMPTZ(3),
  "cancelledAt"    TIMESTAMPTZ(3),
  "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ActivityDeletionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActivityDeletionRequest_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Talep ya bekler, ya kullanılır, ya iptal edilir; ikisi birden olamaz.
  CONSTRAINT "ActivityDeletionRequest_single_outcome"
    CHECK ("consumedAt" IS NULL OR "cancelledAt" IS NULL),
  CONSTRAINT "ActivityDeletionRequest_attempts_nonnegative"
    CHECK ("attemptCount" >= 0)
);

CREATE INDEX "ActivityDeletionRequest_requestedById_createdAt_idx"
  ON "ActivityDeletionRequest"("requestedById", "createdAt");
CREATE INDEX "ActivityDeletionRequest_activityId_idx"
  ON "ActivityDeletionRequest"("activityId");

-- Talep kaydı da bir denetim izidir: silinemez.
CREATE TRIGGER "ActivityDeletionRequest_no_delete" BEFORE DELETE ON "ActivityDeletionRequest"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();
