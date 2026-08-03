-- LK Newsroom social media automation.
-- Run once in Supabase Dashboard > SQL Editor after the base schema and live-news.sql.

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('facebook','instagram','threads','x','linkedin','telegram')),
  display_name text not null,
  account_id text not null,
  credential_key text,
  credentials_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  enabled boolean not null default false,
  auto_post boolean not null default true,
  category_slugs text[] not null default '{}'::text[],
  posting_delay_minutes integer not null default 0 check (posting_delay_minutes in (0,5,15,60)),
  post_template text not null default '{breaking}{headline}\n\n{summary}\n\nRead more:\n{url}\n\n{hashtags}',
  auto_post_from timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  last_success_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform, account_id)
);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  article_id uuid not null references public.articles(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','threads','x','linkedin','telegram')),
  status text not null default 'pending' check (status in ('pending','scheduled','processing','published','retry','failed','cancelled')),
  post_text text not null,
  article_url text not null,
  image_url text,
  scheduled_for timestamptz not null default now(),
  locked_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz,
  platform_post_id text,
  platform_post_url text,
  last_error text,
  posted_at timestamptz,
  click_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id, article_id)
);

create table if not exists public.social_logs (
  id bigint generated always as identity primary key,
  social_post_id uuid references public.social_posts(id) on delete cascade,
  account_id uuid references public.social_accounts(id) on delete set null,
  platform text,
  level text not null default 'info' check (level in ('info','error','warning')),
  event text not null,
  message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- OAuth state is short lived and never exposed to the browser except as the opaque state value.
create table if not exists public.social_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  platform text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists social_posts_due_idx on public.social_posts(status, scheduled_for, next_attempt_at);
create index if not exists social_posts_article_idx on public.social_posts(article_id, created_at desc);
create index if not exists social_logs_account_idx on public.social_logs(account_id, created_at desc);
create index if not exists social_oauth_states_expiry_idx on public.social_oauth_states(expires_at) where consumed_at is null;

create or replace function public.increment_social_click(social_post_uuid uuid) returns void language sql security definer set search_path=public as $$
  update public.social_posts set click_count=click_count+1 where id=social_post_uuid and status='published'
$$;
grant execute on function public.increment_social_click(uuid) to anon, authenticated;

drop trigger if exists set_social_accounts_updated_at on public.social_accounts;
create trigger set_social_accounts_updated_at before update on public.social_accounts for each row execute function public.set_updated_at();
drop trigger if exists set_social_posts_updated_at on public.social_posts;
create trigger set_social_posts_updated_at before update on public.social_posts for each row execute function public.set_updated_at();

alter table public.social_accounts enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_logs enable row level security;
alter table public.social_oauth_states enable row level security;

drop policy if exists "staff manage social accounts" on public.social_accounts;
create policy "staff manage social accounts" on public.social_accounts for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff view social posts" on public.social_posts;
create policy "staff view social posts" on public.social_posts for select using(public.is_staff());
drop policy if exists "staff manage social posts" on public.social_posts;
create policy "staff manage social posts" on public.social_posts for update using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff view social logs" on public.social_logs;
create policy "staff view social logs" on public.social_logs for select using(public.is_staff());
-- OAuth state is accessed exclusively through the service role on the server.

-- Add social_posts and social_accounts to Realtime only if you want live admin refreshes:
-- alter publication supabase_realtime add table public.social_posts, public.social_accounts;
