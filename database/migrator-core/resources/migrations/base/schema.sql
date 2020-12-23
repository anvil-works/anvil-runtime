-- This is the schema that will set up a new Postgres database for an Anvil server
-- (central or dedicated)
-- DO NOT run this to upgrade an existing server. Obviously.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_storage_tables (id integer primary key, 
                                 name text NOT NULL, 
                                 columns jsonb NOT NULL DEFAULT '{}');

CREATE TABLE app_storage_access (table_id integer references app_storage_tables(id), 
                                 python_name text NOT NULL, 
                                 server text not null, 
                                 client text not null);

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
                                column_id text);
CREATE INDEX app_storage_media_object_id_uindex ON app_storage_media (object_id);

CREATE OR REPLACE FUNCTION parse_anvil_timestamp(ts text) RETURNS timestamptz AS $$
BEGIN
  return replace(regexp_replace(ts, '.(\d\d\d\d)$', ''), 'A', ' ')::timestamptz;
END$$
  LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION to_anvil_timestamp(ts timestamptz) RETURNS text AS $$
BEGIN
  return to_char(ts, 'YYYY-MM-DDAHH24:MI:SS.US+0000');
END$$
  LANGUAGE plpgsql;

CREATE TABLE db_version (version text not null, updated timestamp);

--[GRANTS]--
GRANT SELECT ON db_version TO $ANVIL_USER;
GRANT EXECUTE ON FUNCTION parse_anvil_timestamp TO $ANVIL_USER;
GRANT EXECUTE ON FUNCTION to_anvil_timestamp TO $ANVIL_USER;

GRANT ALL ON app_storage_tables, app_storage_access, app_storage_data, app_storage_media, app_storage_data_id_seq TO $ANVIL_USER;
GRANT SELECT ON pg_largeobject TO $ANVIL_USER; -- To measure the size of Media objects
--[/GRANTS]--
