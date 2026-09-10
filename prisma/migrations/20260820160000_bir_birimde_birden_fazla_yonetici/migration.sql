-- Bir birimde birden fazla yönetici (ürün sahibi kararı, 20.08.2026).
--
-- Önceki kural: bir birimde en fazla bir yönetici (§4.2). Gerçek şirkette bir
-- departmanda iki müdür bulunabiliyor ve sistem bunu ifade edemiyordu.
--
-- Karar: birimde birden fazla yönetici olabilir. **Her ikisi de onaylayabilir;
-- ilk karar veren süreci kapatır.** Onay kuyruğu bölünmez — kayıt her iki
-- müdürün de kuyruğunda görünür, biri karar verince diğerininkinden düşer.
--
-- Bunun iki sonucu var ve ikisi de bilinçli:
--
--   1. "Onaylayıcı kim" artık tek bir sütunla ifade edilemez. Uygun
--      onaylayıcıların listesi **kayda yazılır** (`ActivityApprover`).
--      Ağaç sonradan değişse bile o kaydın kime düştüğü değişmez; aksi hâlde
--      bir birim taşındığında akıştaki iş sessizce başkasına devrolurdu.
--   2. Aynı birimin iki müdürü birbirinin kayıtlarını görür. Akran kuralı
--      (§8.1) hâlâ geçerli — ama iki müdür akran değil, aynı birimin
--      yöneticisidir ve o birimin tamamını zaten görürler.
--
-- `Activity."approverId"` sütunu kalır ve anlamı netleşir: karar verilmeden
-- önce **ilk çözülen** onaylayıcı, karar verildikten sonra **kararı veren**
-- kişi. "Kim onayladı" sorusunun cevabı odur.

-- ---------------------------------------------------------------------------
-- 1. Tek yönetici kısıtı kalkıyor
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "User_one_manager_per_unit_idx";

-- Yerine yalnızca arama indeksi: "bu birimin yöneticileri kimler".
CREATE INDEX IF NOT EXISTS "User_unit_managers_idx"
  ON "User" ("orgUnitId")
  WHERE "isUnitManager";

-- ---------------------------------------------------------------------------
-- 2. Kaydın uygun onaylayıcıları
-- ---------------------------------------------------------------------------
-- Yazım anında dondurulur. Boş olabilir: onaya tabi olmayan birimde kayıt
-- doğrudan onaylı doğar ve kimsenin kuyruğuna girmez.
CREATE TABLE "ActivityApprover" (
  "activityId" TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

  CONSTRAINT "ActivityApprover_pkey" PRIMARY KEY ("activityId", "userId"),
  CONSTRAINT "ActivityApprover_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "Activity"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ActivityApprover_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- "Bana düşen onaylar" sorgusunun indeksi.
CREATE INDEX "ActivityApprover_userId_idx" ON "ActivityApprover" ("userId");

-- ---------------------------------------------------------------------------
-- 3. Mevcut kayıtların taşınması
-- ---------------------------------------------------------------------------
-- Bugüne kadar yazılmış her kaydın tek bir onaylayıcısı vardı; o kişi listeye
-- yazılır. Böylece görünürlük sorgusu eski kayıtlarda da aynı sonucu verir.
INSERT INTO "ActivityApprover" ("activityId", "userId")
SELECT "id", "approverId" FROM "Activity" WHERE "approverId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Fiziksel silme yasağı bu tabloya da uygulanır
-- ---------------------------------------------------------------------------
-- Kaydın kime düştüğü de bir tarihtir; sessizce silinemez. Örnek veri
-- temizliğinin dar kapısı (`app.demo_purge`) burada da geçerlidir.
CREATE TRIGGER "ActivityApprover_no_delete" BEFORE DELETE ON "ActivityApprover"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();
