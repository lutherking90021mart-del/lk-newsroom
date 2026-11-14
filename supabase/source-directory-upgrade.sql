-- LK Newsroom Ghana-first source directory upgrade.
-- Run AFTER supabase/live-news.sql. New publisher records are disabled
-- until the newsroom verifies feed access/terms and configures a server-side URL.
alter table public.news_sources add column if not exists publisher_website text;
alter table public.news_sources add column if not exists coverage_region text not null default 'International';
alter table public.news_sources add column if not exists parent_network text;
alter table public.news_sources add column if not exists editorial_priority smallint not null default 3 check (editorial_priority between 1 and 5);
alter table public.news_sources add column if not exists access_mode text not null default 'manual' check (access_mode in ('rss','api','licensed','manual'));
alter table public.news_sources add column if not exists permission_status text not null default 'pending' check (permission_status in ('pending','approved','restricted'));
alter table public.news_sources add column if not exists editorial_notes text;
alter table public.news_sources add column if not exists last_verified_at timestamptz;

insert into public.news_sources
  (slug,name,source_type,feed_url,country,default_category,enabled,publisher_website,coverage_region,parent_network,editorial_priority,access_mode,permission_status,editorial_notes)
values
  ('joynews','JoyNews / MyJoyOnline','rss',null,'Ghana','Ghana',false,'https://www.myjoyonline.com/','West Africa','Multimedia Group Limited',1,'manual','pending','One source family: do not count JoyNews and MyJoyOnline as independent corroboration. Confirm publisher-authorised feed access.'),
  ('yen-com-gh','YEN.com.gh','rss',null,'Ghana','Ghana',false,'https://yen.com.gh/','West Africa','Legit (GMEM)',1,'manual','pending','High-priority Ghana digital publisher. Confirm official feed/API access and permitted use before enabling.'),
  ('graphic-online','Graphic Online','rss',null,'Ghana','Ghana',false,'https://www.graphic.com.gh/','West Africa','Graphic Communications Group Limited',1,'manual','pending','High-priority national newspaper. Confirm RSS/API terms and permitted reuse.'),
  ('citi-newsroom','Citi Newsroom','rss',null,'Ghana','Ghana',false,'https://citinewsroom.com/','West Africa','Omni Media Limited',1,'manual','pending','High-priority radio/digital newsroom. Confirm feed endpoint and permitted use.'),
  ('ghanaweb','GhanaWeb','rss',null,'Ghana','Ghana',false,'https://www.ghanaweb.com/','West Africa',null,1,'manual','pending','High-priority digital publisher. Confirm current official feed and reuse terms.'),
  ('3news','3News','rss',null,'Ghana','Ghana',false,'https://3news.com/','West Africa','Media General Ghana',1,'manual','pending','High-priority broadcaster/digital newsroom. Confirm official feed/API terms.'),
  ('gbc-ghana','GBC Ghana','rss',null,'Ghana','Ghana',false,'https://www.gbcghanaonline.com/','West Africa','Ghana Broadcasting Corporation',1,'manual','pending','Public-service broadcaster. Prioritise public-interest and regional reporting; confirm feed permissions.'),
  ('ghana-news-agency','Ghana News Agency (GNA)','rss',null,'Ghana','Ghana',false,'https://gna.org.gh/','West Africa','Ghana News Agency',1,'manual','pending','News agency with national/regional coverage. Seek a syndication/licensing agreement before republishing agency copy.')
on conflict (slug) do update set
  name=excluded.name, publisher_website=excluded.publisher_website,
  coverage_region=excluded.coverage_region, parent_network=excluded.parent_network,
  editorial_priority=excluded.editorial_priority, access_mode=excluded.access_mode,
  permission_status=case when public.news_sources.permission_status='approved' then public.news_sources.permission_status else excluded.permission_status end,
  editorial_notes=excluded.editorial_notes,
  enabled=case when public.news_sources.permission_status='approved' then public.news_sources.enabled else false end,
  feed_url=case when public.news_sources.permission_status='approved' then public.news_sources.feed_url else null end,
  updated_at=now();

-- Retire the duplicate MyJoyOnline source record; use the combined source family.
update public.news_sources set enabled=false,
  editorial_notes='Retired duplicate source record; use the JoyNews / MyJoyOnline source family instead.',
  updated_at=now() where slug='myjoyonline';

create index if not exists news_sources_priority_idx on public.news_sources(editorial_priority,country,enabled);
