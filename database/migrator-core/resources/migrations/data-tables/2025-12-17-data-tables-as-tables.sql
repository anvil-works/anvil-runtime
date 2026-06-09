CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE app_storage_tables ADD COLUMN storage JSONB;
ALTER TABLE app_storage_tables ADD COLUMN indexes JSONB;

CREATE TYPE media AS (content_type TEXT, name TEXT, bytes BYTEA);
CREATE TYPE datetime_with_tz AS (utc TIMESTAMP, tz TEXT);
