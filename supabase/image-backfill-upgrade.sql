-- LK Newsroom automatic image-backfill upgrade.
-- Run once in Supabase SQL Editor. It records checks and publisher context links for image candidates.
alter table public.articles
  add column if not exists image_search_checked_at timestamptz,
  add column if not exists image_attribution_url text;
create index if not exists articles_missing_image_backfill_idx
  on public.articles(published_at desc)
  where featured_image_url is null and status='published';
