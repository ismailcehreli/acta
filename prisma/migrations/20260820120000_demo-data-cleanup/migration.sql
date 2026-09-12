
CREATE OR REPLACE FUNCTION forbid_physical_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.demo_purge', true) = 'yes' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'PHYSICAL_DELETE_FORBIDDEN: records cannot be deleted from table %; users and units must be deactivated, and activities must be cancelled',
    TG_TABLE_NAME;
END;
$$;
