-- Örnek verinin köken kaydı (denetim 23.08.2026, P3-R5-2).
--
-- Prisma'nın ürettiği dosya okundu ve yine **üç satır silindi**:
-- `activity_no_seq` dizisini düşüren iki satır ile `ActivityDraft`
-- varsayılanını kaldıran satır; üçü de elle eklenmiş nesneler ve Prisma
-- onları tanımıyor (AGENTS.md kuralı). Gereksiz indeks düşür/kur çifti de
-- çıkarıldı.

CREATE TABLE "DemoObject" (
    "objectType" VARCHAR(40) NOT NULL,
    "objectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoObject_pkey" PRIMARY KEY ("objectType","objectId")
);
