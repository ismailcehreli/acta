-- Kodda ifade edilen "son / azami / tek" kuralları veritabanında da zorlanır.
--
-- denetim 21.08.2026, bulgu 6, 8, 10 ve 11. Dördü de aynı kalıbın
-- kurbanıydı: **önce say, sonra yaz.** Sayım işlem dışında ve kilitsiz
-- yapılıyor; iki eşzamanlı işlem birbirini göremediği için ikisi de geçiyor:
--
--   · İki yönetici aynı anda birbirinin sistem yöneticiliğini kaldırır →
--     şirkette sıfır aktif yönetici kalır.
--   · Dört eki olan faaliyete iki istek aynı anda birer dosya yükler →
--     altı ek olur, sınır 5'ti.
--   · Aynı takip maddesi iki kez kapatılır → olay geçmişinde arada
--     REOPENED olmadan iki CLOSED satırı doğar.
--   · Bir karar türünün son iki gerekçesi aynı anda pasifleştirilir →
--     hiç gerekçe kalmaz, reddetme yapılamaz hâle gelir.
--
-- AGENTS.md: "kısıtın değeri, uygulama katmanı devre dışıyken de geçerli
-- olmasındadır." Uygulama tarafındaki kilitler ayrıca eklendi; buradaki
-- tetikleyiciler o kilitler unutulsa ya da atlansa bile kuralı korur.
--
-- Yarışın kapanması **danışma kilidiyle** (advisory lock) olur. Yalnız
-- tetikleyici koymak yetmezdi: READ COMMITTED altında iki işlem birbirinin
-- yazmasını görmez, ikisi de "başka yönetici var" der ve ikisi de geçer.
-- Kilit, aynı kaynağa dokunan işlemleri sıraya sokar; ikinci işlem birincinin
-- commit'ini bekler ve gerçeği görür.

-- ---------------------------------------------------------------------------
-- 1. En az bir aktif sistem yöneticisi kalmalı (bulgu 6)
-- ---------------------------------------------------------------------------
-- Sıfıra düşerse yönetim ekranlarına girecek kimse kalmaz. Sunucuya erişimi
-- olan biri `pnpm kurulum` ile kurtarabilir ama bu, uygulamanın kendi
-- değişmezini koruyamadığı anlamına gelir.
CREATE OR REPLACE FUNCTION assert_system_admin_remains() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Yalnız "yetkiyi/aktifliği kaybettiren" güncellemelerde çalışır.
  IF (OLD."isSystemAdmin" AND OLD."isActive")
     AND NOT (NEW."isSystemAdmin" AND NEW."isActive") THEN

    -- Aynı kaynağa dokunan işlemleri sıraya sok. İşlem bitince kendiliğinden
    -- kalkar; uygulamanın kilidi kurmayı unutması ihtimalini ortadan kaldırır.
    PERFORM pg_advisory_xact_lock(hashtext('system_admin_roster'));

    IF NOT EXISTS (
      SELECT 1 FROM "User"
      WHERE "isSystemAdmin" AND "isActive" AND "id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION
        'LAST_SYSTEM_ADMIN: son aktif sistem yöneticisinin yetkisi kaldırılamaz';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_keep_system_admin" BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION assert_system_admin_remains();

-- ---------------------------------------------------------------------------
-- 2. Faaliyet başına ek sayısı sınırı (bulgu 8)
-- ---------------------------------------------------------------------------
-- Sınır **ayardır** (§16.4), sabit değil; bu yüzden basit bir CHECK ile
-- ifade edilemiyor. Tetikleyici ayarı okur ve eklemeyi faaliyet satırını
-- kilitleyerek sıraya sokar.
CREATE OR REPLACE FUNCTION assert_attachment_limit() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  azami   INT;
  mevcut  INT;
BEGIN
  -- Aynı faaliyete yüklemeleri sıraya sok.
  PERFORM 1 FROM "Activity" WHERE "id" = NEW."activityId" FOR UPDATE;

  SELECT COALESCE(
           (SELECT "value"::int FROM "SystemSetting"
             WHERE "key" = 'attachment_max_count' AND "value" ~ '^[0-9]+$'),
           5)
    INTO azami;

  SELECT count(*) INTO mevcut FROM "Attachment" WHERE "activityId" = NEW."activityId";

  IF mevcut > azami THEN
    RAISE EXCEPTION
      'ATTACHMENT_LIMIT_EXCEEDED: faaliyet başına en fazla % ek olabilir', azami;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Attachment_limit" AFTER INSERT ON "Attachment"
  FOR EACH ROW EXECUTE FUNCTION assert_attachment_limit();

-- ---------------------------------------------------------------------------
-- 3. Kapalı takip maddesi ikinci kez kapatılamaz (bulgu 10)
-- ---------------------------------------------------------------------------
-- Olay geçmişi, gerçekte gerçekleşmemiş bir ikinci kapanışı göstermemeli
-- (§11.1). Kapalıdan kapalıya geçiş anlamsızdır; arada REOPENED olmalı.
CREATE OR REPLACE FUNCTION assert_follow_up_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'CLOSED' AND NEW."status" = 'CLOSED'
     AND (
       OLD."closedAt"     IS DISTINCT FROM NEW."closedAt"
       OR OLD."closedById"  IS DISTINCT FROM NEW."closedById"
       OR OLD."closingNote" IS DISTINCT FROM NEW."closingNote"
     ) THEN
    RAISE EXCEPTION
      'FOLLOW_UP_ALREADY_CLOSED: kapalı madde ikinci kez kapatılamaz';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "FollowUpItem_transition" BEFORE UPDATE ON "FollowUpItem"
  FOR EACH ROW EXECUTE FUNCTION assert_follow_up_transition();

-- ---------------------------------------------------------------------------
-- 4. Her karar türünde en az bir aktif gerekçe kalmalı (bulgu 11)
-- ---------------------------------------------------------------------------
-- Katalog boşalırsa §6.3'ün "gerekçe zorunlu" kuralı o kararı imkânsız kılar:
-- müdür reddetmek ister, seçebileceği hiçbir gerekçe yoktur.
CREATE OR REPLACE FUNCTION assert_approval_reason_remains() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" AND NOT NEW."isActive" THEN
    PERFORM pg_advisory_xact_lock(hashtext('approval_reason:' || NEW."kind"::text));

    IF NOT EXISTS (
      SELECT 1 FROM "ApprovalReason"
      WHERE "kind" = NEW."kind" AND "isActive" AND "id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION
        'LAST_APPROVAL_REASON: bu karar türünün son aktif gerekçesi pasifleştirilemez';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ApprovalReason_keep_one_active" BEFORE UPDATE ON "ApprovalReason"
  FOR EACH ROW EXECUTE FUNCTION assert_approval_reason_remains();
