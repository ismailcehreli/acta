-- DemoObject artık yalnız “kurulumla ilişkili” demiyor; silme kararını
-- verebilmek için nesnenin kurulum tarafından mı oluşturulduğunu, yoksa
-- önceden var olup yeniden mı kullanıldığını da saklıyor.
--
-- Bu migration'dan önce DemoObject'a yazılmış bütün satırlar, P3-R5 kodunun
-- yalnız createOrgUnit dönüşünde yazdığı satırlardır. Bu nedenle mevcut
-- satırlar için CREATED_BY_INSTALLER güvenli ve kanıtlı geriye dönük değerdir.
-- Eski üretim kurulumlarında tablo migration ile boş açılır; adlardan tahmin
-- yapılmaz, sistem yöneticisinin açık sınıflandırması beklenir.

CREATE TYPE "DemoObjectOrigin" AS ENUM (
    'CREATED_BY_INSTALLER',
    'REUSED_EXISTING'
);

ALTER TABLE "DemoObject"
    ADD COLUMN "origin" "DemoObjectOrigin" NOT NULL DEFAULT 'CREATED_BY_INSTALLER';

ALTER TABLE "DemoObject"
    ALTER COLUMN "origin" DROP DEFAULT;

