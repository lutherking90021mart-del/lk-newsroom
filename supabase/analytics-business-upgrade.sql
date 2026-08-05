-- LK Newsroom: first-party analytics and business intelligence upgrade.
-- Run this once in Supabase SQL Editor AFTER schema.sql, monetization-upgrade.sql,
-- and social-media-automation.sql. It is additive and does not delete existing data.

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  visitor_id text,
  session_id text not null,
  event_name text not null check (event_name in ('page_view','article_open','scroll_depth','page_exit','social_share','ad_impression','ad_click')),
  page_url text not null,
  page_title text,
  article_id uuid references public.articles(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  country text,
  city text,
  device text,
  browser text,
  operating_system text,
  source text,
  search_keyword text,
  scroll_depth smallint check (scroll_depth is null or scroll_depth between 0 and 100),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_at_idx on public.analytics_events(created_at desc);
create index if not exists analytics_events_session_created_idx on public.analytics_events(session_id,created_at desc);
create index if not exists analytics_events_visitor_created_idx on public.analytics_events(visitor_id,created_at desc);
create index if not exists analytics_events_article_created_idx on public.analytics_events(article_id,created_at desc) where article_id is not null;
create index if not exists analytics_events_page_created_idx on public.analytics_events(page_url,created_at desc);
create index if not exists analytics_events_event_created_idx on public.analytics_events(event_name,created_at desc);

create table if not exists public.advertisement_events (
  id uuid primary key default gen_random_uuid(),
  advertisement_id uuid not null references public.advertisements(id) on delete cascade,
  session_id text,
  event_type text not null check (event_type in ('impression','click')),
  page_url text,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists advertisement_events_created_at_idx on public.advertisement_events(created_at desc);
create index if not exists advertisement_events_ad_created_idx on public.advertisement_events(advertisement_id,created_at desc);

create table if not exists public.revenue (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('adsense','direct_advertisements','sponsored_articles','affiliate_marketing','subscriptions','other')),
  amount numeric(12,2) not null,
  currency text not null default 'USD' check (char_length(currency)=3),
  type text not null default 'estimated' check (type in ('estimated','received','adjustment','refund')),
  status text not null default 'pending' check (status in ('pending','confirmed','paid','void')),
  date date not null default current_date,
  advertisement_id uuid references public.advertisements(id) on delete set null,
  article_id uuid references public.articles(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists revenue_date_idx on public.revenue(date desc);
create index if not exists revenue_source_date_idx on public.revenue(source,date desc);

-- Only the server service role records anonymous analytics. Staff can inspect it;
-- raw visitor-level events are never public through the Supabase client.
alter table public.analytics_events enable row level security;
alter table public.advertisement_events enable row level security;
alter table public.revenue enable row level security;

drop policy if exists "staff view analytics events" on public.analytics_events;
create policy "staff view analytics events" on public.analytics_events for select using(public.is_staff());
drop policy if exists "staff view advertisement events" on public.advertisement_events;
create policy "staff view advertisement events" on public.advertisement_events for select using(public.is_staff());
drop policy if exists "staff manage revenue" on public.revenue;
create policy "staff manage revenue" on public.revenue for all using(public.is_staff()) with check(public.is_staff());

drop trigger if exists set_revenue_updated_at on public.revenue;
create trigger set_revenue_updated_at before update on public.revenue
for each row execute function public.set_updated_at();

-- Optional Realtime publications for staff dashboards. Ignore duplicate-object errors.
do $$ begin
  alter publication supabase_realtime add table public.revenue;
exception when duplicate_object then null; end $$;

-- Keep this data only as long as it is operationally useful. This can be scheduled
-- from Supabase Cron or run manually if your retention policy requires it.
create or replace function public.prune_analytics_events(retain_days integer default 400)
returns integer language plpgsql security definer set search_path=public as $$
declare removed integer;
begin
  delete from public.analytics_events where created_at < now() - make_interval(days => greatest(retain_days,30));
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.prune_analytics_events(integer) from public;
