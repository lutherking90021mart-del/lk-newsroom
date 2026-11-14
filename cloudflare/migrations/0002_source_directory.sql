-- LK Newsroom source directory upgrade for Cloudflare D1 / SQLite.
-- Apply once to the existing lk-newsroom-db after the current schema is installed.
-- Ghana priority publishers are deliberately paused until feed access and reuse rights are verified.

ALTER TABLE news_sources ADD COLUMN publisher_website TEXT;
ALTER TABLE news_sources ADD COLUMN coverage_region TEXT NOT NULL DEFAULT 'International';
ALTER TABLE news_sources ADD COLUMN parent_network TEXT;
ALTER TABLE news_sources ADD COLUMN editorial_priority INTEGER NOT NULL DEFAULT 3;
ALTER TABLE news_sources ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE news_sources ADD COLUMN permission_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE news_sources ADD COLUMN editorial_notes TEXT;
ALTER TABLE news_sources ADD COLUMN last_verified_at TEXT;

INSERT INTO news_sources
(id,slug,name,source_type,feed_url,country,default_category,enabled,publisher_website,coverage_region,parent_network,editorial_priority,access_mode,permission_status,editorial_notes,created_at,updated_at)
VALUES
('joynews','joynews','JoyNews / MyJoyOnline','rss','https://www.myjoyonline.com/feed/','Ghana','Ghana',0,'https://www.myjoyonline.com/','West Africa','Multimedia Group Limited',1,'manual','pending','One source family. Do not count JoyNews and MyJoyOnline as independent corroboration. Confirm publisher-authorised feed access.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('yen-com-gh','yen-com-gh','YEN.com.gh','rss',NULL,'Ghana','Ghana',0,'https://yen.com.gh/','West Africa','Legit (GMEM)',1,'manual','pending','High-priority Ghana digital publisher. Confirm official feed/API access and permitted use.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('graphic-online','graphic-online','Graphic Online','rss',NULL,'Ghana','Ghana',0,'https://www.graphic.com.gh/','West Africa','Graphic Communications Group Limited',1,'manual','pending','Confirm RSS/API terms and permitted reuse before enabling.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('citi-newsroom','citi-newsroom','Citi Newsroom','rss',NULL,'Ghana','Ghana',0,'https://citinewsroom.com/','West Africa','Omni Media Limited',1,'manual','pending','Confirm feed endpoint and permitted use.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('ghanaweb','ghanaweb','GhanaWeb','rss',NULL,'Ghana','Ghana',0,'https://www.ghanaweb.com/','West Africa',NULL,1,'manual','pending','Confirm current official feed and reuse terms.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('3news','3news','3News','rss',NULL,'Ghana','Ghana',0,'https://3news.com/','West Africa','Media General Ghana',1,'manual','pending','Confirm official feed/API terms.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('gbc-ghana','gbc-ghana','GBC Ghana','rss',NULL,'Ghana','Ghana',0,'https://www.gbcghanaonline.com/','West Africa','Ghana Broadcasting Corporation',1,'manual','pending','Prioritise public-interest and regional reporting; confirm feed permissions.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('ghana-news-agency','ghana-news-agency','Ghana News Agency (GNA)','rss',NULL,'Ghana','Ghana',0,'https://gna.org.gh/','West Africa','Ghana News Agency',1,'manual','pending','Seek syndication/licensing agreement before republishing agency copy.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(slug) DO UPDATE SET
  name=excluded.name,
  publisher_website=excluded.publisher_website,
  coverage_region=excluded.coverage_region,
  parent_network=excluded.parent_network,
  editorial_priority=excluded.editorial_priority,
  editorial_notes=excluded.editorial_notes,
  enabled=CASE WHEN news_sources.permission_status='approved' THEN news_sources.enabled ELSE 0 END,
  feed_url=CASE WHEN news_sources.permission_status='approved' THEN news_sources.feed_url ELSE excluded.feed_url END,
  updated_at=CURRENT_TIMESTAMP;

-- Retire the duplicate MyJoyOnline record; use the combined JoyNews/MyJoyOnline family.
UPDATE news_sources
SET enabled=0,
    editorial_notes='Retired duplicate source record; use the JoyNews / MyJoyOnline source family instead.',
    updated_at=CURRENT_TIMESTAMP
WHERE slug='myjoyonline';

-- Retire the old TV3 slug so the normalized 3News source does not double-ingest.
UPDATE news_sources SET enabled=0, feed_url=NULL,
  editorial_notes='Retired legacy source slug; use the 3News source record after feed permission is confirmed.',
  updated_at=CURRENT_TIMESTAMP WHERE slug='tv3-ghana';

-- Africanews and News24 remain expansion candidates, not yet permission-verified.
UPDATE news_sources SET enabled=0, feed_url=NULL, access_mode='manual', permission_status='pending',
  publisher_website=CASE WHEN slug='africanews' THEN 'https://www.africanews.com/' ELSE 'https://www.news24.com/' END,
  coverage_region='Africa', editorial_priority=2,
  editorial_notes='Africa-wide expansion candidate. Verify publisher feed access, terms and permitted reuse before enabling.',
  updated_at=CURRENT_TIMESTAMP WHERE slug IN ('africanews','news24') AND COALESCE(permission_status,'pending') <> 'approved';

CREATE INDEX IF NOT EXISTS idx_news_sources_priority
ON news_sources(editorial_priority,country,enabled);
