-- Rapor ekranı için ayrı ve açık yetkiler.
-- Kapsam, kullanıcının bağlı olduğu aktif birim ve alt ağacından çözülür;
-- bu kolonlar yalnız ekranın açılabilir olup olmadığını belirler.

ALTER TABLE "User"
  ADD COLUMN "canViewReports" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "canViewScoreReports" BOOLEAN NOT NULL DEFAULT FALSE;

-- Mevcut ana hesap rapor ekranını kullanabilsin. Diğer hesaplara erişim
-- kendiliğinden açılmaz; sistem yöneticisi kullanıcı yönetiminden verir.
UPDATE "User"
SET "canViewReports" = TRUE,
    "canViewScoreReports" = TRUE
WHERE "isRoot" = TRUE;
