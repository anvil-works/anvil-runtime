
DO $$
    DECLARE
        seq_start INTEGER;
    BEGIN
        SELECT COALESCE(MAX(object_id), 1000000) * 2 as seq_start FROM app_storage_media INTO seq_start;
        EXECUTE 'CREATE SEQUENCE app_storage_media_object_id_seq START WITH ' || seq_start;
    END $$;

ALTER TABLE app_storage_media ADD COLUMN data bytea;
ALTER TABLE app_storage_media ALTER COLUMN data SET STORAGE EXTERNAL;
ALTER TABLE app_storage_media ALTER COLUMN object_id SET DEFAULT nextval('app_storage_media_object_id_seq');


--[GRANTS]--
GRANT USAGE ON app_storage_media_object_id_seq TO $ANVIL_USER;
--[/GRANTS]--