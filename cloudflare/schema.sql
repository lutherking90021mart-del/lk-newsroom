PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  colour TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS news_sources (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'rss',
  feed_url TEXT,
  api_endpoint TEXT,
  api_secret_name TEXT,
  country TEXT NOT NULL DEFAULT 'International',
  default_category TEXT NOT NULL DEFAULT 'World',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_status TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  profile_url TEXT,
  avatar_url TEXT,
  created_at TEXT,
  UNIQUE(source_id, name)
);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT,
  content_markdown TEXT,
  ai_summary TEXT,
  featured_image_url TEXT,
  original_url TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  featured INTEGER NOT NULL DEFAULT 0,
  breaking INTEGER NOT NULL DEFAULT 0,
  allow_comments INTEGER NOT NULL DEFAULT 1,
  scheduled_at TEXT,
  published_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  meta_title TEXT,
  meta_description TEXT,
  canonical_url TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  category_id TEXT,
  author_id TEXT,
  source_id TEXT,
  external_id TEXT,
  external_author_id TEXT,
  country TEXT,
  source_updated_at TEXT,
  content_hash TEXT,
  auto_tags TEXT NOT NULL DEFAULT '[]',
  is_aggregated INTEGER NOT NULL DEFAULT 0,
  duplicate_of TEXT
);
CREATE INDEX IF NOT EXISTS idx_articles_public_published ON articles(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category_published ON articles(category_id, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source_published ON articles(source_id, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_hash ON articles(content_hash);
CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);

CREATE TABLE IF NOT EXISTS article_tags (
  article_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY(article_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag_id);

CREATE TABLE IF NOT EXISTS breaking_news (
  id TEXT PRIMARY KEY,
  article_id TEXT,
  source_id TEXT,
  headline TEXT NOT NULL,
  link_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  pinned INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(article_id)
);
CREATE TABLE IF NOT EXISTS live_updates (
  id TEXT PRIMARY KEY,
  article_id TEXT UNIQUE,
  title TEXT NOT NULL,
  body TEXT,
  kind TEXT NOT NULL DEFAULT 'news',
  pinned INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS trending_news (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL UNIQUE,
  score REAL NOT NULL DEFAULT 0,
  rank INTEGER NOT NULL,
  calculated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS featured_news (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL UNIQUE,
  rank INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT NOT NULL,
  ends_at TEXT
);
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  video_url TEXT,
  youtube_url TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  article_id TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  published_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS gallery (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  caption TEXT,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  article_id TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  sort_order INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  user_id TEXT,
  parent_id TEXT,
  display_name TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_public ON comments(article_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS newsletter (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'subscribed',
  source TEXT DEFAULT 'website',
  created_at TEXT,
  unsubscribed_at TEXT
);
CREATE TABLE IF NOT EXISTS advertisements (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  placement TEXT NOT NULL,
  image_url TEXT,
  target_url TEXT,
  html_content TEXT,
  title TEXT,
  description TEXT,
  ad_type TEXT NOT NULL DEFAULT 'direct',
  adsense_slot TEXT,
  popup_delay_seconds INTEGER NOT NULL DEFAULT 8,
  display_frequency TEXT NOT NULL DEFAULT 'session',
  status TEXT NOT NULL DEFAULT 'active',
  price REAL,
  currency TEXT DEFAULT 'GHS',
  campaign_goal TEXT,
  mobile_sticky INTEGER NOT NULL DEFAULT 0,
  advertiser_id TEXT,
  advertiser_request_id TEXT,
  starts_at TEXT,
  ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '{}',
  is_public INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  visitor_id TEXT,
  page_url TEXT,
  page_title TEXT,
  article_id TEXT,
  category_id TEXT,
  country TEXT,
  city TEXT,
  device TEXT,
  browser TEXT,
  operating_system TEXT,
  source TEXT,
  search_keyword TEXT,
  scroll_depth INTEGER,
  duration_seconds INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC);
CREATE TABLE IF NOT EXISTS worker_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  fetched INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_worker_runs_started ON worker_runs(started_at DESC);
CREATE TABLE IF NOT EXISTS worker_locks (
  lock_name TEXT PRIMARY KEY,
  locked_until TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feed_logs (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_logs_created ON feed_logs(created_at DESC);

-- Stable source IDs used for newly discovered articles. Existing imported sources are
-- mapped to these slugs by the importer so source joins remain valid.
INSERT OR IGNORE INTO news_sources
(id, slug, name, source_type, feed_url, country, default_category, enabled, created_at, updated_at)
VALUES
('joynews','joynews','JoyNews','rss','https://www.myjoyonline.com/feed/','Ghana','Ghana',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('citi-newsroom','citi-newsroom','Citi Newsroom','rss','https://www.citinewsroom.com/rss/topstories.rss','Ghana','Ghana',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('ghanaweb','ghanaweb','GhanaWeb','rss','https://www.ghanaweb.com/GhanaHomePage/NewsArchive/rss.xml','Ghana','Ghana',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('tv3-ghana','tv3-ghana','3News / TV3 Ghana','rss','https://3news.com/feed/','Ghana','Ghana',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('adom-online','adom-online','Adom Online','rss','https://www.adomonline.com/feed/','Ghana','Ghana',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('bbc-news','bbc-news','BBC News','rss','https://feeds.bbci.co.uk/news/rss.xml','United Kingdom','World',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('bbc-sport','bbc-sport','BBC Sport Football','rss','https://feeds.bbci.co.uk/sport/football/rss.xml','United Kingdom','Sports',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('al-jazeera','al-jazeera','Al Jazeera','rss','https://www.aljazeera.com/xml/rss/all.xml','Qatar','World',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('africanews','africanews','Africanews','rss','https://www.africanews.com/feed/rss','Africa','Africa',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('news24','news24','News24','rss','https://feeds.24.com/articles/news24/topstories/rss','South Africa','Africa',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
