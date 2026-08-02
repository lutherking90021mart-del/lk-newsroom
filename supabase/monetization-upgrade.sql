-- LK Newsroom revenue, advertiser and analytics upgrade.
-- Run this once in the Supabase SQL Editor AFTER schema.sql and admin-cms-upgrade.sql.
-- It is additive: existing advertisements and page views are preserved.

create table if not exists public.advertisers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.advertisements
  add column if not exists advertiser_id uuid references public.advertisers(id) on delete set null,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists ad_type text not null default 'direct' check (ad_type in ('direct','adsense','sponsored')),
  add column if not exists adsense_slot text,
  add column if not exists popup_delay_seconds integer not null default 8 check (popup_delay_seconds between 0 and 120),
  add column if not exists display_frequency text not null default 'session' check (display_frequency in ('always','session','day')),
  add column if not exists status text not null default 'active' check (status in ('draft','active','paused','expired'));

update public.advertisements
set title=coalesce(nullif(title,''),name),
    status=case when active then 'active' else 'paused' end
where title is null or title='' or status is null or (status='active' and not active);

create index if not exists advertisements_active_placement_idx on public.advertisements(placement,status,starts_at,ends_at);
create index if not exists advertisements_advertiser_idx on public.advertisements(advertiser_id);

alter table public.page_views
  add column if not exists country text,
  add column if not exists device text,
  add column if not exists browser text,
  add column if not exists traffic_source text,
  add column if not exists user_agent text;
create index if not exists page_views_viewed_at_idx on public.page_views(viewed_at desc);
create index if not exists page_views_country_idx on public.page_views(country);

create or replace function public.advertisement_ctr(ad_uuid uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select case when impressions=0 then 0 else round((clicks::numeric / impressions::numeric) * 100, 2) end
  from public.advertisements where id=ad_uuid;
$$;
grant execute on function public.advertisement_ctr(uuid) to authenticated;

alter table public.advertisers enable row level security;
drop policy if exists "staff advertisers read" on public.advertisers;
create policy "staff advertisers read" on public.advertisers for select using(public.is_staff());
drop policy if exists "staff advertisers write" on public.advertisers;
create policy "staff advertisers write" on public.advertisers for all using(public.is_staff()) with check(public.is_staff());

drop trigger if exists set_advertisers_updated_at on public.advertisers;
create trigger set_advertisers_updated_at before update on public.advertisers
for each row execute function public.set_updated_at();

-- Public clients can continue to insert anonymous, privacy-friendly page events.
-- Staff-only select policy from schema.sql protects the raw analytics records.
