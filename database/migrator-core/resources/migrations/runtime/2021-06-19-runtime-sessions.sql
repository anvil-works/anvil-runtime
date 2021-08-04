-- TODO this should really be called 'app_sessions' but that name is taken until we do the Log Reorganise
CREATE TABLE runtime_sessions (
  session_id text primary key, -- Yes this is not the same thing as the "session_id" in the app_sessions table which should really be called app_log_sessions, I apologise to all of you
  state text,
  last_seen timestamp without time zone
);

--[GRANTS]--
GRANT ALL ON runtime_sessions TO $ANVIL_USER;
--[/GRANTS]--
