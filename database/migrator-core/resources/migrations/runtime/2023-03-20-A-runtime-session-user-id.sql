ALTER TABLE runtime_sessions ADD COLUMN user_id text;

CREATE INDEX runtime_sessions_user_id_idx ON runtime_sessions(user_id) WHERE user_id IS NOT NULL;

