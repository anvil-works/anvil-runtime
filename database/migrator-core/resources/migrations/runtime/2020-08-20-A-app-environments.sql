ALTER TABLE scheduled_tasks ALTER COLUMN app_id DROP NOT NULL;
ALTER TABLE background_tasks ALTER COLUMN app_id DROP NOT NULL;
