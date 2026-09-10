-- Tek ve korunmuş ana sistem yöneticisi.
-- Mevcut kurulumdaki sabit ilk hesap işaretlenir; boş veritabanı ilk kurulum
-- betiğinin root hesabı oluşturmasına bırakılır.

ALTER TABLE "User"
  ADD COLUMN "isRoot" BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE
  user_count INTEGER;
  candidate_id TEXT;
BEGIN
  SELECT COUNT(*) INTO user_count FROM "User";

  IF user_count > 0 THEN
    SELECT "id" INTO candidate_id
    FROM "User"
    WHERE "isSystemAdmin" AND "isActive"
    ORDER BY "createdAt" ASC
    LIMIT 1;

    IF candidate_id IS NOT NULL THEN
      UPDATE "User"
      SET "isRoot" = TRUE
      WHERE "id" = candidate_id;
    END IF;
  END IF;
END $$;

CREATE UNIQUE INDEX "User_single_root_idx"
  ON "User" ((TRUE))
  WHERE "isRoot";

CREATE OR REPLACE FUNCTION protect_root_user() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isRoot" THEN
    IF NOT NEW."isRoot"
       OR NOT NEW."isSystemAdmin"
       OR NOT NEW."isActive"
       OR NEW."email" IS DISTINCT FROM OLD."email"
       OR NEW."fullName" IS DISTINCT FROM OLD."fullName"
       OR NEW."isUnitManager" IS DISTINCT FROM OLD."isUnitManager" THEN
      RAISE EXCEPTION
        'ROOT_USER_PROTECTED: ana hesabın kimliği ve temel yönetim yetkisi değiştirilemez';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_root_protection"
  BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION protect_root_user();
