-- Pasifleştirme yarışları (denetim FAZ 2, bulgu 3 ve 4).
--
-- Servis katmanındaki "önce kontrol et, sonra yaz" düzeni eşzamanlı isteklerde
-- delinebiliyordu: kontrol ile yazım arasında yeni bir aktif çocuk eklenebilir
-- ya da pasifleşen kişiye açık konuşma açılabilirdi. Kural veritabanına
-- indiriliyor ve ilgili yollar ortak ağaç kilidini paylaşıyor.

-- ---------------------------------------------------------------------------
-- 1. Aktif alt birimi olan birim pasifleştirilemez
-- ---------------------------------------------------------------------------
-- Bu kural ürün sahibi tarafından onaylandı (açık soru 6/c): pasif bir birimin
-- altında aktif dal kalması ağacı anlamsız kılar ve §4.4 yönetici çözümlemesini
-- pasif bir ata üzerinden yürütür.
CREATE OR REPLACE FUNCTION org_unit_deactivation_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'));

  IF OLD."isActive" AND NOT NEW."isActive" THEN
    IF EXISTS (
      SELECT 1 FROM "User" WHERE "orgUnitId" = NEW."id" AND "isActive"
    ) THEN
      RAISE EXCEPTION 'ORG_UNIT_HAS_ACTIVE_USERS: aktif kullanıcısı olan birim pasifleştirilemez';
    END IF;

    IF EXISTS (
      SELECT 1 FROM "OrgUnit" WHERE "parentId" = NEW."id" AND "isActive"
    ) THEN
      RAISE EXCEPTION 'ORG_UNIT_HAS_ACTIVE_CHILDREN: aktif alt birimi olan birim pasifleştirilemez';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Aktif birim pasif bir üstün altına konulamaz
-- ---------------------------------------------------------------------------
-- Ağaç tetikleyicisi bugüne kadar yalnız döngü ve derinliğe bakıyordu; üstün
-- aktifliği yalnız servis katmanında kontrol ediliyordu. Aynı kilidi paylaşan
-- iki işlem (birimi pasifleştirme ve altına çocuk ekleme) bu yüzden sıraya
-- girse bile ikinci işlem eski duruma göre geçebiliyordu.
CREATE OR REPLACE FUNCTION org_unit_active_parent_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'));

  IF NEW."isActive" AND NEW."parentId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "OrgUnit" WHERE "id" = NEW."parentId" AND "isActive"
  ) THEN
    RAISE EXCEPTION 'ORG_UNIT_INACTIVE_PARENT: aktif birim pasif bir üstün altına konulamaz';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "OrgUnit_active_parent_guard"
  BEFORE INSERT OR UPDATE OF "parentId", "isActive" ON "OrgUnit"
  FOR EACH ROW EXECUTE FUNCTION org_unit_active_parent_guard();

-- ---------------------------------------------------------------------------
-- 3. Pasif kullanıcıya konuşma açılamaz / atanamaz
-- ---------------------------------------------------------------------------
-- §9.3: sahipsiz açık konuşma kalamaz. Kullanıcı pasifleştirme kontrolü ile
-- konuşma açma arasındaki yarış, pasifleşmiş kişiye açık konuşma bırakabiliyordu
-- (bulgu 3). Kural buraya indirildi; her iki yol da aynı kilidi alır.
CREATE OR REPLACE FUNCTION conversation_active_parties_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'));

  IF NEW."status" = 'OPEN' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "User" WHERE "id" = NEW."askerId" AND "isActive"
    ) THEN
      RAISE EXCEPTION 'CONVERSATION_INACTIVE_ASKER: pasif kullanıcı adına soru açılamaz';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM "User" WHERE "id" = NEW."responsibleId" AND "isActive"
    ) THEN
      RAISE EXCEPTION 'CONVERSATION_INACTIVE_RESPONSIBLE: pasif kullanıcı bir konuşmanın sorumlusu olamaz';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Conversation_active_parties_guard"
  BEFORE INSERT OR UPDATE OF "askerId", "responsibleId", "status" ON "Conversation"
  FOR EACH ROW EXECUTE FUNCTION conversation_active_parties_guard();

-- ---------------------------------------------------------------------------
-- 4. Açık konuşması olan kullanıcı pasifleştirilemez
-- ---------------------------------------------------------------------------
-- §4.6'nın veritabanı karşılığı. Servis katmanı engelleri kullanıcıya liste
-- hâlinde göstermeye devam eder; bu tetikleyici, o listeyi hiç görmeyen bir
-- yolun kuralı delmesini engeller.
CREATE OR REPLACE FUNCTION user_deactivation_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'));

  IF OLD."isActive" AND NOT NEW."isActive" AND EXISTS (
    SELECT 1 FROM "Conversation"
    WHERE "status" = 'OPEN'
      AND ("askerId" = NEW."id" OR "responsibleId" = NEW."id")
  ) THEN
    RAISE EXCEPTION 'USER_HAS_OPEN_CONVERSATIONS: açık konuşması olan kullanıcı pasifleştirilemez';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_deactivation_guard"
  BEFORE UPDATE OF "isActive" ON "User"
  FOR EACH ROW EXECUTE FUNCTION user_deactivation_guard();
