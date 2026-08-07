-- LK Newsroom complete monetisation suite.
-- Run once in the Supabase SQL Editor after schema.sql, monetization-upgrade.sql,
-- analytics-business-upgrade.sql and social-media-automation.sql.
-- This migration is additive: it preserves all existing advertisements and revenue.

create table if not exists public.advertising_packages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text,
  placement text not null default 'homepage-sidebar',
  price numeric(12,2) not null default 0 check (price >= 0),
  currency text not null default 'GHS' check (char_length(currency) = 3),
  duration_days integer not null default 30 check (duration_days between 1 and 366),
  features jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.advertiser_requests (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid references public.advertisers(id) on delete set null,
  package_id uuid references public.advertising_packages(id) on delete set null,
  company_name text not null,
  contact_name text,
  email text not null,
  phone text,
  website text,
  advertisement_type text not null default 'display',
  requested_placement text,
  budget numeric(12,2) check (budget is null or budget >= 0),
  currency text not null default 'GHS' check (char_length(currency) = 3),
  campaign_duration_days integer check (campaign_duration_days is null or campaign_duration_days between 1 and 366),
  campaign_goal text,
  message text,
  status text not null default 'pending' check (status in ('pending','quoted','approved','rejected','converted')),
  quoted_price numeric(12,2) check (quoted_price is null or quoted_price >= 0),
  admin_notes text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sponsored_article_details (
  article_id uuid primary key references public.articles(id) on delete cascade,
  sponsor_name text not null,
  sponsor_logo_url text,
  sponsor_url text,
  campaign_details text,
  paid_amount numeric(12,2) check (paid_amount is null or paid_amount >= 0),
  currency text not null default 'GHS' check (char_length(currency) = 3),
  campaign_starts_at timestamptz,
  campaign_ends_at timestamptz,
  click_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  advertiser_name text,
  description text,
  default_commission_rate numeric(7,4) check (default_commission_rate is null or default_commission_rate between 0 and 100),
  status text not null default 'active' check (status in ('draft','active','paused','closed')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.affiliate_campaigns(id) on delete set null,
  title text not null,
  product_name text,
  destination_url text not null,
  tracking_code text not null unique,
  commission_rate numeric(7,4) check (commission_rate is null or commission_rate between 0 and 100),
  commission_amount numeric(12,2) check (commission_amount is null or commission_amount >= 0),
  currency text not null default 'GHS' check (char_length(currency) = 3),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_events (
  id uuid primary key default gen_random_uuid(),
  affiliate_link_id uuid not null references public.affiliate_links(id) on delete cascade,
  event_type text not null check (event_type in ('click','conversion')),
  session_id text,
  order_reference text,
  commission_earned numeric(12,2) check (commission_earned is null or commission_earned >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  features jsonb not null default '[]'::jsonb,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'GHS' check (char_length(currency) = 3),
  interval text not null default 'monthly' check (interval in ('monthly','yearly','one_time')),
  paystack_plan_code text,
  stripe_price_id text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  plan_id uuid references public.membership_plans(id) on delete set null,
  plan text not null,
  provider text not null check (provider in ('paystack','stripe','manual')),
  provider_subscription_id text,
  provider_reference text unique,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'GHS' check (char_length(currency) = 3),
  status text not null default 'pending' check (status in ('pending','active','past_due','cancelled','expired','failed')),
  start_date timestamptz,
  end_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  donor_name text,
  donor_email text,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'GHS' check (char_length(currency) = 3),
  provider text not null check (provider in ('paystack','stripe','manual')),
  provider_reference text unique,
  message text,
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('donation','subscription')),
  provider text not null check (provider in ('paystack','stripe','manual')),
  reference text not null unique,
  email text,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'GHS' check (char_length(currency) = 3),
  donation_id uuid references public.donations(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  status text not null default 'initiated' check (status in ('initiated','paid','failed','cancelled','refunded')),
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.advertisements add column if not exists price numeric(12,2);
alter table public.advertisements add column if not exists currency text default 'GHS';
alter table public.advertisements add column if not exists campaign_goal text;
alter table public.advertisements add column if not exists mobile_sticky boolean not null default false;
alter table public.advertisements add column if not exists advertiser_request_id uuid references public.advertiser_requests(id) on delete set null;

-- Include donations in the existing financial reporting table without losing its rows.
alter table public.revenue drop constraint if exists revenue_source_check;
alter table public.revenue add constraint revenue_source_check check (source in ('adsense','direct_advertisements','sponsored_articles','affiliate_marketing','subscriptions','donations','other'));
alter table public.revenue add column if not exists donation_id uuid references public.donations(id) on delete set null;
alter table public.revenue add column if not exists affiliate_link_id uuid references public.affiliate_links(id) on delete set null;

create index if not exists advertiser_requests_status_idx on public.advertiser_requests(status,created_at desc);
create index if not exists sponsored_article_details_sponsor_idx on public.sponsored_article_details(sponsor_name);
create index if not exists affiliate_events_link_created_idx on public.affiliate_events(affiliate_link_id,created_at desc);
create index if not exists subscriptions_user_status_idx on public.subscriptions(user_id,status);
create index if not exists donations_status_created_idx on public.donations(status,created_at desc);
create index if not exists payment_transactions_reference_idx on public.payment_transactions(reference);

alter table public.advertising_packages enable row level security;
alter table public.advertiser_requests enable row level security;
alter table public.sponsored_article_details enable row level security;
alter table public.affiliate_campaigns enable row level security;
alter table public.affiliate_links enable row level security;
alter table public.affiliate_events enable row level security;
alter table public.membership_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.donations enable row level security;
alter table public.payment_transactions enable row level security;

drop policy if exists "public active advertising packages read" on public.advertising_packages;
create policy "public active advertising packages read" on public.advertising_packages for select using(active);
drop policy if exists "public active membership plans read" on public.membership_plans;
create policy "public active membership plans read" on public.membership_plans for select using(active);
drop policy if exists "public active affiliate links read" on public.affiliate_links;
create policy "public active affiliate links read" on public.affiliate_links for select using(active);
drop policy if exists "public sponsored story details read" on public.sponsored_article_details;
create policy "public sponsored story details read" on public.sponsored_article_details for select using(
  exists (select 1 from public.articles where articles.id = sponsored_article_details.article_id and articles.status = 'published')
);
drop policy if exists "staff manage advertising packages" on public.advertising_packages;
create policy "staff manage advertising packages" on public.advertising_packages for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage advertiser requests" on public.advertiser_requests;
create policy "staff manage advertiser requests" on public.advertiser_requests for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage sponsored article details" on public.sponsored_article_details;
create policy "staff manage sponsored article details" on public.sponsored_article_details for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage affiliate campaigns" on public.affiliate_campaigns;
create policy "staff manage affiliate campaigns" on public.affiliate_campaigns for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage affiliate links" on public.affiliate_links;
create policy "staff manage affiliate links" on public.affiliate_links for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage affiliate events" on public.affiliate_events;
create policy "staff manage affiliate events" on public.affiliate_events for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage membership plans" on public.membership_plans;
create policy "staff manage membership plans" on public.membership_plans for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage subscriptions" on public.subscriptions;
create policy "staff manage subscriptions" on public.subscriptions for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage donations" on public.donations;
create policy "staff manage donations" on public.donations for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage payment transactions" on public.payment_transactions;
create policy "staff manage payment transactions" on public.payment_transactions for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "read own subscriptions" on public.subscriptions;
create policy "read own subscriptions" on public.subscriptions for select using(auth.uid() = user_id);

drop trigger if exists set_advertising_packages_updated_at on public.advertising_packages;
create trigger set_advertising_packages_updated_at before update on public.advertising_packages for each row execute function public.set_updated_at();
drop trigger if exists set_advertiser_requests_updated_at on public.advertiser_requests;
create trigger set_advertiser_requests_updated_at before update on public.advertiser_requests for each row execute function public.set_updated_at();
drop trigger if exists set_sponsored_article_details_updated_at on public.sponsored_article_details;
create trigger set_sponsored_article_details_updated_at before update on public.sponsored_article_details for each row execute function public.set_updated_at();
drop trigger if exists set_affiliate_campaigns_updated_at on public.affiliate_campaigns;
create trigger set_affiliate_campaigns_updated_at before update on public.affiliate_campaigns for each row execute function public.set_updated_at();
drop trigger if exists set_affiliate_links_updated_at on public.affiliate_links;
create trigger set_affiliate_links_updated_at before update on public.affiliate_links for each row execute function public.set_updated_at();
drop trigger if exists set_membership_plans_updated_at on public.membership_plans;
create trigger set_membership_plans_updated_at before update on public.membership_plans for each row execute function public.set_updated_at();
drop trigger if exists set_subscriptions_updated_at on public.subscriptions;
create trigger set_subscriptions_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
drop trigger if exists set_donations_updated_at on public.donations;
create trigger set_donations_updated_at before update on public.donations for each row execute function public.set_updated_at();
drop trigger if exists set_payment_transactions_updated_at on public.payment_transactions;
create trigger set_payment_transactions_updated_at before update on public.payment_transactions for each row execute function public.set_updated_at();

insert into public.advertising_packages (title,slug,description,placement,price,currency,duration_days,features,sort_order) values
  ('Starter visibility','starter-visibility','A focused display placement for small businesses and events.','homepage-sidebar',800,'GHS',14,'["Homepage sidebar placement","Campaign report","Mobile responsive"]'::jsonb,1),
  ('Homepage takeover','homepage-takeover','High-visibility homepage banner campaign for a major launch.','homepage-hero',3500,'GHS',30,'["Homepage hero banner","Mobile sticky option","Priority reporting"]'::jsonb,2),
  ('Sponsored story','sponsored-story','A clearly labelled brand story prepared with editorial safeguards.','sponsored-news',5000,'GHS',30,'["Sponsored disclosure","Article performance report","Social distribution"]'::jsonb,3),
  ('Newsletter partner','newsletter-partner','Reach newsletter readers with a clearly marked partner placement.','footer-banner',1800,'GHS',30,'["Newsletter placement","Click reporting","Brand-safe delivery"]'::jsonb,4)
on conflict (slug) do nothing;

insert into public.membership_plans (name,slug,description,features,amount,currency,interval,sort_order) values
  ('Reader','reader-monthly','Ad-free reading for regular supporters.','["Ad-free reading","Support independent reporting"]'::jsonb,15,'GHS','monthly',1),
  ('Insider','insider-monthly','Ad-free access plus premium reports and early briefings.','["Ad-free reading","Premium reports","Early access briefings"]'::jsonb,40,'GHS','monthly',2),
  ('Annual supporter','annual-supporter','A year of premium access at a supporter rate.','["All Insider benefits","Annual supporter recognition"]'::jsonb,400,'GHS','yearly',3)
on conflict (slug) do nothing;

do $$ begin
  alter publication supabase_realtime add table public.advertiser_requests, public.subscriptions, public.donations;
exception when duplicate_object then null; end $$;
