-- Eşzamanlılık kilitleri ve fiziksel silme engeli
-- (denetim 17.08.2026, bulgu 4, 9, 10).

-- ---------------------------------------------------------------------------
-- 1. Ağaç ve birim-kullanıcı kuralları eşzamanlı işlemlerde de geçerli olmalı
-- ---------------------------------------------------------------------------
-- Tetikleyiciler mevcut durumu kilitsiz okuyordu. İki işlem aynı anda
-- çalıştığında ikisi de diğerinin henüz commit edilmemiş değişikliğini görmez;
-- örneğin `A.parent = B` ve `B.parent = A` ikisi de geçebilir ve ağaçta döngü
-- oluşur. Bozuk ağaç, görünürlük sorgusunu (Görev 3.3) yanlış kapsama sokar —
-- yani içerik sızıntısına dönüşebilecek bir hatadır.
--
-- Çözüm: ağacı ve birim–kullanıcı etkinliğini değiştiren her işlem, işlem
-- boyunca aynı danışma kilidini alır. Bu işlemler nadirdir (organizasyon
-- değişikliği, kullanıcı ekleme), dolayısıyla serileştirmenin görünür bir
-- maliyeti yoktur.

CREATE OR REPLACE FUNCTION org_unit_tree_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  ancestor_id  TEXT;
  depth_from_root INT := 1;
  subtree_height  INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'));

  IF NEW."parentId" IS NOT NULL THEN
    IF NEW."parentId" = NEW."id" THEN
      RAISE EXCEPTION 'ORG_TREE_CYCLE: bir birim kendisinin üstü olamaz';
    END IF;

    ancestor_id := NEW."parentId";
    WHILE ancestor_id IS NOT NULL LOOP
      IF ancestor_id = NEW."id" THEN
        RAISE EXCEPTION 'ORG_TREE_CYCLE: bu taşıma ağaçta döngü oluşturur';
      END IF;

      depth_from_root := depth_from_root + 1;
      IF depth_from_root > 10 THEN
        RAISE EXCEPTION 'ORG_TREE_MAX_DEPTH: ağaç 10 kademeyi aşamaz';
      END IF;

      SELECT "parentId" INTO ancestor_id FROM "OrgUnit" WHERE "id" = ancestor_id;
    END LOOP;
  END IF;

  SELECT COALESCE(MAX(level), 1) INTO subtree_height
  FROM (
    WITH RECURSIVE subtree(id, level) AS (
      SELECT "id", 1 FROM "OrgUnit" WHERE "id" = NEW."id"
      UNION ALL
      SELECT child."id", parent.level + 1
      FROM "OrgUnit" child
      JOIN subtree parent ON child."parentId" = parent.id
      WHERE parent.level < 20
    )
    SELECT level FROM subtree
  ) levels;

  IF depth_from_root + subtree_height - 1 > 10 THEN
    RAISE EXCEPTION 'ORG_TREE_MAX_DEPTH: bu taşıma alt dalı 10 kademenin ötesine iter';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION user_active_unit_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'));

  IF NEW."isActive" AND NOT EXISTS (
    SELECT 1 FROM "OrgUnit" WHERE "id" = NEW."orgUnitId" AND "isActive"
  ) THEN
    RAISE EXCEPTION 'USER_INACTIVE_ORG_UNIT: aktif kullanıcı pasif birime bağlanamaz';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION org_unit_deactivation_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'));

  IF OLD."isActive" AND NOT NEW."isActive" AND EXISTS (
    SELECT 1 FROM "User" WHERE "orgUnitId" = NEW."id" AND "isActive"
  ) THEN
    RAISE EXCEPTION 'ORG_UNIT_HAS_ACTIVE_USERS: aktif kullanıcısı olan birim pasifleştirilemez';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Muhatap sayısı sınırı da eşzamanlı eklemede geçerli olmalı
-- ---------------------------------------------------------------------------
-- Sayım kilitsiz yapılıyordu: dört muhatap varken iki işlem de "4" görüp
-- ekleme yapabilir, toplam altıya çıkabilirdi. Kilit faaliyet bazlıdır;
-- farklı faaliyetlere yapılan eklemeler birbirini beklemez.

CREATE OR REPLACE FUNCTION activity_target_limit_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  target_count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('faaliyet:muhatap'), hashtext(NEW."activityId")
  );

  SELECT COUNT(*) INTO target_count
  FROM "ActivityTargetDept"
  WHERE "activityId" = NEW."activityId";

  IF target_count >= 5 THEN
    RAISE EXCEPTION 'ACTIVITY_TARGET_LIMIT: bir faaliyete en fazla 5 muhatap departman eklenebilir';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Fiziksel silme yoktur (§16.6)
-- ---------------------------------------------------------------------------
-- Yabancı anahtarlardaki RESTRICT yalnızca başka bir satır referans veriyorsa
-- korur; referanssız bir kullanıcı, boş bir birim veya henüz alt kaydı olmayan
-- bir faaliyet sessizce silinebiliyordu. Oysa tasarım kullanıcının ve birimin
-- yalnız pasifleştirilmesini, faaliyetin yalnız iptal edilmesini şart koşuyor:
-- sessiz silme tarihsel raporlamayı ve denetim izini geri döndürülemez biçimde
-- bozar.
--
-- Not: Bu tetikleyiciler TRUNCATE'i etkilemez; testler tabloları TRUNCATE ile
-- boşaltmaya devam eder.

CREATE OR REPLACE FUNCTION forbid_physical_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'PHYSICAL_DELETE_FORBIDDEN: % tablosundan kayıt silinemez; kullanıcı ve birim pasifleştirilir, faaliyet iptal edilir',
    TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "OrgUnit_no_delete" BEFORE DELETE ON "OrgUnit"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "User_no_delete" BEFORE DELETE ON "User"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "Activity_no_delete" BEFORE DELETE ON "Activity"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "ActivityRevision_no_delete" BEFORE DELETE ON "ActivityRevision"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "Attachment_no_delete" BEFORE DELETE ON "Attachment"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "CancellationRecord_no_delete" BEFORE DELETE ON "CancellationRecord"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "Conversation_no_delete" BEFORE DELETE ON "Conversation"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "ConversationMessage_no_delete" BEFORE DELETE ON "ConversationMessage"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

CREATE TRIGGER "AuditLog_no_delete" BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_physical_delete();

-- Denetim kaydı değişmezdir (§15.2): silinemediği gibi güncellenemez de.
CREATE OR REPLACE FUNCTION forbid_audit_update() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: denetim kaydı değiştirilemez';
END;
$$;

CREATE TRIGGER "AuditLog_no_update" BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_update();
