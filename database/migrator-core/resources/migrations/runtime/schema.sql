-- This is the schema that will set up the rest of a Postgres database
-- for the Anvil runtime.
-- DO NOT run this to upgrade an existing server. Obviously.
-- (That's what the migrator is for.)

-- Cron jobs (this information is a constructed cache of information in app source code)

CREATE TABLE scheduled_tasks (job_id text NOT NULL,
                              task_name text NOT NULL,
                              time_spec jsonb NOT NULL,
                              next_run timestamp without time zone NOT NULL,
                              last_bg_task_id text);
CREATE INDEX scheduled_tasks_app_id_idx ON scheduled_tasks (job_id);

-- Background tasks

CREATE TYPE background_task_status AS ENUM ('completed', 'threw', 'killed', 'mia');

CREATE TABLE background_tasks (id text not null,
                               session bigint,
                               task_name text,
                               routing jsonb,
                               completion_status background_task_status,
                               final_state jsonb,
                               start_time timestamp not null default now(),
                               last_seen_alive timestamp not null default now(),
                               debug boolean default false);
CREATE INDEX background_tasks_idx ON background_tasks (id);

-- This central sequence is used to get IDs for all app tables on all DBs

CREATE SEQUENCE app_storage_tables_id_seq;

-- Schema in which SQL-friendly views will be created

CREATE SCHEMA IF NOT EXISTS data_tables;

--[GRANTS]--
ALTER SCHEMA data_tables OWNER TO $ANVIL_USER;
GRANT CREATE ON DATABASE $ANVIL_DATABASE TO $ANVIL_USER;
ALTER USER $ANVIL_USER WITH CREATEROLE;

GRANT ALL ON background_tasks, scheduled_tasks TO $ANVIL_USER;
GRANT USAGE ON app_storage_tables_id_seq TO $ANVIL_USER;
--[/GRANTS]--
