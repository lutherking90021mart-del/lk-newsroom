-- LK Newsroom live-news migration. Run AFTER supabase/schema.sql.
create table if not exists public.news_sources (
  id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null,
  source_type text not null check(source_type in ('rss','api')), feed_url text, api_endpoint text, api_secret_name text,
  country text not null default 'International', default_category text not null default 'General', enabled boolean not null default false,
  last_synced_at timestamptz, last_status text check(last_status in ('success','error','idle')), last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.authors (
  id uuid primary key default gen_random_uuid(), source_id uuid references public.news_sources(id) on delete cascade,
  name text not null, slug text not null, profile_url text, avatar_url text, created_at timestamptz not null default now(), unique(source_id,name)
);
alter table public.articles add column if not exists source_id uuid references public.news_sources(id) on delete set null;
alter table public.articles add column if not exists external_id text;
alter table public.articles add column if not exists external_author_id uuid references public.authors(id) on delete set null;
alter table public.articles add column if not exists original_url text;
alter table public.articles add column if not exists country text;
alter table public.articles add column if not exists source_updated_at timestamptz;
alter table public.articles add column if not exists content_hash text;
alter table public.articles add column if not exists ai_summary text;
alter table public.articles add column if not exists auto_tags text[] not null default '{}';
alter table public.articles add column if not exists is_aggregated boolean not null default false;
alter table public.articles add column if not exists duplicate_of uuid references public.articles(id) on delete set null;
alter table public.articles add column if not exists raw_payload jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='articles_source_external_unique') then
    drop index if exists public.articles_source_external_unique;
    alter table public.articles add constraint articles_source_external_unique unique(source_id,external_id);
  end if;
end $$;
create index if not exists articles_content_hash_idx on public.articles(content_hash);
create index if not exists articles_live_filter_idx on public.articles(is_aggregated,status,published_at desc);

alter table public.breaking_news add column if not exists article_id uuid references public.articles(id) on delete cascade;
alter table public.breaking_news add column if not exists source_id uuid references public.news_sources(id) on delete set null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='breaking_article_unique') then
    drop index if exists public.breaking_article_unique;
    alter table public.breaking_news add constraint breaking_article_unique unique(article_id);
  end if;
end $$;
create table if not exists public.trending_news (
  id uuid primary key default gen_random_uuid(), article_id uuid not null unique references public.articles(id) on delete cascade,
  score numeric not null default 0, rank integer not null, calculated_at timestamptz not null default now()
);
create table if not exists public.featured_news (
  id uuid primary key default gen_random_uuid(), article_id uuid not null unique references public.articles(id) on delete cascade,
  rank integer not null default 1, active boolean not null default true, starts_at timestamptz not null default now(), ends_at timestamptz
);
create table if not exists public.live_updates (
  id uuid primary key default gen_random_uuid(), article_id uuid unique references public.articles(id) on delete cascade,
  title text not null, body text, kind text not null default 'news' check(kind in ('news','breaking','correction')),
  pinned boolean not null default false, published_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table if not exists public.feed_logs (
  id bigint generated always as identity primary key, source_id uuid references public.news_sources(id) on delete set null,
  level text not null check(level in ('info','error','warning')), event text not null, details jsonb not null default '{}'::jsonb,
  duration_ms integer, created_at timestamptz not null default now()
);
create index if not exists feed_logs_source_created_idx on public.feed_logs(source_id,created_at desc);

-- One durable run record per scheduler invocation. Service-role workers write these rows;
-- staff can read them in the Admin Dashboard.
alter table public.news_sources add column if not exists consecutive_failures integer not null default 0;
alter table public.news_sources add column if not exists last_alerted_at timestamptz;
create table if not exists public.worker_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check(trigger in ('cron','manual','startup','vercel','railway','render','vps')),
  status text not null check(status in ('running','completed','failed')),
  started_at timestamptz not null default now(), completed_at timestamptz,
  fetched integer not null default 0, added integer not null default 0, updated integer not null default 0,
  skipped integer not null default 0, errors integer not null default 0,
  error text, details jsonb not null default '{}'::jsonb
);
create index if not exists worker_runs_started_idx on public.worker_runs(started_at desc);
create table if not exists public.worker_locks (
  lock_name text primary key, locked_at timestamptz not null default now(), locked_until timestamptz not null default now()
);

-- The database lease is shared by Vercel/Railway/Render/VPS and prevents overlapping
-- processes from fetching or writing the same feeds at the same time.
-- Drop the earlier parameter names so this migration can safely repair existing installs.
drop function if exists public.acquire_news_worker_lock(text,integer);
drop function if exists public.release_news_worker_lock(text);
create or replace function public.acquire_news_worker_lock(p_lock_name text, lease_seconds integer default 270)
returns boolean language plpgsql security definer set search_path = public as $$
declare did_acquire boolean;
begin
  insert into public.worker_locks as existing(lock_name,locked_at,locked_until)
  values(p_lock_name,now(),now()+make_interval(secs => greatest(30,least(lease_seconds,900))))
  on conflict(lock_name) do update set locked_at=now(),locked_until=now()+make_interval(secs => greatest(30,least(lease_seconds,900)))
  where existing.locked_until < now()
  returning true into did_acquire;
  return coalesce(did_acquire,false);
end;
$$;
create or replace function public.release_news_worker_lock(p_lock_name text)
returns boolean language plpgsql security definer set search_path = public as $$
declare did_release boolean;
begin
  update public.worker_locks set locked_until=now() where worker_locks.lock_name=p_lock_name returning true into did_release;
  return coalesce(did_release,false);
end;
$$;
revoke all on function public.acquire_news_worker_lock(text,integer) from public;
revoke all on function public.release_news_worker_lock(text) from public;

drop trigger if exists set_news_sources_updated_at on public.news_sources;
create trigger set_news_sources_updated_at before update on public.news_sources for each row execute function public.set_updated_at();
alter table public.news_sources enable row level security; alter table public.authors enable row level security;
alter table public.trending_news enable row level security; alter table public.featured_news enable row level security;
alter table public.live_updates enable row level security; alter table public.feed_logs enable row level security;
alter table public.worker_runs enable row level security; alter table public.worker_locks enable row level security;
drop policy if exists "sources public read" on public.news_sources; create policy "sources public read" on public.news_sources for select using(true);
drop policy if exists "sources staff write" on public.news_sources; create policy "sources staff write" on public.news_sources for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "authors public read" on public.authors; create policy "authors public read" on public.authors for select using(true);
drop policy if exists "authors staff write" on public.authors; create policy "authors staff write" on public.authors for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "trending public read" on public.trending_news; create policy "trending public read" on public.trending_news for select using(true);
drop policy if exists "trending staff write" on public.trending_news; create policy "trending staff write" on public.trending_news for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "featured public read" on public.featured_news; create policy "featured public read" on public.featured_news for select using(active or public.is_staff());
drop policy if exists "featured staff write" on public.featured_news; create policy "featured staff write" on public.featured_news for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "live public read" on public.live_updates; create policy "live public read" on public.live_updates for select using(true);
drop policy if exists "live staff write" on public.live_updates; create policy "live staff write" on public.live_updates for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "logs staff read" on public.feed_logs; create policy "logs staff read" on public.feed_logs for select using(public.is_staff());
drop policy if exists "worker runs staff read" on public.worker_runs; create policy "worker runs staff read" on public.worker_runs for select using(public.is_staff());

-- Realtime drives browser-side new-story and breaking-alert notifications.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='articles') then execute 'alter publication supabase_realtime add table public.articles'; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='breaking_news') then execute 'alter publication supabase_realtime add table public.breaking_news'; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_updates') then execute 'alter publication supabase_realtime add table public.live_updates'; end if;
  end if;
end $$;
