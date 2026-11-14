-- LK Newsroom balanced automation defaults for Cloudflare D1.
-- Apply after 0002_source_directory.sql. This only configures the branch's
-- intended runtime defaults; it does not enable any publisher source.

INSERT INTO settings (key,value,is_public,updated_at)
VALUES (
  'editorial_automation',
  '{"mode":"balanced"}',
  0,
  CURRENT_TIMESTAMP
)
ON CONFLICT(key) DO NOTHING;
