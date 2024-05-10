-- This is the schema that will set up a new Postgres data-tables database for an Anvil server
-- This is required for data tables dbs, dedicated dbs, and combined central dbs. 
-- Central db's being run along side a data tables db, do not include this schema.
-- DO NOT run this to upgrade an existing server.

CREATE TABLE app_storage_tables (id integer primary key, 
                                 name text NOT NULL, 
                                 columns jsonb NOT NULL DEFAULT '{}');

CREATE TABLE app_storage_access (table_id integer references app_storage_tables(id), 
                                 python_name text NOT NULL, 
                                 server text not null, 
                                 client text not null);

ALTER TABLE app_storage_access ADD CONSTRAINT app_storage_access_unique_table_id UNIQUE(table_id);

CREATE TABLE app_storage_data (id serial, 
                               table_id integer references app_storage_tables(id), 
                               data jsonb NOT NULL DEFAULT '{}');
CREATE INDEX app_storage_data_idx ON app_storage_data (table_id,id);
CREATE INDEX app_storage_data_json_idx ON app_storage_data using gin (data jsonb_path_ops);

CREATE TABLE app_storage_media (object_id integer PRIMARY KEY NOT NULL,
                                content_type text,
                                name text,
                                row_id integer,
                                table_id integer,
                                column_id text,
                                data bytea);
CREATE INDEX app_storage_media_object_id_uindex ON app_storage_media (object_id);

DO $$
    DECLARE
        seq_start INTEGER;
    BEGIN
        SELECT COALESCE(MAX(object_id), 1000000) * 2 as seq_start FROM app_storage_media INTO seq_start;
        EXECUTE 'CREATE SEQUENCE app_storage_media_object_id_seq START WITH ' || seq_start;
    END $$;

ALTER TABLE app_storage_media ALTER COLUMN data SET STORAGE EXTERNAL;
ALTER TABLE app_storage_media ALTER COLUMN object_id SET DEFAULT nextval('app_storage_media_object_id_seq');

-- Schema in which SQL-friendly views will be created
CREATE SCHEMA IF NOT EXISTS data_tables;

--[GRANTS]--
ALTER SCHEMA data_tables OWNER TO $ANVIL_USER;
GRANT CREATE ON DATABASE $ANVIL_DATABASE TO $ANVIL_USER;

GRANT USAGE, UPDATE ON app_storage_data_id_seq TO anvil;
GRANT USAGE ON app_storage_media_object_id_seq TO $ANVIL_USER;
GRANT ALL ON app_storage_tables, app_storage_access, app_storage_data, app_storage_media TO anvil;
--[/GRANTS]--