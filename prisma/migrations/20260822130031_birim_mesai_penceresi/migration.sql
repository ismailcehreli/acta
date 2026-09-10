-- Birime özel mesai penceresi (Görev 11.9).
--
-- Prisma yine üç zararlı satır yazmıştı ve hepsi silindi (AGENTS.md kuralı):
-- `DROP SEQUENCE "activity_no_seq"` (faaliyet sıra numarasının kaynağı),
-- `ActivityDraft_authorId_updatedAt_idx` düşür/yeniden kur, ve
-- `ActivityDraft.targetOrgUnitIds` varsayılanını düşür.

CREATE TABLE "OrgUnitWorkCalendar" (
    "orgUnitId" TEXT NOT NULL,
    "workingDays" INTEGER[],
    "workStartMinute" INTEGER NOT NULL,
    "workEndMinute" INTEGER NOT NULL,
    "worksOnHolidays" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrgUnitWorkCalendar_pkey" PRIMARY KEY ("orgUnitId")
);

ALTER TABLE "OrgUnitWorkCalendar"
  ADD CONSTRAINT "OrgUnitWorkCalendar_orgUnitId_fkey"
  FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- İş kuralı veritabanında da durur (proje kuralı).
--
-- Mesai bitişi başlangıçtan sonra olmalı ve ikisi de günün içinde kalmalı.
-- Geceye taşan mesai tasarımda **yok** (§12.1, v3 düzeltme notu); bu kısıt
-- onu veritabanı seviyesinde de imkânsız kılıyor.
ALTER TABLE "OrgUnitWorkCalendar"
  ADD CONSTRAINT "OrgUnitWorkCalendar_valid_window"
  CHECK (
    "workStartMinute" >= 0
    AND "workEndMinute" <= 1440
    AND "workEndMinute" > "workStartMinute"
  );

-- Çalışma günleri boş olamaz ve ISO gün numarası aralığında kalmalı.
-- Boş dizi "hiç çalışılmıyor" demek olurdu; o bir birim değil, kapalı bir
-- birimdir ve pasifleştirmeyle ifade edilir.
ALTER TABLE "OrgUnitWorkCalendar"
  ADD CONSTRAINT "OrgUnitWorkCalendar_valid_days"
  CHECK (
    array_length("workingDays", 1) BETWEEN 1 AND 7
    AND "workingDays" <@ ARRAY[1,2,3,4,5,6,7]
  );
