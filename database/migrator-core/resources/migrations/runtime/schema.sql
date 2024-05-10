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
                               debug boolean default false,
                               session_id text);
CREATE INDEX background_tasks_idx ON background_tasks (id);

-- Session records

-- TODO this should really be called 'app_sessions' but that name is taken until we do the Log Reorganise
CREATE TABLE runtime_sessions (
  session_id text primary key, -- Yes this is not the same thing as the "session_id" in the app_sessions table which should really be called app_log_sessions, I apologise to all of you
  state text,
  user_id text,
  last_seen timestamp without time zone,
  expires timestamp without time zone
);
-- TODO the user_id column is a special-case for the Users service, and when we move beyond Postgres 10
-- we will be able to expand this into a general purpose JSONB column with a GIN index
CREATE INDEX runtime_sessions_user_id_idx ON runtime_sessions(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE anvil_config (
  key text primary key,
  value jsonb
);

-- This central sequence is used to get IDs for all app tables on all DBs

CREATE SEQUENCE app_storage_tables_id_seq;

--[GRANTS]--
ALTER USER $ANVIL_USER WITH CREATEROLE;

GRANT ALL ON background_tasks, scheduled_tasks, runtime_sessions, anvil_config TO $ANVIL_USER;
GRANT USAGE ON app_storage_tables_id_seq TO $ANVIL_USER;
--[/GRANTS]--
