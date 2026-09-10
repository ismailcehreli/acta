-- Profil resmi (Görev 11.5).
--
-- Prisma bu dosyayı üretirken elle eklenmiş veritabanı nesnelerini tanımadığı
-- için üç zararlı satır daha yazmıştı ve hepsi silindi (AGENTS.md'deki kural):
--
--   1. `DROP SEQUENCE "activity_no_seq"` — faaliyet sıra numarasının kaynağı.
--      Düşseydi yeni kayıt açılamaz, mevcut numaralar anlamını yitirirdi.
--   2. `ActivityDraft_authorId_updatedAt_idx` düşür + yeniden kur — aynı
--      indeksi gereksiz yere yeniden yaratıyordu.
--   3. `ActivityDraft.targetOrgUnitIds` varsayılanını düşür.
--
-- Geriye tek gereken satır kaldı.

ALTER TABLE "User" ADD COLUMN "avatarExtension" VARCHAR(8);
