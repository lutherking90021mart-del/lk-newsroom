-- Preserve the legacy CMS markdown field for imported articles.
ALTER TABLE articles ADD COLUMN content_markdown TEXT;

-- Additional application tables for the LK Newsroom Cloudflare migration.
-- Run after schema.sql. Historical high-volume event/log tables are intentionally
-- excluded from the first D1 data import and should be archived to R2 separately.

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  bio TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS users_roles (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'journalist',
  assigned_at TEXT
);

CREATE TABLE IF NOT EXISTS social_templates (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_slug TEXT NOT NULL DEFAULT 'latest',
  accent_color TEXT NOT NULL DEFAULT '#E31E24',
  background_color TEXT NOT NULL DEFAULT '#003366',
  font_family TEXT NOT NULL DEFAULT 'Arial, Helvetica, sans-serif',
  background_url TEXT,
  text_position TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS social_graphics (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL UNIQUE,
  template_id TEXT,
  source_image_url TEXT,
  assets TEXT NOT NULL DEFAULT '{}',
  generated_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS social_accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  display_name TEXT NOT NULL,
  account_id TEXT NOT NULL,
  credential_key TEXT,
  credentials_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  auto_post INTEGER NOT NULL DEFAULT 1,
  category_slugs TEXT NOT NULL DEFAULT '[]',
  posting_delay_minutes INTEGER NOT NULL DEFAULT 0,
  post_template TEXT,
  auto_post_from TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  last_success_at TEXT,
  last_error TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(platform, account_id)
);
CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  post_text TEXT NOT NULL,
  article_url TEXT NOT NULL,
  image_url TEXT,
  scheduled_for TEXT,
  locked_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT,
  platform_post_id TEXT,
  platform_post_url TEXT,
  last_error TEXT,
  posted_at TEXT,
  click_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(account_id, article_id)
);
CREATE INDEX IF NOT EXISTS idx_social_posts_due ON social_posts(status, scheduled_for, next_attempt_at);

CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email TEXT NOT NULL UNIQUE,
  push_token TEXT,
  push_endpoint TEXT,
  push_subscription TEXT NOT NULL DEFAULT '{}',
  phone TEXT,
  preferences TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'website',
  active INTEGER NOT NULL DEFAULT 1,
  confirmed_at TEXT,
  last_delivered_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS daily_briefs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  articles TEXT NOT NULL DEFAULT '[]',
  sent_date TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_for TEXT,
  sent_at TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  subscription_id TEXT,
  user_id TEXT,
  article_id TEXT,
  daily_brief_id TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'news',
  url TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT UNIQUE,
  read_status INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_for TEXT,
  sent_at TEXT,
  provider_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT,
  locked_at TEXT,
  last_error TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(notification_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due ON notification_deliveries(status, scheduled_for, next_attempt_at);
CREATE TABLE IF NOT EXISTS notification_campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'manual',
  url TEXT,
  audience_preferences TEXT NOT NULL DEFAULT '[]',
  category_slugs TEXT NOT NULL DEFAULT '[]',
  channels TEXT NOT NULL DEFAULT '["push","email"]',
  scheduled_for TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_by TEXT,
  sent_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS advertisers (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS advertising_packages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  placement TEXT NOT NULL DEFAULT 'homepage-sidebar',
  price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GHS',
  duration_days INTEGER NOT NULL DEFAULT 30,
  features TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS advertiser_requests (
  id TEXT PRIMARY KEY,
  advertiser_id TEXT,
  package_id TEXT,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  advertisement_type TEXT NOT NULL DEFAULT 'display',
  requested_placement TEXT,
  budget REAL,
  currency TEXT NOT NULL DEFAULT 'GHS',
  campaign_duration_days INTEGER,
  campaign_goal TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  quoted_price REAL,
  admin_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS sponsored_article_details (
  article_id TEXT PRIMARY KEY,
  sponsor_name TEXT NOT NULL,
  sponsor_logo_url TEXT,
  sponsor_url TEXT,
  campaign_details TEXT,
  paid_amount REAL,
  currency TEXT NOT NULL DEFAULT 'GHS',
  campaign_starts_at TEXT,
  campaign_ends_at TEXT,
  click_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS affiliate_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  advertiser_name TEXT,
  description TEXT,
  default_commission_rate REAL,
  status TEXT NOT NULL DEFAULT 'active',
  starts_at TEXT,
  ends_at TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS affiliate_links (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  title TEXT NOT NULL,
  product_name TEXT,
  destination_url TEXT NOT NULL,
  tracking_code TEXT NOT NULL UNIQUE,
  commission_rate REAL,
  commission_amount REAL,
  currency TEXT NOT NULL DEFAULT 'GHS',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS affiliate_events (
  id TEXT PRIMARY KEY,
  affiliate_link_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  session_id TEXT,
  order_reference TEXT,
  commission_earned REAL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  plan_id TEXT,
  plan TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subscription_id TEXT,
  provider_reference TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GHS',
  status TEXT NOT NULL DEFAULT 'pending',
  start_date TEXT,
  end_date TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  donor_name TEXT,
  donor_email TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GHS',
  provider TEXT NOT NULL,
  provider_reference TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS payment_transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  email TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GHS',
  donation_id TEXT,
  subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'initiated',
  provider_response TEXT NOT NULL DEFAULT '{}',
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS revenue (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  type TEXT NOT NULL DEFAULT 'estimated',
  status TEXT NOT NULL DEFAULT 'pending',
  date TEXT NOT NULL,
  advertisement_id TEXT,
  article_id TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS company_enquiries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT 'General enquiry',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  admin_notes TEXT,
  handled_by TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS company_staff_profiles (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  work_email TEXT,
  work_phone TEXT,
  photo_url TEXT,
  biography TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);



-- Cloudflare-native admin accounts and sessions. Supabase password/session rows are
-- intentionally not imported; existing staff must enrol with new passwords.
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 150000,
  role TEXT NOT NULL DEFAULT 'journalist' CHECK(role IN ('super_admin','admin','editor','journalist','moderator')),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role, active);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id, expires_at);
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  successful INTEGER NOT NULL DEFAULT 0,
  attempted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_recent ON admin_login_attempts(email, successful, attempted_at);

-- Keep the legacy page-views view/report screen functioning; historical rows remain archived.
CREATE TABLE IF NOT EXISTS page_views (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  visitor_hash TEXT,
  country TEXT,
  device TEXT,
  browser TEXT,
  traffic_source TEXT,
  viewed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_page_views_viewed_at ON page_views(viewed_at DESC);

CREATE TABLE IF NOT EXISTS membership_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  features TEXT NOT NULL DEFAULT '[]',
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GHS',
  interval TEXT NOT NULL DEFAULT 'monthly',
  paystack_plan_code TEXT,
  stripe_price_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  created_at TEXT,
  PRIMARY KEY(user_id, article_id)
);
CREATE TABLE IF NOT EXISTS article_likes (
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  created_at TEXT,
  PRIMARY KEY(user_id, article_id)
);

ALTER TABLE advertisements ADD COLUMN title TEXT;
ALTER TABLE advertisements ADD COLUMN description TEXT;
ALTER TABLE advertisements ADD COLUMN ad_type TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE advertisements ADD COLUMN adsense_slot TEXT;
ALTER TABLE advertisements ADD COLUMN popup_delay_seconds INTEGER NOT NULL DEFAULT 8;
ALTER TABLE advertisements ADD COLUMN display_frequency TEXT NOT NULL DEFAULT 'session';
ALTER TABLE advertisements ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE advertisements ADD COLUMN price REAL;
ALTER TABLE advertisements ADD COLUMN currency TEXT DEFAULT 'GHS';
ALTER TABLE advertisements ADD COLUMN campaign_goal TEXT;
ALTER TABLE advertisements ADD COLUMN mobile_sticky INTEGER NOT NULL DEFAULT 0;
ALTER TABLE advertisements ADD COLUMN advertiser_id TEXT;
ALTER TABLE advertisements ADD COLUMN advertiser_request_id TEXT;

