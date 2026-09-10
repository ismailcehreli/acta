-- Reddetme durum geçişleri (§5.4, ürün sahibi kararı 19.08.2026).
--
-- Durum makinesi veritabanında da duruyor; yeni durumu enum'a eklemek yetmez,
-- geçiş bekçisi de bilmek zorunda. Aksi hâlde uygulama reddetmeye çalışır ve
-- trigger onu reddeder.
--
-- İki yeni geçiş var:
--   onay_bekliyor      → reddedildi
--   duzeltme_istendi   → reddedildi   (yazan hiç düzeltmezse kayıt askıda kalmasın)
--
-- `REJECTED` **son durumdur**: çıkışı yoktur. Düzeltilip yeniden
-- gönderilebilseydi "düzeltme iste"den farkı kalmazdı.

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
          AND NEW."approvalStatus" IN ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'MANAGER_NOT_FOUND'))
    OR (OLD."approvalStatus" = 'CHANGES_REQUESTED'
          AND NEW."approvalStatus" IN ('PENDING_APPROVAL', 'REJECTED', 'MANAGER_NOT_FOUND'))
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
