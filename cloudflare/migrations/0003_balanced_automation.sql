-- LK Newsroom balanced automation defaults for Cloudflare D1.
-- Apply after 0002_source_directory.sql. This only configures the branch's
-- intended runtime defaults; it does not enable any publisher source.

INSERT INTO settings (key,value,is_public,updated_at)
VALUES (
  'editorial_automation',
  '{"mode":"balanced","social_auto_publish":true,"require_approved_source_permission":true,"max_story_age_hours":36,"hold_sensitive_topics":true}',
  0,
  CURRENT_TIMESTAMP
)
ON CONFLICT(key) DO NOTHING;
