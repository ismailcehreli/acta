-- Konuşma taraflarının doğru belirlenmesi
-- (denetim 18.08.2026, FAZ 4 bulgu 5).
--
-- "Açık konuşması olan kullanıcı pasifleştirilemez" kuralı `askerId` ve
-- `responsibleId` alanlarına bakıyordu. Oysa `responsibleId` her mesajda el
-- değiştirir: sorumluluk sorana geçtiği anda faaliyetin yazarı hiçbir alanda
-- görünmüyor ve açık konuşması varken pasifleştirilebiliyordu.
--
-- Konuşmanın **sabit tarafları** soran ile faaliyetin yazarıdır; kural artık
-- bunlara bakıyor.

CREATE OR REPLACE FUNCTION user_deactivation_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('faaliyet:org_agaci'));

  IF OLD."isActive" AND NOT NEW."isActive" AND EXISTS (
    SELECT 1
    FROM "Conversation" c
    JOIN "Activity" a ON a."id" = c."activityId"
    WHERE c."status" = 'OPEN'
      AND (
        c."askerId" = NEW."id"
        OR c."responsibleId" = NEW."id"
        OR a."authorId" = NEW."id"
      )
  ) THEN
    RAISE EXCEPTION 'USER_HAS_OPEN_CONVERSATIONS: açık konuşması olan kullanıcı pasifleştirilemez';
  END IF;

  RETURN NEW;
END;
$$;
