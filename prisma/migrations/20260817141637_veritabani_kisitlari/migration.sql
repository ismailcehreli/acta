-- Veritabanı seviyesi kısıtlar (tasarım §4.2, §5.4, §16.6).
--
-- Bu kuralların yalnızca servis kodunda durması yeterli değildir: uygulama
-- hatası, elle çalıştırılan bir SQL veya ileride yazılacak bir toplu işlem
-- veriyi bozabilir. Buradaki kısıtlar o yolların hepsini kapatır.
--
-- Prisma bu nesneleri (kısmi indeks, trigger, EXCLUDE kısıtı) şema dosyasından
-- üretemez; bu yüzden elle yazılmış migration olarak durur.

-- ---------------------------------------------------------------------------
-- 1. Ağaçta tam olarak bir kök bulunur (§4.2)
-- ---------------------------------------------------------------------------
-- Kısmi tekil indeks: "parentId IS NULL" olan en fazla bir satır olabilir.
CREATE UNIQUE INDEX "OrgUnit_single_root_idx"
  ON "OrgUnit" ((TRUE))
  WHERE "parentId" IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Bir birimde en fazla bir birim yöneticisi olabilir (§4.2, §4.4)
-- ---------------------------------------------------------------------------
-- Not: bayrağı taşıyan kullanıcı pasifleştirilse de yer tutmaya devam eder.
-- Pasifleştirme akışı (§4.6) yöneticiliği devretmeden tamamlanmadığı için bu
-- doğru davranıştır: birim yöneticisiz veya iki yöneticili kalamaz.
CREATE UNIQUE INDEX "User_one_manager_per_unit_idx"
  ON "User" ("orgUnitId")
  WHERE "isUnitManager";

-- ---------------------------------------------------------------------------
-- 3. Ağaç bütünlüğü: döngü yok, kopuk dal yok, azami derinlik 10 (§4.2)
-- ---------------------------------------------------------------------------
-- Kopuk dal ayrı bir kontrol gerektirmez: her düğümün tek üstü vardır (yabancı
-- anahtar), kök tektir (1. kısıt) ve döngü yasaktır — bu üçü birlikte her
-- düğümün kökten erişilebilir olmasını garanti eder.
CREATE OR REPLACE FUNCTION org_unit_tree_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  ancestor_id  TEXT;
  depth_from_root INT := 1;
  subtree_height  INT;
BEGIN
  IF NEW."parentId" IS NOT NULL THEN
    IF NEW."parentId" = NEW."id" THEN
      RAISE EXCEPTION 'ORG_TREE_CYCLE: bir birim kendisinin üstü olamaz';
    END IF;

    -- Ata zincirini kökten yukarı doğru yürü: hem döngüyü hem derinliği görürüz.
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

  -- Düğüm taşındığında altındaki dal da derinleşir; toplam derinlik sınırı
  -- yalnızca düğümün kendisi için değil, alt ağacın en derin yaprağı için de
  -- geçerlidir. Eklemede alt ağaç henüz yoktur (yükseklik 1).
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

CREATE TRIGGER "OrgUnit_tree_guard"
  BEFORE INSERT OR UPDATE OF "parentId" ON "OrgUnit"
  FOR EACH ROW EXECUTE FUNCTION org_unit_tree_guard();

-- ---------------------------------------------------------------------------
-- 4. Aktif kullanıcı pasif birime bağlanamaz (§4.2, §4.6)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_active_unit_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."isActive" AND NOT EXISTS (
    SELECT 1 FROM "OrgUnit" WHERE "id" = NEW."orgUnitId" AND "isActive"
  ) THEN
    RAISE EXCEPTION 'USER_INACTIVE_ORG_UNIT: aktif kullanıcı pasif birime bağlanamaz';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_active_unit_guard"
  BEFORE INSERT OR UPDATE OF "isActive", "orgUnitId" ON "User"
  FOR EACH ROW EXECUTE FUNCTION user_active_unit_guard();

-- Aynı kuralın ters yönü: içinde aktif kullanıcı varken birim pasifleştirilemez.
-- Aksi hâlde kural kullanıcı tarafından korunur, birim tarafından delinirdi.
CREATE OR REPLACE FUNCTION org_unit_deactivation_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" AND NOT NEW."isActive" AND EXISTS (
    SELECT 1 FROM "User" WHERE "orgUnitId" = NEW."id" AND "isActive"
  ) THEN
    RAISE EXCEPTION 'ORG_UNIT_HAS_ACTIVE_USERS: aktif kullanıcısı olan birim pasifleştirilemez';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "OrgUnit_deactivation_guard"
  BEFORE UPDATE OF "isActive" ON "OrgUnit"
  FOR EACH ROW EXECUTE FUNCTION org_unit_deactivation_guard();

-- ---------------------------------------------------------------------------
-- 5. Bir faaliyete en fazla 5 muhatap departman (§5.2, §16.2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION activity_target_limit_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  target_count INT;
BEGIN
  SELECT COUNT(*) INTO target_count
  FROM "ActivityTargetDept"
  WHERE "activityId" = NEW."activityId";

  IF target_count >= 5 THEN
    RAISE EXCEPTION 'ACTIVITY_TARGET_LIMIT: bir faaliyete en fazla 5 muhatap departman eklenebilir';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ActivityTargetDept_limit_guard"
  BEFORE INSERT ON "ActivityTargetDept"
  FOR EACH ROW EXECUTE FUNCTION activity_target_limit_guard();

-- ---------------------------------------------------------------------------
-- 6. Geçersiz onay durumu geçişi reddedilir (§5.4, §16.6)
-- ---------------------------------------------------------------------------
-- İzin verilen geçişler yalnızca §5.4'teki durum diyagramında olanlardır.
-- Özellikle: iptal geri alınamaz (CANCELLED'dan çıkış yok) ve yöneticisi
-- bulunamayan faaliyet kendiliğinden onaylanmış sayılamaz.
CREATE OR REPLACE FUNCTION activity_status_transition_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."approvalStatus" = NEW."approvalStatus" THEN
    RETURN NEW;
  END IF;

  IF NOT (
       (OLD."approvalStatus" = 'DRAFT'
          AND NEW."approvalStatus" IN ('PENDING_APPROVAL', 'APPROVED'))
    OR (OLD."approvalStatus" = 'PENDING_APPROVAL'
          AND NEW."approvalStatus" IN ('APPROVED', 'CHANGES_REQUESTED', 'MANAGER_NOT_FOUND'))
    OR (OLD."approvalStatus" = 'CHANGES_REQUESTED'
          AND NEW."approvalStatus" IN ('PENDING_APPROVAL', 'MANAGER_NOT_FOUND'))
    OR (OLD."approvalStatus" = 'MANAGER_NOT_FOUND'
          AND NEW."approvalStatus" = 'PENDING_APPROVAL')
    OR (OLD."approvalStatus" = 'APPROVED'
          AND NEW."approvalStatus" = 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'ACTIVITY_INVALID_STATUS_TRANSITION: % → % geçişi tanımlı değil',
      OLD."approvalStatus", NEW."approvalStatus";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Activity_status_transition_guard"
  BEFORE UPDATE OF "approvalStatus" ON "Activity"
  FOR EACH ROW EXECUTE FUNCTION activity_status_transition_guard();

-- ---------------------------------------------------------------------------
-- 7. "Faaliyet beklenmiyor" dönemleri (§16.5)
-- ---------------------------------------------------------------------------
-- Aynı kişi için çakışan aralık engellenir; aksi hâlde katılım paydası ve
-- hatırlatma mantığı hangi kaydı esas alacağını bilemezdi.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "NoActivityPeriod"
  ADD CONSTRAINT "NoActivityPeriod_valid_range"
  CHECK ("endDate" >= "startDate");

ALTER TABLE "NoActivityPeriod"
  ADD CONSTRAINT "NoActivityPeriod_no_overlap"
  EXCLUDE USING gist (
    "userId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  );

-- ---------------------------------------------------------------------------
-- 8. Çalışma takvimi şirket geneli tek kayıttır (§12.1, §16.5)
-- ---------------------------------------------------------------------------
ALTER TABLE "WorkCalendar"
  ADD CONSTRAINT "WorkCalendar_singleton"
  CHECK ("id" = 1);

-- ---------------------------------------------------------------------------
-- 9. Türkçe tam metin arama indeksi (§16.2)
-- ---------------------------------------------------------------------------
-- Arama başlık ve açıklama üzerinde çalışır; sonuçlar her zaman görünürlük
-- kapsamıyla sınırlanır (§8) — indeks yetki vermez, yalnızca hızlandırır.
CREATE INDEX "Activity_fulltext_idx"
  ON "Activity"
  USING GIN (to_tsvector('turkish', "title" || ' ' || "description"));
