-- LK Newsroom notification and personalisation system.
-- Run once in the Supabase SQL Editor after schema.sql and the existing LK Newsroom upgrades.
-- This migration is additive and is safe to run again.

create table if not exists public.notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null unique,
  push_token text,
  push_endpoint text unique,
  push_subscription jsonb not null default '{}'::jsonb,
  phone text,
  preferences jsonb not null default '{"breaking_news":true,"daily_brief":true,"morning_summary":true,"ghana":false,"politics":false,"business":false,"technology":false,"sports":false,"entertainment":false,"health":false,"world":false,"africa":false,"comment_replies":true,"supporter_updates":true,"email_enabled":true,"push_enabled":false,"sms_enabled":false}'::jsonb,
  source text not null default 'website',
  active boolean not null default true,
  confirmed_at timestamptz,
  last_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_subscriptions_active_idx on public.notification_subscriptions(active,created_at desc);
create index if not exists notification_subscriptions_user_idx on public.notification_subscriptions(user_id) where user_id is not null;
create index if not exists notification_subscriptions_preferences_idx on public.notification_subscriptions using gin(preferences);

create table if not exists public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  articles jsonb not null default '[]'::jsonb,
  sent_date date not null unique,
  status text not null default 'draft' check(status in ('draft','scheduled','sending','sent','failed')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.notification_subscriptions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  article_id uuid references public.articles(id) on delete set null,
  daily_brief_id uuid references public.daily_briefs(id) on delete set null,
  title text not null,
  message text not null,
  type text not null default 'news' check(type in ('breaking','daily_brief','category','comment_reply','comment_like','mention','supporter','manual','system')),
  url text,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  read_status boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists notifications_article_subscription_type_unique
  on public.notifications(subscription_id,article_id,type)
  where subscription_id is not null and article_id is not null;
create unique index if not exists notifications_brief_subscription_unique
  on public.notifications(subscription_id,daily_brief_id)
  where subscription_id is not null and daily_brief_id is not null;
create index if not exists notifications_user_created_idx on public.notifications(user_id,created_at desc) where user_id is not null;
create index if not exists notifications_subscription_created_idx on public.notifications(subscription_id,created_at desc);
create index if not exists notifications_article_created_idx on public.notifications(article_id,created_at desc) where article_id is not null;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.notification_subscriptions(id) on delete cascade,
  channel text not null check(channel in ('push','email','sms')),
  status text not null default 'pending' check(status in ('pending','processing','sent','retry','failed','cancelled')),
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  provider_id text,
  attempts integer not null default 0 check(attempts >= 0),
  max_attempts integer not null default 5 check(max_attempts between 1 and 12),
  next_attempt_at timestamptz,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id,channel)
);

create index if not exists notification_deliveries_due_idx on public.notification_deliveries(status,scheduled_for,next_attempt_at);
create index if not exists notification_deliveries_subscription_idx on public.notification_deliveries(subscription_id,created_at desc);

create table if not exists public.notification_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  type text not null default 'manual' check(type in ('breaking','daily_brief','category','supporter','manual','system')),
  url text,
  audience_preferences text[] not null default '{}'::text[],
  category_slugs text[] not null default '{}'::text[],
  channels text[] not null default array['push','email']::text[],
  scheduled_for timestamptz not null default now(),
  status text not null default 'scheduled' check(status in ('draft','scheduled','sending','sent','failed','cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notification_campaigns_due_idx on public.notification_campaigns(status,scheduled_for);

-- This table holds inferred interests for signed-in readers only. It never stores an IP address.
create table if not exists public.user_interests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  interests jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Existing Daily Brief newsletter readers remain subscribed after the upgrade.
do $$ begin
  insert into public.notification_subscriptions(email,preferences,source)
  select email,
    '{"breaking_news":true,"daily_brief":true,"morning_summary":true,"ghana":false,"politics":false,"business":false,"technology":false,"sports":false,"entertainment":false,"health":false,"world":false,"africa":false,"comment_replies":true,"supporter_updates":true,"email_enabled":true,"push_enabled":false,"sms_enabled":false}'::jsonb,
    coalesce(source,'newsletter')
  from public.newsletter
  where status='subscribed'
  on conflict(email) do nothing;
exception when undefined_table then null; end $$;

alter table public.notification_subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.daily_briefs enable row level security;
alter table public.notification_campaigns enable row level security;
alter table public.user_interests enable row level security;

drop policy if exists "users view their notification subscriptions" on public.notification_subscriptions;
create policy "users view their notification subscriptions" on public.notification_subscriptions
  for select using(auth.uid() = user_id);
drop policy if exists "users update their notification subscriptions" on public.notification_subscriptions;
create policy "users update their notification subscriptions" on public.notification_subscriptions
  for update using(auth.uid() = user_id) with check(auth.uid() = user_id);
drop policy if exists "users view their notifications" on public.notifications;
create policy "users view their notifications" on public.notifications
  for select using(auth.uid() = user_id);
drop policy if exists "users update their notifications" on public.notifications;
create policy "users update their notifications" on public.notifications
  for update using(auth.uid() = user_id) with check(auth.uid() = user_id);
drop policy if exists "users view their interests" on public.user_interests;
create policy "users view their interests" on public.user_interests
  for select using(auth.uid() = user_id);
drop policy if exists "users manage their interests" on public.user_interests;
create policy "users manage their interests" on public.user_interests
  for all using(auth.uid() = user_id) with check(auth.uid() = user_id);

drop policy if exists "staff manage notification subscriptions" on public.notification_subscriptions;
create policy "staff manage notification subscriptions" on public.notification_subscriptions
  for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage notifications" on public.notifications;
create policy "staff manage notifications" on public.notifications
  for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage notification deliveries" on public.notification_deliveries;
create policy "staff manage notification deliveries" on public.notification_deliveries
  for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage daily briefs" on public.daily_briefs;
create policy "staff manage daily briefs" on public.daily_briefs
  for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff manage notification campaigns" on public.notification_campaigns;
create policy "staff manage notification campaigns" on public.notification_campaigns
  for all using(public.is_staff()) with check(public.is_staff());

drop trigger if exists set_notification_subscriptions_updated_at on public.notification_subscriptions;
create trigger set_notification_subscriptions_updated_at before update on public.notification_subscriptions
for each row execute function public.set_updated_at();
drop trigger if exists set_daily_briefs_updated_at on public.daily_briefs;
create trigger set_daily_briefs_updated_at before update on public.daily_briefs
for each row execute function public.set_updated_at();
drop trigger if exists set_notification_deliveries_updated_at on public.notification_deliveries;
create trigger set_notification_deliveries_updated_at before update on public.notification_deliveries
for each row execute function public.set_updated_at();
drop trigger if exists set_notification_campaigns_updated_at on public.notification_campaigns;
create trigger set_notification_campaigns_updated_at before update on public.notification_campaigns
for each row execute function public.set_updated_at();

-- A signed-in reader is notified when somebody replies to their comment. Delivery is
-- deliberately queued by the Railway worker; this trigger never calls an external API.
create or replace function public.queue_comment_reply_notification()
returns trigger language plpgsql security definer set search_path=public as $$
declare recipient uuid; subscription uuid;
begin
  if new.parent_id is null then return new; end if;
  select user_id into recipient from public.comments where id=new.parent_id;
  if recipient is null or recipient=new.user_id then return new; end if;
  select id into subscription from public.notification_subscriptions
    where user_id=recipient and active=true and coalesce((preferences->>'comment_replies')::boolean,true)=true
    order by updated_at desc limit 1;
  if subscription is null then return new; end if;
  insert into public.notifications(subscription_id,user_id,article_id,title,message,type,url,dedupe_key)
  values(subscription,recipient,new.article_id,'New reply to your comment',left(coalesce(new.body,''),280),'comment_reply',null,'comment-reply:'||new.id::text||':'||subscription::text)
  on conflict(dedupe_key) do nothing;
  return new;
end;
$$;
drop trigger if exists queue_comment_reply_notification on public.comments;
create trigger queue_comment_reply_notification after insert on public.comments
for each row execute function public.queue_comment_reply_notification();

-- Admin counts and signed-in reader inboxes can update live without a reload.
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notification_deliveries;
exception when duplicate_object then null; end $$;
